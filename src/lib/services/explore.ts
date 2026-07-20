import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { DISCOVERABLE_USER_WHERE } from "@/lib/services/trust-safety";
import { calculateAge } from "@/lib/utils";
import { promptLabel } from "@/config/prompts";
import { getReplySignals } from "@/lib/services/signals";
import {
  GROUP_LABELS,
  bySlug,
  exploreCategories,
  type TaxonomyGroup,
} from "@/lib/discovery/taxonomy";
import type { Prisma } from "@/generated/prisma/client";
import { PHOTO_VERIFIED_WHERE } from "@/lib/services/verification";
import {
  resolveBadgeVisibleForUser,
  resolveBadgeVisibleForUsers,
  toTrustFacts,
} from "@/lib/services/verification";
import type { TrustFacts } from "@/lib/trust/verification-state-machine";

/**
 * Explore - discovery categories driven by the canonical taxonomy
 * (src/lib/discovery/taxonomy.ts). Each ExploreCategory row carries a
 * `matcher` JSON derived from its taxonomy profileFieldMapping:
 *   {kind:"availability", values:[categoryId]}    Profile.availabilityTags
 *   {kind:"goal", values:[RelationshipGoal]}      Profile.relationshipGoal
 *   {kind:"interests", values:[interestSlug...]}  ProfileInterest by slug
 *   {kind:"community", values:[categoryId]}       Profile.communityTags
 * Saved preferences (UserExplorePreference) always count as membership,
 * so every category works even before profiles carry matching tags.
 */

export type Matcher =
  | { kind: "interests"; values: string[] }
  | { kind: "goal"; values: string[] }
  | { kind: "availability"; values: string[] }
  | { kind: "community"; values: string[] }
  | { kind: "preference" };

export type ExploreFilters = {
  ageMin?: number;
  ageMax?: number;
  country?: string;
  relationshipGoal?: string;
  verifiedOnly?: boolean;
  page?: number;
  pageSize?: number;
};

/** Fire-and-forget product analytics. Never blocks or throws. */
export function track(name: string, userId: string | null, data?: Prisma.InputJsonValue) {
  db.analyticsEvent.create({ data: { name, userId, data } }).catch(() => {});
}

/** Membership predicate for a category, as a Prisma User where-clause. */
function membershipWhere(categoryId: string, matcher: Matcher | null): Prisma.UserWhereInput {
  const viaPreference: Prisma.UserWhereInput = {
    explorePreferences: { some: { categoryId } },
  };
  if (!matcher || matcher.kind === "preference") return viaPreference;

  let viaProfile: Prisma.UserWhereInput = {};
  switch (matcher.kind) {
    case "interests":
      viaProfile = {
        profile: { is: { interests: { some: { interest: { slug: { in: matcher.values } } } } } },
      };
      break;
    case "goal":
      viaProfile = {
        profile: {
          is: { relationshipGoal: { in: matcher.values as never } },
        },
      };
      break;
    case "availability":
      viaProfile = { profile: { is: { availabilityTags: { hasSome: matcher.values } } } };
      break;
    case "community":
      viaProfile = { profile: { is: { communityTags: { hasSome: matcher.values } } } };
      break;
  }
  return { OR: [viaPreference, viaProfile] };
}

/** Baseline safety/visibility rules - never show hidden or unsafe rows. */
function visibleWhere(viewerId: string, blockedIds: string[]): Prisma.UserWhereInput {
  return {
    id: { notIn: [viewerId, ...blockedIds] },
    // Status ladder single source: trust-safety.ts (suspended/banned/
    // shadow-banned/deleted excluded; limited stays visible).
    ...DISCOVERABLE_USER_WHERE,
    onboardingDone: true,
    profile: { is: { isVisible: true } },
  };
}

async function blockedIdsFor(viewerId: string): Promise<string[]> {
  const blocks = await db.block.findMany({
    where: { OR: [{ blockerId: viewerId }, { blockedId: viewerId }] },
    select: { blockerId: true, blockedId: true },
  });
  return blocks.flatMap((b) => [b.blockerId, b.blockedId]).filter((id) => id !== viewerId);
}

const ONLINE_WINDOW_MS = 5 * 60_000;

const GROUP_ORDER: TaxonomyGroup[] = [
  "right-now",
  "relationship",
  "lifestyle",
  "interests",
  "community",
];

export type ExploreCategorySummary = {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  group: TaxonomyGroup;
  iconKey: string;
  imageUrl: string | null;
  gradientFrom: string;
  gradientTo: string;
  /** Real member count - a live query, never invented. */
  count: number;
  /** Members active within the last 5 minutes. */
  onlineCount: number;
  saved: boolean;
  taxonomyOrder: number;
};

export type ExploreGroupSection = {
  group: TaxonomyGroup;
  label: string;
  categories: ExploreCategorySummary[];
};

/**
 * Active categories grouped by taxonomy group (Right now / Relationship /
 * Lifestyle / Interests / Community), with real people + online counts.
 * Within a group: the viewer's saved categories first, then people count,
 * then online count, then taxonomy order.
 */
export async function getExploreCategories(viewerId: string): Promise<ExploreGroupSection[]> {
  const [categories, blockedIds, myPrefs] = await Promise.all([
    db.exploreCategory.findMany({ where: { isActive: true } }),
    blockedIdsFor(viewerId),
    db.userExplorePreference.findMany({
      where: { userId: viewerId },
      select: { categoryId: true },
    }),
  ]);
  const mine = new Set(myPrefs.map((p) => p.categoryId));
  const onlineSince = new Date(Date.now() - ONLINE_WINDOW_MS);
  const orderBySlug = new Map(exploreCategories().map((c, i) => [c.slug, i]));

  const rows: ExploreCategorySummary[] = await Promise.all(
    categories
      // Only taxonomy-backed categories surface; anything else is stale data.
      .filter((c) => bySlug.has(c.slug))
      .map(async (c) => {
        const member: Prisma.UserWhereInput[] = [
          visibleWhere(viewerId, blockedIds),
          membershipWhere(c.id, c.matcher as Matcher | null),
        ];
        const [count, onlineCount] = await Promise.all([
          db.user.count({ where: { AND: member } }),
          db.user.count({ where: { AND: [...member, { lastActiveAt: { gte: onlineSince } }] } }),
        ]);
        const taxonomy = bySlug.get(c.slug)!;
        return {
          id: c.id,
          slug: c.slug,
          title: c.title,
          description: c.description ?? taxonomy.description,
          group: taxonomy.group,
          iconKey: c.iconKey,
          imageUrl: c.imageUrl,
          gradientFrom: c.gradientFrom,
          gradientTo: c.gradientTo,
          count,
          onlineCount,
          saved: mine.has(c.id),
          taxonomyOrder: orderBySlug.get(c.slug) ?? 0,
        };
      }),
  );

  const rank = (a: ExploreCategorySummary, b: ExploreCategorySummary) =>
    Number(b.saved) - Number(a.saved) ||
    b.count - a.count ||
    b.onlineCount - a.onlineCount ||
    a.taxonomyOrder - b.taxonomyOrder;

  return GROUP_ORDER.map((group) => ({
    group,
    label: GROUP_LABELS[group],
    categories: rows.filter((r) => r.group === group).sort(rank),
  })).filter((section) => section.categories.length > 0);
}

const PAGE_SIZE = 12;

/** Members of one category, filtered, ranked, paginated. */
export async function getExploreMatches(viewerId: string, slug: string, filters: ExploreFilters) {
  const category = await db.exploreCategory.findUnique({ where: { slug } });
  if (!category || !category.isActive) return null;

  const [me, blockedIds, swiped] = await Promise.all([
    db.profile.findUnique({
      where: { userId: viewerId },
      include: { interests: { select: { interest: { select: { slug: true } } } } },
    }),
    blockedIdsFor(viewerId),
    db.like.findMany({ where: { fromId: viewerId }, select: { toId: true } }),
  ]);
  // Already acted (liked/passed) profiles never re-enter the queue
  const actedIds = swiped.map((l) => l.toId);

  const now = Date.now();
  const ageWhere: Prisma.ProfileWhereInput = {};
  if (filters.ageMin)
    ageWhere.birthDate = { lte: new Date(now - filters.ageMin * 365.25 * 24 * 3600_000) };
  if (filters.ageMax)
    ageWhere.AND = [
      { birthDate: { gte: new Date(now - (filters.ageMax + 1) * 365.25 * 24 * 3600_000) } },
    ];

  // Respect mutual gender preferences when the viewer has a profile
  const genderWhere: Prisma.ProfileWhereInput = me
    ? {
        ...(me.interestedIn.length ? { gender: { in: me.interestedIn } } : {}),
        interestedIn: { has: me.gender },
      }
    : {};

  const where: Prisma.UserWhereInput = {
    AND: [
      visibleWhere(viewerId, [...blockedIds, ...actedIds]),
      membershipWhere(category.id, category.matcher as Matcher | null),
      {
        profile: {
          is: {
            ...ageWhere,
            ...genderWhere,
            ...(filters.country ? { country: filters.country } : {}),
            ...(filters.relationshipGoal
              ? { relationshipGoal: filters.relationshipGoal as never }
              : {}),
          },
        },
      },
      ...(filters.verifiedOnly ? [PHOTO_VERIFIED_WHERE] : []),
    ],
  };

  // Bounded candidate pool, ranked in memory (swap for SQL scoring at scale)
  const candidates = await db.user.findMany({
    where,
    include: {
      profile: {
        include: { interests: { select: { interest: { select: { slug: true, label: true } } } } },
      },
      photos: {
        where: { moderation: { not: "REJECTED" } },
        orderBy: [{ isCover: "desc" }, { position: "asc" }],
        take: 1,
        select: { url: true, galleryUrl: true, blurDataUrl: true },
      },
      explorePreferences: { where: { categoryId: category.id }, select: { id: true } },
    },
    take: 200,
  });

  const mySlugs = new Set(me?.interests.map((i) => i.interest.slug) ?? []);
  const visibleMembers = candidates.filter((u) => u.profile);
  // ONE batch badge resolution for the whole page (no per-user query / N+1);
  // the canonical dispatcher returns legacy or per-photo per cohort.
  const badgeMap = await resolveBadgeVisibleForUsers(
    visibleMembers.map((u) => u.id),
    new Map<string, TrustFacts>(visibleMembers.map((u) => [u.id, toTrustFacts(u)])),
  );
  const scored = visibleMembers
    .map((u) => {
      const p = u.profile!;
      const shared = p.interests.filter((i) => mySlugs.has(i.interest.slug)).length;
      const verified = badgeMap.get(u.id)?.visible ?? false;
      const recent = now - u.lastActiveAt.getTime() < 24 * 3600_000;
      const score =
        (u.explorePreferences.length > 0 ? 50 : 0) + // explicit category membership
        (me && p.relationshipGoal === me.relationshipGoal ? 20 : 0) +
        shared * 6 +
        (verified ? 10 : 0) +
        (recent ? 8 : 0) +
        (me?.country && p.country === me.country ? 6 : 0) +
        p.completionPct / 10;
      return { u, p, shared, verified, score };
    })
    .sort((a, b) => b.score - a.score);

  const page = Math.max(1, filters.page ?? 1);
  const pageSize = Math.min(filters.pageSize ?? PAGE_SIZE, 24);
  const slice = scored.slice((page - 1) * pageSize, page * pageSize);

  return {
    category,
    total: scored.length,
    page,
    pageSize,
    users: slice.map(({ u, p, shared, verified }) => ({
      userId: u.id,
      displayName: p.displayName,
      age: calculateAge(p.birthDate),
      city: p.city,
      country: p.country,
      bio: p.bio,
      isVerified: verified,
      isOnline: now - u.lastActiveAt.getTime() < 5 * 60_000,
      sharedInterests: shared,
      interests: p.interests.slice(0, 4).map((i) => i.interest.label),
      photo: u.photos[0] ?? null,
    })),
  };
}

/** Full profile for the immersive viewer - same safety rules as the grid. */
export async function getExploreProfile(viewerId: string, targetId: string) {
  if (targetId === viewerId) return null;
  const blockedIds = await blockedIdsFor(viewerId);
  if (blockedIds.includes(targetId)) return null;

  const [target, me] = await Promise.all([
    db.user.findFirst({
      // AND-combine: visibleWhere carries its own `id` key (notIn viewer/
      // blocked), so a naive spread CLOBBERS the target constraint and
      // findFirst returns the first visible user in the table - the
      // explore viewer showed the wrong profile. Caught by the fresh-user
      // E2E (public badge assertion returned someone else's profile).
      where: { AND: [{ id: targetId }, visibleWhere(viewerId, blockedIds)] },
      include: {
        profile: {
          include: {
            interests: { select: { interest: { select: { slug: true, label: true } } } },
            prompts: { orderBy: { sortOrder: "asc" }, select: { promptKey: true, answer: true } },
          },
        },
        photos: {
          where: { moderation: { not: "REJECTED" } },
          orderBy: [{ isCover: "desc" }, { position: "asc" }],
          take: 10,
          select: { url: true, blurDataUrl: true },
        },
      },
    }),
    db.profile.findUnique({
      where: { userId: viewerId },
      select: { interests: { select: { interest: { select: { slug: true } } } } },
    }),
  ]);
  if (!target?.profile) return null;

  // Honest behavioural signal - one query for the single target
  const signals = await getReplySignals([target.id], new Map([[target.id, target.createdAt]]));

  const mySlugs = new Set(me?.interests.map((i) => i.interest.slug) ?? []);
  const p = target.profile;
  // Canonical dispatcher (legacy or per-photo per cohort) - never recomputed.
  const isVerified = await resolveBadgeVisibleForUser(target.id, toTrustFacts(target));
  return {
    userId: target.id,
    displayName: p.displayName,
    age: calculateAge(p.birthDate),
    bio: p.bio,
    city: p.city,
    country: p.country,
    relationshipGoal: p.relationshipGoal,
    replySignal: signals.get(target.id) ?? null,
    isVerified,
    isOnline: Date.now() - target.lastActiveAt.getTime() < 5 * 60_000,
    photos: target.photos,
    prompts: p.prompts.map((pr) => ({ label: promptLabel(pr.promptKey), answer: pr.answer })),
    heightCm: p.heightCm,
    occupation: p.occupation,
    education: p.education,
    interests: p.interests.map((i) => ({
      label: i.interest.label,
      shared: mySlugs.has(i.interest.slug),
    })),
  };
}

// ---------------------------------------------------------------------------
// Admin curation (routes own the permission checks - flags:manage)
// ---------------------------------------------------------------------------

/** Show/hide a category on the public explore surface. */
export async function toggleExploreCategory(opts: {
  actorId: string;
  id: string;
  isActive: boolean;
}): Promise<void> {
  await db.exploreCategory.update({ where: { id: opts.id }, data: { isActive: opts.isActive } });
  await audit({
    actorId: opts.actorId,
    action: "explore.toggle",
    targetType: "exploreCategory",
    targetId: opts.id,
    metadata: { isActive: opts.isActive },
  });
}

/**
 * Swap sort positions with the nearest neighbour in the same group.
 * Returns false when the category is already at the edge (no-op).
 */
export async function moveExploreCategory(opts: {
  actorId: string;
  id: string;
  direction: "up" | "down";
}): Promise<boolean> {
  const cat = await db.exploreCategory.findUniqueOrThrow({ where: { id: opts.id } });
  const neighbour = await db.exploreCategory.findFirst({
    where: {
      group: cat.group,
      sortOrder: opts.direction === "up" ? { lt: cat.sortOrder } : { gt: cat.sortOrder },
    },
    orderBy: { sortOrder: opts.direction === "up" ? "desc" : "asc" },
  });
  if (!neighbour) return false;
  await db.$transaction([
    db.exploreCategory.update({ where: { id: cat.id }, data: { sortOrder: neighbour.sortOrder } }),
    db.exploreCategory.update({ where: { id: neighbour.id }, data: { sortOrder: cat.sortOrder } }),
  ]);
  await audit({
    actorId: opts.actorId,
    action: "explore.reorder",
    targetType: "exploreCategory",
    targetId: opts.id,
  });
  return true;
}

/** Edit a category's presentation fields (title, copy, gradient, art). */
export async function updateExploreCategory(opts: {
  actorId: string;
  id: string;
  data: {
    title?: string;
    description?: string;
    gradientFrom?: string;
    gradientTo?: string;
    iconKey?: string;
    imageUrl?: string | null;
  };
}): Promise<void> {
  await db.exploreCategory.update({ where: { id: opts.id }, data: opts.data });
  await audit({
    actorId: opts.actorId,
    action: "explore.update",
    targetType: "exploreCategory",
    targetId: opts.id,
    metadata: opts.data,
  });
}
