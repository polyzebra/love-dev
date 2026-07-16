/**
 * THE single, versioned source of every face-verification threshold. All
 * decision thresholds live here so calibration recommends against ONE
 * config and production reads ONE config. Every value is env-driven with a
 * documented default; nothing here changes behaviour unless the env is set.
 *
 * Calibration NEVER writes these - it recommends a candidate set + version;
 * a human applies the approved values to the environment (see the
 * face:calibrate report + docs/FACE-VERIFICATION-RUNBOOK.md).
 *
 * Env (all optional; defaults preserve the historical behaviour):
 *   FACE_THRESHOLD_VERSION            label stamped on decisions/reports
 *   FACE_MATCH_THRESHOLD              0-1 similarity >= this = confident match
 *   FACE_MISMATCH_THRESHOLD          0-1 similarity <= this = confident mismatch
 *   FACE_MANUAL_REVIEW_MIN           0-1 floor of the manual-review band
 *   FACE_MIN_QUALITY                 0-1 below this = UNCERTAIN, never a verdict
 *   FACE_MANIPULATION_RISK_THRESHOLD 0-1 risk >= this = MANIPULATION_RISK
 *     (legacy alias FACE_MANIPULATION_THRESHOLD still honoured)
 *   FACE_AWS_MATCH_SIMILARITY        0-100 Rekognition confident-match cut
 *   FACE_AWS_MISMATCH_SIMILARITY     0-100 Rekognition confident-mismatch cut
 */

function num(env: string | undefined, fallback: number): number {
  const v = Number(env);
  return Number.isFinite(v) ? v : fallback;
}

export type FaceThresholds = {
  version: string;
  /** 0-1 normalized similarity bands (the app/policy layer). */
  matchThreshold: number;
  mismatchThreshold: number;
  manualReviewMin: number;
  minQuality: number;
  manipulationRiskThreshold: number;
  /** 0-100 Rekognition-native similarity cuts (the adapter layer). */
  awsMatchSimilarity: number;
  awsMismatchSimilarity: number;
};

export function faceThresholds(): FaceThresholds {
  const mismatch = num(process.env.FACE_MISMATCH_THRESHOLD, 0.4);
  return {
    version: process.env.FACE_THRESHOLD_VERSION?.trim() || "v0",
    matchThreshold: num(process.env.FACE_MATCH_THRESHOLD, 0.85),
    mismatchThreshold: mismatch,
    // The manual-review band floor: similarity in (manualReviewMin,
    // matchThreshold) is "not confident either way" -> human decides.
    // Defaults to the mismatch cut so the historical two-band behaviour is
    // unchanged until an explicit floor is set.
    manualReviewMin: num(process.env.FACE_MANUAL_REVIEW_MIN, mismatch),
    minQuality: num(process.env.FACE_MIN_QUALITY, 0.5),
    manipulationRiskThreshold: num(
      process.env.FACE_MANIPULATION_RISK_THRESHOLD ?? process.env.FACE_MANIPULATION_THRESHOLD,
      0.8,
    ),
    awsMatchSimilarity: num(process.env.FACE_AWS_MATCH_SIMILARITY, 92),
    awsMismatchSimilarity: num(process.env.FACE_AWS_MISMATCH_SIMILARITY, 70),
  };
}
