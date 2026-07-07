import { db } from "@/lib/db";
import { calculateAge } from "@/lib/utils";
import { computeCompatibility, type ScoringProfile } from "@/lib/services/scoring";

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
  relationshipGoal: ScoringProfile["relationshipGoal"];
  gender: ScoringProfile["gender"];
  city: string | null; country: string;
  latitude: number | null; longitude: number | null;
  languages: string[];
  smoking: ScoringProfile["smoking"]; drinking: ScoringProfile["drinking"];
  exercise: string | null;
  personalityTags: string[]; communityTags: string[];
  birthDate: Date; minAge: number; maxAge: number;
  interests: { interest: { slug: string; label: string } }[];
}): ScoringProfile {
  return {
    relationshipGoal: p.relationshipGoal,
    gender: p.gender,
    city: p.city, country: p.country,
    latitude: p.latitude, longitude: p.longitude,
    languages: p.languages,
    interestSlugs: p.interests.map((i) => i.interest.slug),
    interestLabels: p.interests.map((i) => i.interest.label),
    smoking: p.smoking, drinking: p.drinking,
    exercise: p.exercise,
    personalityTags: p.personalityTags, communityTags: p.communityTags,
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
      user: { is: { status: "ACTIVE" } },
    },
    include: {
      interests: { include: { interest: true } },
      user: {
        select: {
          lastActiveAt: true,
          createdAt: true,
          photos: {
            where: { moderation: { not: "REJECTED" } },
            orderBy: [{ isCover: "desc" }, { position: "asc" }],
            select: { url: true, blurDataUrl: true },
          },
          verifications: {
            where: { type: "PHOTO", status: "APPROVED" },
            select: { id: true },
          },
        },
      },
    },
    orderBy: [{ isBoosted: "desc" }, { updatedAt: "desc" }],
    take: take * 3, // over-fetch, then filter by distance
  });

  const viewerScoring = toScoringProfile(me);

  const results: DiscoverProfile[] = [];
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

    results.push({
      userId: c.userId,
      displayName: c.displayName,
      age: calculateAge(c.birthDate),
      bio: c.bio,
      city: c.city,
      occupation: c.occupation,
      distanceKm,
      isVerified: c.user.verifications.length > 0,
      isOnline: now - c.user.lastActiveAt.getTime() < ONLINE_WINDOW_MS,
      isBoosted: c.isBoosted,
      interests: c.interests.map((i) => i.interest.label),
      photos: c.user.photos,
      ...(() => {
        const { score, reasons } = computeCompatibility(
          viewerScoring,
          toScoringProfile(c),
          {
            isVerified: c.user.verifications.length > 0,
            lastActiveAt: c.user.lastActiveAt,
            createdAt: c.user.createdAt,
            isOnline: now - c.user.lastActiveAt.getTime() < ONLINE_WINDOW_MS,
          },
        );
        return { compatibility: score, reasons };
      })(),
    });
  }

  // Deterministic ranking: best compatibility first - never random order
  results.sort((a, b) => b.compatibility - a.compatibility);
  return results.slice(0, take);
}
