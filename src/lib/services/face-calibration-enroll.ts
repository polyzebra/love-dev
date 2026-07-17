/**
 * G3.2 - Calibration-only enrollment orchestration + measured metrics.
 *
 * This module NEVER runs in production: every AWS-touching function delegates
 * to the triple-gated primitives in aws-rekognition.ts (assertCalibrationMode).
 * It owns metadata validation (no anonymous enrollment), the labelled
 * ExternalImageId key, cleanup, the measured confusion-matrix metrics
 * (FAR/FRR/precision/recall/TP/TN/FP/FN, per-label/device/demographic), and the
 * versioned report shape. No biometric image or vendor scale is ever stored -
 * labels, scenario/device/demographic tags and metrics only.
 *
 * Server-only.
 */
import {
  assertCalibrationMode,
  calibrationIndexFace,
  calibrationDeleteFaces,
  calibrationListFaces,
} from "@/lib/services/aws-rekognition";

// --------------------------------------------------------------- metadata

/** Full provenance for ONE calibration face. No anonymous enrollment. */
export type CalibrationSubjectMeta = {
  subjectId: string;
  consentRef: string;
  datasetVersion: string;
  /** ISO capture timestamp. */
  captureTimestamp: string;
  scenario: string;
  device: { platform: string; model?: string };
  /** Optional, ONLY where legally/ethically approved. */
  demographic?: Record<string, string>;
};

const SAFE = /^[A-Za-z0-9._:-]+$/;

/** Returns the list of missing/invalid fields (empty = valid). */
export function validateCalibrationMeta(m: Partial<CalibrationSubjectMeta>): string[] {
  const problems: string[] = [];
  const req = (v: unknown, name: string) => {
    if (typeof v !== "string" || v.trim() === "") problems.push(`${name} is required`);
  };
  req(m.subjectId, "subjectId");
  req(m.consentRef, "consentRef");
  req(m.datasetVersion, "datasetVersion");
  req(m.captureTimestamp, "captureTimestamp");
  req(m.scenario, "scenario");
  if (!m.device || typeof m.device.platform !== "string" || m.device.platform.trim() === "") {
    problems.push("device.platform is required");
  }
  if (m.captureTimestamp && Number.isNaN(Date.parse(m.captureTimestamp))) {
    problems.push("captureTimestamp must be an ISO date");
  }
  return problems;
}

/** Deterministic, AWS-safe ExternalImageId that encodes the labelled key.
 *  No PII beyond the internal subjectId; unsafe chars are stripped. */
export function calibrationExternalImageId(m: CalibrationSubjectMeta): string {
  const clean = (s: string) => s.replace(/[^A-Za-z0-9._-]/g, "-").slice(0, 60);
  const id = `cal:${clean(m.datasetVersion)}:${clean(m.subjectId)}:${clean(m.scenario)}:${clean(m.captureTimestamp)}`;
  if (!SAFE.test(id)) throw new Error("calibration: could not build a safe externalImageId");
  return id;
}

/** Enroll ONE consented, fully-labelled calibration face. Gated + validated. */
export async function enrollCalibrationSample(
  meta: CalibrationSubjectMeta,
  image: Buffer,
): Promise<{ faceId: string; externalImageId: string }> {
  assertCalibrationMode(); // fail closed before any validation/AWS work
  const problems = validateCalibrationMeta(meta);
  if (problems.length) throw new Error(`calibration enroll refused: ${problems.join("; ")}`);
  const externalImageId = calibrationExternalImageId(meta);
  const { faceId } = await calibrationIndexFace({ image, externalImageId });
  return { faceId, externalImageId };
}

// --------------------------------------------------------------- cleanup

/** Delete a specific set of calibration faces (post-run cleanup). */
export async function cleanupCalibrationFaces(faceIds: string[]): Promise<{ deleted: number }> {
  return calibrationDeleteFaces(faceIds);
}

/** Purge EVERY face in the calibration collection (calibration-clean). */
export async function purgeCalibrationCollection(): Promise<{ deleted: number }> {
  const { faceIds } = await calibrationListFaces();
  return calibrationDeleteFaces(faceIds);
}

// --------------------------------------------------------- measured metrics

export type Outcome = "accept" | "reject" | "review";
export type MetricRow = {
  /** Ground truth: is this genuinely the owner? */
  truth: "match" | "nonmatch";
  predicted: Outcome;
  label?: string;
  device?: string;
  demographic?: string;
};

export type ConfusionMetrics = {
  n: number;
  tp: number;
  tn: number;
  fp: number;
  fn: number;
  reviews: number;
  /** false accept rate = FP / negatives (the dangerous error). */
  far: number | null;
  /** false reject rate = FN / positives. */
  frr: number | null;
  precision: number | null;
  recall: number | null;
  reviewRate: number;
};

/** Pure confusion matrix from MEASURED outcome rows. Reviews are neither TP
 *  nor FP - they are the human-caught band (counted in reviewRate). */
export function computeCalibrationMetrics(rows: MetricRow[]): ConfusionMetrics {
  let tp = 0,
    tn = 0,
    fp = 0,
    fn = 0,
    reviews = 0;
  let positives = 0,
    negatives = 0;
  for (const r of rows) {
    if (r.truth === "match") positives += 1;
    else negatives += 1;
    if (r.predicted === "review") {
      reviews += 1;
      continue;
    }
    if (r.truth === "match") {
      if (r.predicted === "accept") tp += 1;
      else fn += 1;
    } else {
      if (r.predicted === "accept")
        fp += 1; // FALSE ACCEPT
      else tn += 1;
    }
  }
  const div = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 10000) / 10000 : null);
  return {
    n: rows.length,
    tp,
    tn,
    fp,
    fn,
    reviews,
    far: div(fp, negatives),
    frr: div(fn, positives),
    precision: div(tp, tp + fp),
    recall: div(tp, positives),
    reviewRate: rows.length ? Math.round((reviews / rows.length) * 10000) / 10000 : 0,
  };
}

/** Metrics sliced by an arbitrary key (label / device / demographic). */
export function sliceMetrics(
  rows: MetricRow[],
  key: (r: MetricRow) => string | undefined,
): Record<string, ConfusionMetrics> {
  const groups: Record<string, MetricRow[]> = {};
  for (const r of rows) {
    const k = key(r);
    if (k === undefined) continue;
    (groups[k] ??= []).push(r);
  }
  const out: Record<string, ConfusionMetrics> = {};
  for (const [k, g] of Object.entries(groups)) out[k] = computeCalibrationMetrics(g);
  return out;
}

// ----------------------------------------------------------- versioned report

export type CalibrationRunReport = {
  kind: "calibration-run-report";
  datasetVersion: string;
  thresholdVersion: string;
  calibrationVersion: string;
  modelVersion: string;
  region: string;
  collection: string;
  generatedAt: string;
  gitCommit: string;
  metrics: ConfusionMetrics;
  byLabel: Record<string, ConfusionMetrics>;
  byDevice: Record<string, ConfusionMetrics>;
  byDemographic: Record<string, ConfusionMetrics>;
  /** True only when every demographic group has a usable sample count. */
  demographicFairnessAssessed: boolean;
  samples: number;
};

/** Build the versioned, image-free report from MEASURED rows + stamped
 *  provenance (dataset/threshold/model version + timestamp + git commit). */
export function buildCalibrationReport(input: {
  datasetVersion: string;
  thresholdVersion: string;
  calibrationVersion: string;
  modelVersion: string;
  region: string;
  collection: string;
  generatedAt: string;
  gitCommit: string;
  rows: MetricRow[];
}): CalibrationRunReport {
  const byDemographic = sliceMetrics(input.rows, (r) => r.demographic);
  return {
    kind: "calibration-run-report",
    datasetVersion: input.datasetVersion,
    thresholdVersion: input.thresholdVersion,
    calibrationVersion: input.calibrationVersion,
    modelVersion: input.modelVersion,
    region: input.region,
    collection: input.collection,
    generatedAt: input.generatedAt,
    gitCommit: input.gitCommit,
    metrics: computeCalibrationMetrics(input.rows),
    byLabel: sliceMetrics(input.rows, (r) => r.label),
    byDevice: sliceMetrics(input.rows, (r) => r.device),
    byDemographic,
    demographicFairnessAssessed:
      Object.keys(byDemographic).length > 0 && Object.values(byDemographic).every((m) => m.n >= 30),
    samples: input.rows.length,
  };
}
