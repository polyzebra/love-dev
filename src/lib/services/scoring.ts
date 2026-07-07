import type { Gender, LifestyleFrequency, RelationshipGoal } from "@/generated/prisma/enums";

/**
 * Canonical compatibility engine - the ONE place a match score is
 * computed. Explore, Discover and match celebrations all consume this;
 * never duplicate scoring logic elsewhere.
 *
 * Every factor is weighted and every point traces to real profile
 * data - reasons are generated from the same factors, so the UI can
 * always explain WHY (no fake percentages).
 */

export type ScoringProfile = {
  relationshipGoal: RelationshipGoal;
  gender: Gender;
  city: string | null;
  country: string;
  latitude: number | null;
  longitude: number | null;
  languages: string[];
  interestSlugs: string[];
  interestLabels: string[];
  smoking: LifestyleFrequency;
  drinking: LifestyleFrequency;
  exercise: string | null;
  personalityTags: string[];
  communityTags: string[];
  birthDate: Date;
  minAge: number;
  maxAge: number;
};

export type ScoringCandidateMeta = {
  isVerified: boolean;
  lastActiveAt: Date;
  createdAt: Date;
  isOnline: boolean;
};

export type CompatibilityResult = {
  /** 55-99, deterministic, never random */
  score: number;
  /** Honest, ordered explanations of the top factors */
  reasons: string[];
};

const W = {
  goal: 20,
  interests: 20, // 5 per shared, capped
  location: 15, // same city 15, same country 8, <=25km 12
  languages: 8,
  lifestyle: 10, // smoking/drinking/exercise similarity
  personality: 8, // 4 per shared tag, capped
  community: 5,
  agePref: 5, // candidate inside viewer's window
  verified: 5,
  activity: 7, // active within 24h
  freshness: 3, // joined within 7 days
  online: 4,
} as const;
const MAX = Object.values(W).reduce((a, b) => a + b, 0);

function ageOf(birthDate: Date): number {
  return Math.floor((Date.now() - birthDate.getTime()) / (365.25 * 24 * 3600_000));
}

function haversineKm(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const R = 6371;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLon = ((bLon - aLon) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}

export function computeCompatibility(
  viewer: ScoringProfile,
  candidate: ScoringProfile,
  meta: ScoringCandidateMeta,
): CompatibilityResult {
  let pts = 0;
  const reasons: { weight: number; text: string }[] = [];

  // Relationship goal
  const goalCompat =
    viewer.relationshipGoal === candidate.relationshipGoal ||
    [viewer.relationshipGoal, candidate.relationshipGoal].includes("OPEN_TO_EITHER");
  if (goalCompat) {
    pts += W.goal;
    if (viewer.relationshipGoal === candidate.relationshipGoal)
      reasons.push({ weight: W.goal, text: "Same relationship goal" });
  }

  // Shared interests
  const mine = new Set(viewer.interestSlugs);
  const shared = candidate.interestSlugs.filter((s) => mine.has(s));
  pts += Math.min(W.interests, shared.length * 5);
  if (shared.length >= 2) reasons.push({ weight: shared.length * 5, text: `${shared.length} shared interests` });
  else if (shared.length === 1) {
    const label = candidate.interestLabels[candidate.interestSlugs.indexOf(shared[0])] ?? shared[0];
    reasons.push({ weight: 5, text: `You both love ${label.toLowerCase()}` });
  }

  // Location
  if (viewer.city && candidate.city && viewer.city === candidate.city) {
    pts += W.location;
    reasons.push({ weight: W.location, text: `Both in ${candidate.city}` });
  } else if (
    viewer.latitude != null && viewer.longitude != null &&
    candidate.latitude != null && candidate.longitude != null &&
    haversineKm(viewer.latitude, viewer.longitude, candidate.latitude, candidate.longitude) <= 25
  ) {
    pts += 12;
    reasons.push({ weight: 12, text: "Less than 25 km apart" });
  } else if (viewer.country === candidate.country) {
    pts += 8;
  }

  // Languages
  const langShared = candidate.languages.filter((l) => viewer.languages.includes(l));
  if (langShared.length > 0) {
    pts += W.languages;
    if (langShared.some((l) => l !== "English"))
      reasons.push({ weight: W.languages, text: `Speaks ${langShared.find((l) => l !== "English")}` });
  }

  // Lifestyle similarity (declared habits only)
  let lifestyle = 0;
  if (viewer.smoking !== "PREFER_NOT_TO_SAY" && viewer.smoking === candidate.smoking) lifestyle += 4;
  if (viewer.drinking !== "PREFER_NOT_TO_SAY" && viewer.drinking === candidate.drinking) lifestyle += 3;
  if (viewer.exercise && viewer.exercise === candidate.exercise) lifestyle += 3;
  pts += Math.min(W.lifestyle, lifestyle);
  if (lifestyle >= 7) reasons.push({ weight: lifestyle, text: "Similar lifestyle" });

  // Personality + community overlap
  const persShared = candidate.personalityTags.filter((t) => viewer.personalityTags.includes(t));
  pts += Math.min(W.personality, persShared.length * 4);
  if (persShared.length > 0) reasons.push({ weight: persShared.length * 4, text: "Similar vibe" });
  const commShared = candidate.communityTags.filter((t) => viewer.communityTags.includes(t));
  pts += Math.min(W.community, commShared.length * 3);

  // Age preference fit
  const cAge = ageOf(candidate.birthDate);
  if (cAge >= viewer.minAge && cAge <= viewer.maxAge) pts += W.agePref;

  // Trust + liveliness
  if (meta.isVerified) {
    pts += W.verified;
    reasons.push({ weight: W.verified, text: "Photo verified" });
  }
  if (Date.now() - meta.lastActiveAt.getTime() < 24 * 3600_000) pts += W.activity;
  if (Date.now() - meta.createdAt.getTime() < 7 * 24 * 3600_000) {
    pts += W.freshness;
    reasons.push({ weight: W.freshness, text: "New this week" });
  }
  if (meta.isOnline) {
    pts += W.online;
    reasons.push({ weight: W.online, text: "Online right now" });
  }

  const score = Math.round(55 + (pts / MAX) * 44);
  return {
    score: Math.min(99, score),
    reasons: reasons.sort((a, b) => b.weight - a.weight).slice(0, 3).map((r) => r.text),
  };
}
