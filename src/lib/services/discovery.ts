import { db } from "@/lib/db";
import { calculateAge } from "@/lib/utils";

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

/**
 * Compatibility placeholder: shared-interest Jaccard similarity scaled
 * to 55-98. Swap for a learned model without touching the UI contract.
 */
function compatibilityScore(mine: Set<string>, theirs: string[]): number {
  if (mine.size === 0 || theirs.length === 0) return 60;
  const shared = theirs.filter((i) => mine.has(i)).length;
  const union = new Set([...mine, ...theirs]).size;
  return Math.round(55 + (shared / union) * 43);
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

  const myInterests = new Set(me.interests.map((i) => i.interest.slug));

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
      compatibility: compatibilityScore(
        myInterests,
        c.interests.map((i) => i.interest.slug),
      ),
    });
    if (results.length >= take) break;
  }

  return results;
}
