/**
 * Face threshold calibration CLI (Phase 25):
 *   npx tsx scripts/calibrate-face.ts <labelled-outcomes.json>
 *
 * Input: a JSON array of CalibrationSample records (label + NORMALIZED
 * adapter results - NO images, NO vendor scales). The file lives OUTSIDE
 * the repo and is never committed. Output: a calibration report + a
 * recommended, versioned threshold set to paste into the FACE_* env.
 *
 * No biometric material touches this process - it reads outcome labels
 * and similarity numbers only.
 */
import { readFileSync } from "node:fs";
import {
  calibrate,
  recommendThresholds,
  type CalibrationSample,
  type ThresholdSet,
} from "../src/lib/services/face-calibration";

function main() {
  const file = process.argv[2];
  if (!file) {
    console.error("usage: npx tsx scripts/calibrate-face.ts <labelled-outcomes.json>");
    process.exit(2);
  }
  const samples = JSON.parse(readFileSync(file, "utf8")) as CalibrationSample[];
  if (!Array.isArray(samples) || samples.length === 0) {
    console.error("input must be a non-empty JSON array of CalibrationSample records");
    process.exit(1);
  }

  const base: ThresholdSet = {
    version: process.env.FACE_CALIBRATION_VERSION || "cal-unversioned",
    provider: process.env.FACE_MATCH_PROVIDER || "aws_rekognition_faces",
    modelVersion: process.env.FACE_MODEL_VERSION || "rekognition-6.0",
    region: process.env.AWS_REKOGNITION_REGION || "eu-west-1",
    matchThreshold: 0.85,
    mismatchThreshold: 0.4,
    minQuality: 0.5,
    manipulationThreshold: 0.8,
    coverMinDominance: 0.2,
  };

  const current = calibrate(samples, base);
  const { best, evaluated } = recommendThresholds(samples, base);

  console.log(`samples: ${samples.length}  grid evaluated: ${evaluated}`);
  console.log("\n--- current thresholds ---");
  console.log(JSON.stringify(current, null, 2));
  if (best) {
    console.log("\n--- RECOMMENDED (lowest false-non-match under the FMR/MRR caps) ---");
    console.log(
      `FACE_MATCH_THRESHOLD=${best.thresholds.matchThreshold}  ` +
        `FACE_MISMATCH_THRESHOLD=${best.thresholds.mismatchThreshold}`,
    );
    console.log(
      `false-match ${best.falseMatchRate}%  false-non-match ${best.falseNonMatchRate}%  ` +
        `manual-review ${best.manualReviewRate}%`,
    );
    console.log(
      `demographic fairness assessed: ${best.demographicFairnessAssessed} ` +
        `${best.byDemographic ? "" : "(no annotated samples - do NOT claim fairness)"}`,
    );
  } else {
    console.log(
      "\nNo threshold set met the false-match/manual-review ceilings - collect more data.",
    );
  }
}

main();
