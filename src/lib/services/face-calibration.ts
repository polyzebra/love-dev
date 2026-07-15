/**
 * Threshold calibration framework (Phase 25).
 *
 * Thresholds are NEVER hard-coded guesses: they are a VERSIONED,
 * provider- and model-scoped config object, evaluated against a labelled
 * sample set that lives OUTSIDE the repository (a local/S3 path supplied
 * at run time - no sample, image or biometric material is ever committed
 * or written into analytics).
 *
 * The evaluator consumes only OUTCOME RECORDS (label + the adapter's
 * normalized comparison result). It never sees or stores images.
 * `FACE_CALIBRATION_VERSION` is stamped onto every decision
 * (ProfilePhotoVerification.calibrationVersion / PhotoFaceCheck), so any
 * verdict is auditable back to the exact threshold set - and reversible
 * by pinning the previous version.
 */

export type LabelCategory =
  | "same_person"
  | "different_person"
  | "twins"
  | "close_family"
  | "ageing"
  | "facial_hair_change"
  | "makeup"
  | "glasses"
  | "head_covering"
  | "low_light"
  | "camera_blur"
  | "group_photo"
  | "partial_face"
  | "profile_angle"
  | "ai_generated"
  | "manipulated"
  | "screen_replay"
  | "printed_photo";

/** Labels whose GROUND TRUTH is "this is the owner". */
export const POSITIVE_LABELS: LabelCategory[] = [
  "same_person",
  "ageing",
  "facial_hair_change",
  "makeup",
  "glasses",
  "head_covering",
  "low_light",
  "camera_blur",
  "group_photo",
  "partial_face",
  "profile_angle",
];
/** Labels whose GROUND TRUTH is "this is NOT the owner (or is an attack)". */
export const NEGATIVE_LABELS: LabelCategory[] = [
  "different_person",
  "twins",
  "close_family",
  "ai_generated",
  "manipulated",
  "screen_replay",
  "printed_photo",
];

/** One evaluated sample: the label + the adapter's normalized result. */
export type CalibrationSample = {
  label: LabelCategory;
  isCover: boolean;
  /** Normalized 0-1 similarity from the adapter (never a vendor scale). */
  similarity: number | null;
  faceCount: number;
  qualityScore: number | null;
  manipulationRisk: number | null;
  /** Optional, ONLY where legally/ethically approved; absent by default. */
  demographicGroup?: string;
};

export type ThresholdSet = {
  version: string;
  provider: string;
  modelVersion: string;
  region: string;
  matchThreshold: number;
  mismatchThreshold: number;
  minQuality: number;
  manipulationThreshold: number;
  coverMinDominance: number;
};

export type CalibrationReport = {
  thresholds: ThresholdSet;
  samples: number;
  /** Negative sample accepted as the owner (the DANGEROUS error). */
  falseMatchRate: number | null;
  /** Positive sample rejected as not-the-owner. */
  falseNonMatchRate: number | null;
  manualReviewRate: number | null;
  coverAcceptanceRate: number | null;
  galleryAcceptanceRate: number | null;
  byBand: Record<"confident" | "uncertain" | "mismatch", number>;
  byLabel: Record<string, { n: number; accepted: number; rejected: number; review: number }>;
  /** Present ONLY when samples carried approved demographic annotations. */
  byDemographic: Record<string, { n: number; falseMatch: number; falseNonMatch: number }> | null;
  /** Explicit honesty flag - never claim fairness without the data. */
  demographicFairnessAssessed: boolean;
};

type Outcome = "accept" | "reject" | "review";

/** Pure: how ONE sample resolves under a candidate threshold set. */
export function evaluateSample(sample: CalibrationSample, t: ThresholdSet): Outcome {
  if (sample.manipulationRisk !== null && sample.manipulationRisk >= t.manipulationThreshold) {
    return sample.isCover ? "reject" : "review";
  }
  if (sample.faceCount === 0) return sample.isCover ? "reject" : "accept";
  const quality = sample.qualityScore ?? 1;
  const similarity = sample.similarity ?? 0;
  if (quality < t.minQuality) return "review";
  if (similarity >= t.matchThreshold) return "accept";
  if (similarity <= t.mismatchThreshold) return "reject";
  return "review";
}

/** Pure: full report for a candidate threshold set over a labelled set. */
export function calibrate(
  samples: CalibrationSample[],
  thresholds: ThresholdSet,
): CalibrationReport {
  const byLabel: CalibrationReport["byLabel"] = {};
  const byBand = { confident: 0, uncertain: 0, mismatch: 0 };
  const demo: Record<string, { n: number; falseMatch: number; falseNonMatch: number }> = {};
  let hasDemographics = false;

  let negatives = 0;
  let falseMatches = 0;
  let positives = 0;
  let falseNonMatches = 0;
  let reviews = 0;
  let coverTotal = 0;
  let coverAccepted = 0;
  let galleryTotal = 0;
  let galleryAccepted = 0;

  for (const sample of samples) {
    const outcome = evaluateSample(sample, thresholds);
    const label = sample.label;
    byLabel[label] ??= { n: 0, accepted: 0, rejected: 0, review: 0 };
    byLabel[label].n += 1;
    if (outcome === "accept") byLabel[label].accepted += 1;
    else if (outcome === "reject") byLabel[label].rejected += 1;
    else byLabel[label].review += 1;

    const sim = sample.similarity ?? 0;
    if (sim >= thresholds.matchThreshold) byBand.confident += 1;
    else if (sim <= thresholds.mismatchThreshold) byBand.mismatch += 1;
    else byBand.uncertain += 1;

    if (outcome === "review") reviews += 1;
    if (sample.isCover) {
      coverTotal += 1;
      if (outcome === "accept") coverAccepted += 1;
    } else {
      galleryTotal += 1;
      if (outcome === "accept") galleryAccepted += 1;
    }

    const isNegative = NEGATIVE_LABELS.includes(label);
    const isPositive = POSITIVE_LABELS.includes(label);
    if (isNegative) {
      negatives += 1;
      if (outcome === "accept") falseMatches += 1;
    }
    if (isPositive) {
      positives += 1;
      if (outcome === "reject") falseNonMatches += 1;
    }

    if (sample.demographicGroup) {
      hasDemographics = true;
      const g = (demo[sample.demographicGroup] ??= { n: 0, falseMatch: 0, falseNonMatch: 0 });
      g.n += 1;
      if (isNegative && outcome === "accept") g.falseMatch += 1;
      if (isPositive && outcome === "reject") g.falseNonMatch += 1;
    }
  }

  const rate = (part: number, whole: number) =>
    whole > 0 ? Math.round((part / whole) * 10000) / 100 : null;

  return {
    thresholds,
    samples: samples.length,
    falseMatchRate: rate(falseMatches, negatives),
    falseNonMatchRate: rate(falseNonMatches, positives),
    manualReviewRate: rate(reviews, samples.length),
    coverAcceptanceRate: rate(coverAccepted, coverTotal),
    galleryAcceptanceRate: rate(galleryAccepted, galleryTotal),
    byBand,
    byLabel,
    byDemographic: hasDemographics ? demo : null,
    // Honesty rule: fairness is only "assessed" when annotated samples
    // actually exist AND every group has a usable sample count.
    demographicFairnessAssessed: hasDemographics && Object.values(demo).every((g) => g.n >= 30),
  };
}

/** Grid search: the safest set meeting a false-match ceiling. */
export function recommendThresholds(
  samples: CalibrationSample[],
  base: ThresholdSet,
  opts: { maxFalseMatchRate?: number; maxManualReviewRate?: number } = {},
): { best: CalibrationReport | null; evaluated: number } {
  const maxFmr = opts.maxFalseMatchRate ?? 0.5; // percent
  const maxMrr = opts.maxManualReviewRate ?? 10; // percent
  let best: CalibrationReport | null = null;
  let evaluated = 0;

  for (let match = 0.8; match <= 0.98; match += 0.01) {
    for (let mismatch = 0.3; mismatch < match - 0.05; mismatch += 0.05) {
      const report = calibrate(samples, {
        ...base,
        matchThreshold: Math.round(match * 100) / 100,
        mismatchThreshold: Math.round(mismatch * 100) / 100,
      });
      evaluated += 1;
      if ((report.falseMatchRate ?? 100) > maxFmr) continue;
      if ((report.manualReviewRate ?? 100) > maxMrr) continue;
      // Prefer the lowest false-NON-match at an acceptable false-match.
      if (
        !best ||
        (report.falseNonMatchRate ?? 100) < (best.falseNonMatchRate ?? 100) ||
        ((report.falseNonMatchRate ?? 100) === (best.falseNonMatchRate ?? 100) &&
          (report.manualReviewRate ?? 100) < (best.manualReviewRate ?? 100))
      ) {
        best = report;
      }
    }
  }
  return { best, evaluated };
}
