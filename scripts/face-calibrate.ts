/**
 * face:calibrate - the face-verification threshold CALIBRATION HARNESS.
 *
 * Runs REAL provider comparisons over a dedicated, consented, LABELED
 * dataset (described by a manifest) against a dedicated NON-PRODUCTION
 * collection, captures normalized outcomes + latency + estimated cost,
 * measures accuracy (TAR/FAR/TRR/FRR/...), sweeps candidate thresholds and
 * RECOMMENDS a versioned threshold set - but NEVER applies it. Activation
 * requires explicit human approval (apply the recommended values to the
 * environment; see docs/FACE-VERIFICATION-RUNBOOK.md).
 *
 *   npm run face:calibrate -- --manifest <path> [--out <dir>] [--json]
 *                              [--cost-per-call <usd>]
 *
 * Safety: refuses to run in production or against the production collection;
 * never prints secrets; the report contains labels, scenario tags, scores
 * and metrics - NEVER raw biometric images. The mock provider + a synthetic
 * manifest give a deterministic dry-run (no real AWS, no real faces).
 */
import "dotenv/config";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";

type Label = "samePerson" | "differentPerson" | "nonFace" | "group" | "aiManipulated";
type Predicted = "match" | "mismatch" | "manual_review" | "no_face" | "multi_face" | "manipulation";

type Sample = {
  id: string;
  subjectId: string;
  role: "reference" | "probe";
  label?: Label;
  scenario?: string;
  scenarioTags?: string[];
  consentRef?: string;
  /** File path, or "mock:<bytes>" for a deterministic dry-run. Never a URL/secret. */
  imagePath: string;
};
type Manifest = {
  datasetVersion: string;
  /** Dedicated NON-production collection; must not be the prod collection. */
  collectionId: string;
  environment: string; // must not be "production"
  samples: Sample[];
};

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const JSON_ONLY = process.argv.includes("--json");

function loadImage(imagePath: string): Buffer {
  if (imagePath.startsWith("mock:")) return Buffer.from(imagePath.slice(5));
  return readFileSync(imagePath);
}

/** Map the production per-photo classifier onto a calibration category. */
function toPredicted(classification: string): Predicted {
  switch (classification) {
    case "OWNER_MATCHED":
      return "match";
    case "OTHER_PERSON_ONLY":
      return "mismatch";
    case "NO_FACE":
      return "no_face";
    case "GROUP_PHOTO":
      return "multi_face";
    case "MANIPULATION_RISK":
      return "manipulation";
    default:
      return "manual_review"; // UNCERTAIN
  }
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

async function main() {
  const manifestPath = arg("manifest");
  if (!manifestPath) {
    console.error("face:calibrate: --manifest <path> is required");
    process.exit(2);
  }
  const outDir = arg("out", "reports/calibration")!;
  const costPerCall = Number(arg("cost-per-call", process.env.FACE_AWS_COST_PER_CALL ?? "0.001"));

  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Manifest;

  // ---- safety gates (fail closed) --------------------------------------
  const runtimeEnv =
    process.env.FACE_ENVIRONMENT?.trim() ||
    (process.env.NODE_ENV === "production" ? "production" : "staging");
  if (runtimeEnv === "production" || manifest.environment === "production") {
    console.error("face:calibrate REFUSED: never calibrate in/against production.");
    process.exit(2);
  }
  if (
    manifest.collectionId &&
    manifest.collectionId === process.env.FACE_COLLECTION_ID &&
    runtimeEnv === "production"
  ) {
    console.error("face:calibrate REFUSED: manifest targets the production collection.");
    process.exit(2);
  }
  // Consent is mandatory for every biometric (face) sample.
  const missingConsent = manifest.samples.filter(
    (s) => s.label !== "nonFace" && (s.role === "reference" || s.label) && !s.consentRef,
  );
  if (missingConsent.length) {
    console.error(
      `face:calibrate REFUSED: ${missingConsent.length} biometric sample(s) missing a consentRef.`,
    );
    process.exit(2);
  }

  const [{ getFaceMatchProvider }, { classifyComparison, faceMatchPolicy }, { faceThresholds }] =
    await Promise.all([
      import("../src/lib/services/face-match-providers"),
      import("../src/lib/services/face-verification"),
      import("../src/lib/services/face-thresholds"),
    ]);
  const provider = getFaceMatchProvider();
  const current = faceMatchPolicy();
  const active = faceThresholds();

  // ---- enroll references (dedicated collection) ------------------------
  const refBySubject = new Map<string, string>();
  let calls = 0;
  for (const s of manifest.samples.filter((x) => x.role === "reference")) {
    const { referenceId } = await provider.createReference({
      userId: s.subjectId,
      selfieImage: loadImage(s.imagePath),
    });
    refBySubject.set(s.subjectId, referenceId);
    calls += 1;
  }

  // ---- run probes ------------------------------------------------------
  type Row = {
    id: string;
    subjectId: string;
    label: Label;
    scenario: string;
    similarity: number | null;
    ownerDetected: boolean;
    faceCount: number;
    manipulationRisk: number | null;
    predicted: Predicted;
    latencyMs: number;
    cmp: unknown;
  };
  const rows: Row[] = [];
  for (const s of manifest.samples.filter((x) => x.role === "probe")) {
    const referenceId = refBySubject.get(s.subjectId);
    if (!referenceId) continue; // probe with no enrolled reference is skipped
    const input = { image: loadImage(s.imagePath), photoId: s.id, photoVersion: 0 };
    const t0 = Date.now();
    const [cmp, manip] = await Promise.all([
      provider.compareReferenceToPhoto(referenceId, input),
      provider.assessManipulationRisk(input),
    ]);
    const latencyMs = Date.now() - t0;
    calls += 2;
    // Score under CURRENT thresholds (probes are identity-bearing = cover).
    const verdict = classifyComparison(cmp, manip.risk, { isCover: true, policy: current });
    rows.push({
      id: s.id,
      subjectId: s.subjectId,
      label: s.label ?? "differentPerson",
      scenario: s.scenario ?? "unspecified",
      similarity: cmp.similarity,
      ownerDetected: cmp.ownerDetected,
      faceCount: cmp.faceCount,
      manipulationRisk: manip.risk,
      predicted: toPredicted(verdict.classification),
      latencyMs,
      cmp,
    });
  }

  // ---- metrics under a given policy ------------------------------------
  const scoreUnder = (policy: typeof current) => {
    const n = rows.length || 1;
    const cat = (r: Row) =>
      toPredicted(
        classifyComparison(r.cmp as never, r.manipulationRisk, { isCover: true, policy })
          .classification,
      );
    const same = rows.filter((r) => r.label === "samePerson");
    const diff = rows.filter((r) => r.label === "differentPerson" || r.label === "aiManipulated");
    const tar = same.length ? same.filter((r) => cat(r) === "match").length / same.length : null;
    const frr = same.length ? same.filter((r) => cat(r) === "mismatch").length / same.length : null;
    const trr = diff.length ? diff.filter((r) => cat(r) === "mismatch").length / diff.length : null;
    // FALSE ACCEPTANCE - the dangerous one: a non-owner scored as a match.
    const far = diff.length ? diff.filter((r) => cat(r) === "match").length / diff.length : null;
    return {
      trueAcceptanceRate: tar,
      falseRejectionRate: frr,
      trueRejectionRate: trr,
      falseAcceptanceRate: far,
      manualReviewRate: rows.filter((r) => cat(r) === "manual_review").length / n,
      noFaceRate: rows.filter((r) => cat(r) === "no_face").length / n,
      multiFaceRate: rows.filter((r) => cat(r) === "multi_face").length / n,
      manipulationRiskRate: rows.filter((r) => cat(r) === "manipulation").length / n,
    };
  };
  const metrics = scoreUnder(current);

  // ---- threshold sweep -> recommendation (never applied) ---------------
  const matchGrid = [0.8, 0.85, 0.9, 0.92, 0.95];
  const mismatchGrid = [0.3, 0.4, 0.5];
  let best: { policy: typeof current; m: ReturnType<typeof scoreUnder> } | null = null;
  for (const matchThreshold of matchGrid) {
    for (const mismatchThreshold of mismatchGrid) {
      if (mismatchThreshold >= matchThreshold) continue;
      const policy = { ...current, matchThreshold, mismatchThreshold };
      const m = scoreUnder(policy);
      // Objective: FAR must be 0 if achievable, then minimize FRR, then
      // minimize manual-review. A non-zero FAR is never recommended when a
      // zero-FAR option exists.
      const key = (x: ReturnType<typeof scoreUnder>) =>
        (x.falseAcceptanceRate ?? 0) * 1000 + (x.falseRejectionRate ?? 0) * 10 + x.manualReviewRate;
      if (!best || key(m) < key(best.m)) best = { policy, m };
    }
  }

  const latencies = rows.map((r) => r.latencyMs).sort((a, b) => a - b);
  const report = {
    kind: "face-calibration-report",
    generatedAt: new Date().toISOString(),
    thresholdVersionActive: active.version,
    datasetVersion: manifest.datasetVersion,
    provider: provider.name,
    collectionId: manifest.collectionId,
    environment: runtimeEnv,
    sampleCounts: {
      references: manifest.samples.filter((s) => s.role === "reference").length,
      probes: rows.length,
      byLabel: rows.reduce<Record<string, number>>(
        (a, r) => ((a[r.label] = (a[r.label] ?? 0) + 1), a),
        {},
      ),
    },
    metricsAtCurrentThresholds: metrics,
    latencyMs: { p50: percentile(latencies, 50), p95: percentile(latencies, 95) },
    estimatedCostUsd: Number((calls * costPerCall).toFixed(4)),
    awsCalls: calls,
    currentThresholds: {
      matchThreshold: current.matchThreshold,
      mismatchThreshold: current.mismatchThreshold,
      manipulationThreshold: current.manipulationThreshold,
    },
    recommendation: best && {
      note: "RECOMMENDED ONLY - not applied. Requires explicit human approval to activate.",
      proposedThresholdVersion: `cal-${manifest.datasetVersion}`,
      matchThreshold: best.policy.matchThreshold,
      mismatchThreshold: best.policy.mismatchThreshold,
      projectedMetrics: best.m,
    },
    // No raw images - labels, scenarios, scores + outcome only.
    samples: rows.map((r) => ({
      id: r.id,
      subjectId: r.subjectId,
      label: r.label,
      scenario: r.scenario,
      similarity: r.similarity,
      ownerDetected: r.ownerDetected,
      faceCount: r.faceCount,
      manipulationRisk: r.manipulationRisk,
      predicted: r.predicted,
    })),
  };

  // ---- write versioned JSON + Markdown ---------------------------------
  const stamp = report.generatedAt.replace(/[:.]/g, "-");
  const base = `calibration-${manifest.datasetVersion}-${stamp}`;
  mkdirSync(outDir, { recursive: true });
  const jsonPath = path.join(outDir, `${base}.json`);
  const mdPath = path.join(outDir, `${base}.md`);
  writeFileSync(jsonPath, JSON.stringify(report, null, 2) + "\n");

  const pct = (v: number | null) => (v === null ? "n/a" : `${(v * 100).toFixed(1)}%`);
  const md = [
    `# Face calibration report - ${manifest.datasetVersion}`,
    ``,
    `- Generated: ${report.generatedAt}`,
    `- Provider: \`${report.provider}\`  Collection: \`${report.collectionId}\`  Env: \`${report.environment}\``,
    `- Probes: ${report.sampleCounts.probes}  References: ${report.sampleCounts.references}`,
    `- Estimated cost: $${report.estimatedCostUsd} over ${report.awsCalls} calls  |  latency p50 ${report.latencyMs.p50}ms / p95 ${report.latencyMs.p95}ms`,
    ``,
    `## Accuracy at current thresholds (v${active.version})`,
    ``,
    `| metric | value |`,
    `| --- | --- |`,
    `| True acceptance (TAR) | ${pct(metrics.trueAcceptanceRate)} |`,
    `| False acceptance (FAR) | ${pct(metrics.falseAcceptanceRate)} |`,
    `| True rejection (TRR) | ${pct(metrics.trueRejectionRate)} |`,
    `| False rejection (FRR) | ${pct(metrics.falseRejectionRate)} |`,
    `| Manual review | ${pct(metrics.manualReviewRate)} |`,
    `| No-face | ${pct(metrics.noFaceRate)} |`,
    `| Multi-face | ${pct(metrics.multiFaceRate)} |`,
    `| Manipulation-risk | ${pct(metrics.manipulationRiskRate)} |`,
    ``,
    `## Recommendation (NOT applied - human approval required)`,
    ``,
    report.recommendation
      ? [
          `- Proposed \`FACE_THRESHOLD_VERSION\`: **${report.recommendation.proposedThresholdVersion}**`,
          `- \`FACE_MATCH_THRESHOLD\`: **${report.recommendation.matchThreshold}**  \`FACE_MISMATCH_THRESHOLD\`: **${report.recommendation.mismatchThreshold}**`,
          `- Projected FAR ${pct(report.recommendation.projectedMetrics.falseAcceptanceRate)} / FRR ${pct(report.recommendation.projectedMetrics.falseRejectionRate)} / manual ${pct(report.recommendation.projectedMetrics.manualReviewRate)}`,
          ``,
          `> These values are a RECOMMENDATION. Do not set them in production until a human reviews this report and approves. This harness never writes thresholds.`,
        ].join("\n")
      : `- (no recommendation - insufficient labeled data)`,
    ``,
  ].join("\n");
  writeFileSync(mdPath, md);

  if (JSON_ONLY) {
    process.stdout.write(
      JSON.stringify({ ...report, reportPaths: { json: jsonPath, md: mdPath } }, null, 2) + "\n",
    );
  } else {
    console.log(md);
    console.log(`\nWrote:\n  ${jsonPath}\n  ${mdPath}\n`);
    console.log(
      "Thresholds were NOT changed. Apply the recommendation only after human approval.\n",
    );
  }
  process.exit(0);
}

main().catch((error) => {
  console.error(`face:calibrate crashed: ${error instanceof Error ? error.message : error}`);
  process.exit(2);
});
