import { db } from "@/lib/db";
import { calculateAge } from "@/lib/utils";
import type { Prisma } from "@/generated/prisma/client";

/**
 * Explore - data-driven discovery categories.
 *
 * A category's `matcher` JSON decides who belongs to it:
 *   {kind:"interests", values:[interestSlug...]}  profile interest match
 *   {kind:"goal", values:[RelationshipGoal...]}   relationship goal match
 *   {kind:"country", values:["IE"|"GB"]}          community by country
 *   {kind:"recentlyActive", hours?:24}            the "Today" group
 *   {kind:"preference"}                           opt-in only (saved pref)
 * Saved preferences (UserExplorePreference) always count as membership,
 * so every category works even before profiles carry matching tags.
 */

export type Matcher =
  | { kind: "interests"; values: string[] }
  | { kind: "goal"; values: string[] }
  | { kind: "country"; values: string[] }
  | { kind: "availability"; values: string[] }
  | { kind: "personality"; values: string[] }
  | { kind: "community"; values: string[] }
  | { kind: "recentlyActive"; hours?: number }
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
    case "country":
      viaProfile = { profile: { is: { country: { in: matcher.values } } } };
      break;
    case "availability":
      viaProfile = { profile: { is: { availabilityTags: { hasSome: matcher.values } } } };
      break;
    case "personality":
      viaProfile = { profile: { is: { personalityTags: { hasSome: matcher.values } } } };
      break;
    case "community":
      viaProfile = { profile: { is: { communityTags: { hasSome: matcher.values } } } };
      break;
    case "recentlyActive":
      viaProfile = {
        lastActiveAt: { gte: new Date(Date.now() - (matcher.hours ?? 24) * 3600_000) },
      };
      break;
  }
  return { OR: [viaPreference, viaProfile] };
}

/** Baseline safety/visibility rules - never show hidden or unsafe rows. */
function visibleWhere(viewerId: string, blockedIds: string[]): Prisma.UserWhereInput {
  return {
    id: { notIn: [viewerId, ...blockedIds] },
    status: "ACTIVE",
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

/** All active categories, grouped and with live member counts. */
export async function getExploreCategories(viewerId: string) {
  const [categories, blockedIds, myPrefs] = await Promise.all([
    db.exploreCategory.findMany({
      where: { isActive: true },
      orderBy: [{ group: "asc" }, { sortOrder: "asc" }],
    }),
    blockedIdsFor(viewerId),
    db.userExplorePreference.findMany({ where: { userId: viewerId }, select: { categoryId: true } }),
  ]);
  const mine = new Set(myPrefs.map((p) => p.categoryId));

  const counts = await Promise.all(
    categories.map((c) =>
      db.user.count({
        where: {
          AND: [
            visibleWhere(viewerId, blockedIds),
            membershipWhere(c.id, c.matcher as Matcher | null),
          ],
        },
      }),
    ),
  );

  return categories.map((c, i) => ({
    id: c.id,
    slug: c.slug,
    title: c.title,
    description: c.description,
    group: c.group,
    iconKey: c.iconKey,
    imageUrl: c.imageUrl,
    gradientFrom: c.gradientFrom,
    gradientTo: c.gradientTo,
    count: counts[i],
    saved: mine.has(c.id),
  }));
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
  if (filters.ageMin) ageWhere.birthDate = { lte: new Date(now - filters.ageMin * 365.25 * 24 * 3600_000) };
  if (filters.ageMax)
    ageWhere.AND = [{ birthDate: { gte: new Date(now - (filters.ageMax + 1) * 365.25 * 24 * 3600_000) } }];

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
            ...(filters.relationshipGoal ? { relationshipGoal: filters.relationshipGoal as never } : {}),
          },
        },
      },
      ...(filters.verifiedOnly
        ? [{ verifications: { some: { type: "PHOTO" as const, status: "APPROVED" as const } } }]
        : []),
    ],
  };

  // Bounded candidate pool, ranked in memory (swap for SQL scoring at scale)
  const candidates = await db.user.findMany({
    where,
    include: {
      profile: { include: { interests: { select: { interest: { select: { slug: true, label: true } } } } } },
      photos: {
        where: { moderation: { not: "REJECTED" } },
        orderBy: [{ isCover: "desc" }, { position: "asc" }],
        take: 1,
        select: { url: true, blurDataUrl: true },
      },
      verifications: { where: { type: "PHOTO", status: "APPROVED" }, select: { id: true } },
      explorePreferences: { where: { categoryId: category.id }, select: { id: true } },
    },
    take: 200,
  });

  const mySlugs = new Set(me?.interests.map((i) => i.interest.slug) ?? []);
  const scored = candidates
    .filter((u) => u.profile)
    .map((u) => {
      const p = u.profile!;
      const shared = p.interests.filter((i) => mySlugs.has(i.interest.slug)).length;
      const verified = u.verifications.length > 0;
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
      where: { id: targetId, ...visibleWhere(viewerId, blockedIds) },
      include: {
        profile: { include: { interests: { select: { interest: { select: { slug: true, label: true } } } } } },
        photos: {
          where: { moderation: { not: "REJECTED" } },
          orderBy: [{ isCover: "desc" }, { position: "asc" }],
          take: 10,
          select: { url: true, blurDataUrl: true },
        },
        verifications: { where: { type: "PHOTO", status: "APPROVED" }, select: { id: true } },
      },
    }),
    db.profile.findUnique({
      where: { userId: viewerId },
      select: { interests: { select: { interest: { select: { slug: true } } } } },
    }),
  ]);
  if (!target?.profile) return null;

  const mySlugs = new Set(me?.interests.map((i) => i.interest.slug) ?? []);
  const p = target.profile;
  return {
    userId: target.id,
    displayName: p.displayName,
    age: calculateAge(p.birthDate),
    bio: p.bio,
    city: p.city,
    country: p.country,
    relationshipGoal: p.relationshipGoal,
    isVerified: target.verifications.length > 0,
    isOnline: Date.now() - target.lastActiveAt.getTime() < 5 * 60_000,
    photos: target.photos,
    interests: p.interests.map((i) => ({
      label: i.interest.label,
      shared: mySlugs.has(i.interest.slug),
    })),
  };
}
