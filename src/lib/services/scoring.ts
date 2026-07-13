import type { Gender, LifestyleFrequency, RelationshipGoal } from "@/generated/prisma/enums";
import { categoriesForProfile, pickTemplate } from "@/lib/discovery/taxonomy";

/**
 * Canonical compatibility engine - the ONE place a match score is
 * computed. Explore, Discover and match celebrations all consume this;
 * never duplicate scoring logic elsewhere.
 *
 * Shared-signal points come straight from the discovery taxonomy: both
 * profiles are mapped onto taxonomy categories and every SHARED
 * category adds its scoringWeight. Reasons are the taxonomy's own
 * matchReasonTemplates - picked deterministically per pair - so the UI
 * always explains WHY in human language (no fake percentages, no
 * database-speak).
 */

export type ScoringProfile = {
  userId: string;
  relationshipGoal: RelationshipGoal;
  gender: Gender;
  city: string | null;
  country: string;
  latitude: number | null;
  longitude: number | null;
  languages: string[];
  interestSlugs: string[];
  availabilityTags: string[];
  communityTags: string[];
  smoking: LifestyleFrequency;
  drinking: LifestyleFrequency;
  exercise: string | null;
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
  /** Honest, ordered explanations of the top factors - story language only. */
  reasons: string[];
  /** Taxonomy categories BOTH profiles belong to, strongest first. */
  sharedCategoryIds: string[];
};

const W = {
  taxonomy: 30, // sum of shared-category scoringWeights, capped
  location: 15, // same city 15, <=25km 12, same country 8
  languages: 8,
  lifestyle: 10, // smoking/drinking/exercise similarity
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
  // Story reasons (taxonomy templates) always lead; contextual facts
  // (location, language, lifestyle) fill the remaining slots.
  const storyReasons: { weight: number; text: string }[] = [];
  const reasons: { weight: number; text: string }[] = [];

  // Shared taxonomy categories - the goal match rides on the shared
  // relationship category (same goalValue), interests/availability/
  // community on theirs. Each shared category adds its scoringWeight.
  const candidateCategoryIds = new Set(categoriesForProfile(candidate).map((c) => c.id));
  const shared = categoriesForProfile(viewer)
    .filter((c) => candidateCategoryIds.has(c.id))
    .sort((a, b) => b.scoringWeight - a.scoringWeight);
  pts += Math.min(
    W.taxonomy,
    shared.reduce((sum, c) => sum + c.scoringWeight, 0),
  );
  const pairSeed = `${viewer.userId}:${candidate.userId}`;
  for (const cat of shared) {
    storyReasons.push({
      weight: cat.scoringWeight,
      text: pickTemplate(cat.matchReasonTemplates, `${pairSeed}:${cat.id}`),
    });
  }

  // Location
  if (viewer.city && candidate.city && viewer.city === candidate.city) {
    pts += W.location;
    reasons.push({ weight: W.location, text: `You're both in ${candidate.city}.` });
  } else if (
    viewer.latitude != null &&
    viewer.longitude != null &&
    candidate.latitude != null &&
    candidate.longitude != null &&
    haversineKm(viewer.latitude, viewer.longitude, candidate.latitude, candidate.longitude) <= 25
  ) {
    pts += 12;
    reasons.push({ weight: 12, text: "You're less than 25 km apart." });
  } else if (viewer.country === candidate.country) {
    pts += 8;
  }

  // Languages
  const langShared = candidate.languages.filter((l) => viewer.languages.includes(l));
  if (langShared.length > 0) {
    pts += W.languages;
    const beyondEnglish = langShared.find((l) => l !== "English");
    if (beyondEnglish)
      reasons.push({ weight: W.languages, text: `You both speak ${beyondEnglish}.` });
  }

  // Lifestyle similarity (declared habits only)
  let lifestyle = 0;
  if (viewer.smoking !== "PREFER_NOT_TO_SAY" && viewer.smoking === candidate.smoking)
    lifestyle += 4;
  if (viewer.drinking !== "PREFER_NOT_TO_SAY" && viewer.drinking === candidate.drinking)
    lifestyle += 3;
  if (viewer.exercise && viewer.exercise === candidate.exercise) lifestyle += 3;
  pts += Math.min(W.lifestyle, lifestyle);
  if (lifestyle >= 7) reasons.push({ weight: lifestyle, text: "Your day-to-day habits line up." });

  // Age preference fit
  const cAge = ageOf(candidate.birthDate);
  if (cAge >= viewer.minAge && cAge <= viewer.maxAge) pts += W.agePref;

  // Trust + liveliness: points only - these facts live in the trust
  // row of the UI and are never part of the top story reasons.
  if (meta.isVerified) pts += W.verified;
  if (Date.now() - meta.lastActiveAt.getTime() < 24 * 3600_000) pts += W.activity;
  if (Date.now() - meta.createdAt.getTime() < 7 * 24 * 3600_000) pts += W.freshness;
  if (meta.isOnline) pts += W.online;

  const score = Math.round(55 + (pts / MAX) * 44);
  const byWeight = (a: { weight: number }, b: { weight: number }) => b.weight - a.weight;
  return {
    score: Math.min(99, score),
    reasons: [...storyReasons.sort(byWeight), ...reasons.sort(byWeight)]
      .slice(0, 3)
      .map((r) => r.text),
    sharedCategoryIds: shared.map((c) => c.id),
  };
}
