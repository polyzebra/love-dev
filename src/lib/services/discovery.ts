import { db } from "@/lib/db";
import { DISCOVERABLE_USER_WHERE } from "@/lib/services/trust-safety";
import { calculateAge } from "@/lib/utils";
import { computeCompatibility, type ScoringProfile } from "@/lib/services/scoring";
import { getReplySignals } from "@/lib/services/signals";
import { promptLabel } from "@/config/prompts";
import { GOAL_LINES } from "@/lib/discovery/taxonomy";
import type { RelationshipGoal } from "@/generated/prisma/enums";

/**
 * Discovery feed. Excludes: self, already-swiped, blocked (either way),
 * hidden/suspended/shadow-banned accounts. Prefers boosted and recently
 * active profiles. Distance uses a bounding-box approximation - replace
 * with PostGIS earth_distance for production-scale precision.
 */

export type DiscoverProfile = {
  userId: string;
  displayName: string;
  age: number;
  bio: string | null;
  city: string | null;
  occupation: string | null;
  distanceKm: number | null;
  isVerified: boolean;
  isOnline: boolean;
  isBoosted: boolean;
  interests: string[];
  photos: { url: string; blurDataUrl: string | null }[];
  compatibility: number;
  reasons: string[];
  /** Taxonomy categories viewer AND candidate share, strongest first. */
  sharedCategoryIds: string[];
  /** Raw goal - lets the client detect real shared-goal overlap. */
  relationshipGoal: RelationshipGoal;
  /** Human phrasing of relationshipGoal - the card's opening line. */
  goalLine: string | null;
  /** The candidate's first prompt answer, in their own words. */
  promptTease: { label: string; answer: string } | null;
  /** Honest reply-behaviour label from real message timestamps. */
  replySignal: string | null;
};

const ONLINE_WINDOW_MS = 5 * 60_000;

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Map a Prisma profile row (with interests) onto the scoring engine's shape. */
function toScoringProfile(p: {
  userId: string;
  relationshipGoal: ScoringProfile["relationshipGoal"];
  gender: ScoringProfile["gender"];
  city: string | null; country: string;
  latitude: number | null; longitude: number | null;
  languages: string[];
  smoking: ScoringProfile["smoking"]; drinking: ScoringProfile["drinking"];
  exercise: string | null;
  availabilityTags: string[]; communityTags: string[];
  birthDate: Date; minAge: number; maxAge: number;
  interests: { interest: { slug: string; label: string } }[];
}): ScoringProfile {
  return {
    userId: p.userId,
    relationshipGoal: p.relationshipGoal,
    gender: p.gender,
    city: p.city, country: p.country,
    latitude: p.latitude, longitude: p.longitude,
    languages: p.languages,
    interestSlugs: p.interests.map((i) => i.interest.slug),
    availabilityTags: p.availabilityTags,
    communityTags: p.communityTags,
    smoking: p.smoking, drinking: p.drinking,
    exercise: p.exercise,
    birthDate: p.birthDate, minAge: p.minAge, maxAge: p.maxAge,
  };
}

export async function getDiscoverFeed(userId: string, take = 20): Promise<DiscoverProfile[]> {
  const me = await db.profile.findUnique({
    where: { userId },
    include: { interests: { include: { interest: true } } },
  });
  if (!me) return [];

  const [swiped, blocks] = await Promise.all([
    db.like.findMany({ where: { fromId: userId }, select: { toId: true } }),
    db.block.findMany({
      where: { OR: [{ blockerId: userId }, { blockedId: userId }] },
      select: { blockerId: true, blockedId: true },
    }),
  ]);

  const excluded = new Set<string>([userId]);
  for (const s of swiped) excluded.add(s.toId);
  for (const b of blocks) {
    excluded.add(b.blockerId);
    excluded.add(b.blockedId);
  }

  const now = Date.now();
  const minBirth = new Date(now - me.maxAge * 365.25 * 24 * 3600 * 1000);
  const maxBirth = new Date(now - me.minAge * 365.25 * 24 * 3600 * 1000);

  const candidates = await db.profile.findMany({
    where: {
      userId: { notIn: [...excluded] },
      isVisible: true,
      gender: me.interestedIn.length ? { in: me.interestedIn } : undefined,
      birthDate: { gte: minBirth, lte: maxBirth },
      // Candidate must also be interested in my gender
      interestedIn: { has: me.gender },
      // Status ladder: suspended/banned/shadow-banned/deleted are never
      // discoverable; limited/photo-review-required stay visible (their
      // restriction is outbound engagement, not visibility) - single
      // source in trust-safety.ts.
      user: { is: DISCOVERABLE_USER_WHERE },
    },
    include: {
      interests: { include: { interest: true } },
      prompts: {
        orderBy: { sortOrder: "asc" },
        take: 2,
        select: { promptKey: true, answer: true },
      },
      user: {
        select: {
          lastActiveAt: true,
          createdAt: true,
          // Canonical photo-verified verdict (see lib/services/verification.ts)
          photoVerifiedAt: true,
          photos: {
            where: { moderation: { not: "REJECTED" } },
            orderBy: [{ isCover: "desc" }, { position: "asc" }],
            select: { url: true, blurDataUrl: true },
          },
        },
      },
    },
    orderBy: [{ isBoosted: "desc" }, { updatedAt: "desc" }],
    take: take * 3, // over-fetch, then filter by distance
  });

  const viewerScoring = toScoringProfile(me);

  const results: DiscoverProfile[] = [];
  const createdAtById = new Map<string, Date>();
  for (const c of candidates) {
    let distanceKm: number | null = null;
    if (
      me.latitude != null &&
      me.longitude != null &&
      c.latitude != null &&
      c.longitude != null
    ) {
      distanceKm = haversineKm(me.latitude, me.longitude, c.latitude, c.longitude);
      if (distanceKm > me.maxDistanceKm) continue;
    }

    createdAtById.set(c.userId, c.user.createdAt);

    const firstPrompt = c.prompts[0];
    results.push({
      userId: c.userId,
      displayName: c.displayName,
      age: calculateAge(c.birthDate),
      bio: c.bio,
      city: c.city,
      occupation: c.occupation,
      distanceKm,
      isVerified: c.user.photoVerifiedAt !== null,
      isOnline: now - c.user.lastActiveAt.getTime() < ONLINE_WINDOW_MS,
      isBoosted: c.isBoosted,
      interests: c.interests.map((i) => i.interest.label),
      photos: c.user.photos,
      relationshipGoal: c.relationshipGoal,
      goalLine: GOAL_LINES[c.relationshipGoal] ?? null,
      promptTease: firstPrompt
        ? { label: promptLabel(firstPrompt.promptKey), answer: firstPrompt.answer }
        : null,
      replySignal: null, // filled in below for the final result set only
      ...(() => {
        const { score, reasons, sharedCategoryIds } = computeCompatibility(
          viewerScoring,
          toScoringProfile(c),
          {
            isVerified: c.user.photoVerifiedAt !== null,
            lastActiveAt: c.user.lastActiveAt,
            createdAt: c.user.createdAt,
            isOnline: now - c.user.lastActiveAt.getTime() < ONLINE_WINDOW_MS,
          },
        );
        return { compatibility: score, reasons, sharedCategoryIds };
      })(),
    });
  }

  // Deterministic ranking: best compatibility first - never random order
  results.sort((a, b) => b.compatibility - a.compatibility);
  const feed = results.slice(0, take);

  // One batched reply-signal lookup for the profiles we actually return
  const signals = await getReplySignals(
    feed.map((p) => p.userId),
    createdAtById,
  );
  for (const p of feed) p.replySignal = signals.get(p.userId) ?? null;

  return feed;
}
