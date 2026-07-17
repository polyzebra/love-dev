/**
 * calibration - the dedicated, PRODUCTION-LOCKED calibration CLI (G3.2).
 *
 *   npx tsx scripts/calibration.ts enroll  --manifest <path>
 *   npx tsx scripts/calibration.ts run     --manifest <path> [--out <dir>] [--keep]
 *   npx tsx scripts/calibration.ts clean
 *   npx tsx scripts/calibration.ts report  --in <report.json>
 *
 * EVERY command refuses to run in production: it calls assertCalibrationMode()
 * first, which fails closed unless FACE_ENVIRONMENT!=production AND
 * NODE_ENV!=production AND FACE_CALIBRATION_MODE=1 AND a dedicated calibration
 * collection is set (distinct from FACE_COLLECTION_ID). It NEVER touches the
 * production collection, NEVER stores images, and (run) auto-deletes every
 * indexed calibration face on completion unless --keep is passed.
 */
import "dotenv/config";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { execSync } from "node:child_process";
import path from "node:path";
import type { MetricRow, Outcome } from "../src/lib/services/face-calibration-enroll";

type ManifestSample = {
  id: string;
  subjectId: string;
  role: "reference" | "probe";
  truth?: "match" | "nonmatch";
  label?: string;
  scenario: string;
  device: { platform: string; model?: string };
  demographic?: Record<string, string>;
  consentRef: string;
  datasetVersion: string;
  captureTimestamp: string;
  /** File path, or "mock:<bytes>" for a deterministic dry-run. */
  imagePath: string;
};
type Manifest = { datasetVersion: string; environment: string; samples: ManifestSample[] };

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
function loadImage(p: string): Buffer {
  return p.startsWith("mock:") ? Buffer.from(p.slice(5)) : readFileSync(p);
}
function gitCommit(): string {
  try {
    return execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}
function fail(msg: string): never {
  console.error(msg);
  process.exit(2);
}

async function main() {
  const cmd = process.argv[2];
  const rek = await import("../src/lib/services/aws-rekognition");
  const enroll = await import("../src/lib/services/face-calibration-enroll");

  // Hard production lockout, uniformly, before ANY command does work.
  let gate: { collectionId: string; region: string };
  try {
    gate = rek.assertCalibrationMode();
  } catch (e) {
    fail(`REFUSED: ${e instanceof Error ? e.message : e}`);
  }

  if (cmd === "clean") {
    const { deleted } = await enroll.purgeCalibrationCollection();
    console.log(`calibration clean: deleted ${deleted} face(s) from ${gate.collectionId}`);
    return;
  }

  if (cmd === "report") {
    const inPath = arg("in");
    if (!inPath) fail("report: --in <report.json> required");
    const r = JSON.parse(readFileSync(inPath!, "utf8"));
    console.log(JSON.stringify(r, null, 2));
    return;
  }

  const manifestPath = arg("manifest");
  if (!manifestPath) fail(`${cmd}: --manifest <path> required`);
  const manifest = JSON.parse(readFileSync(manifestPath!, "utf8")) as Manifest;
  if (manifest.environment === "production") fail("REFUSED: manifest.environment=production");

  const { classifyComparison, faceMatchPolicy } =
    await import("../src/lib/services/face-verification");
  const { faceThresholds } = await import("../src/lib/services/face-thresholds");
  const { awsConfig } = rek;

  // ---- enroll references into the calibration collection -----------------
  const refBySubject = new Map<string, string>();
  const enrolledFaceIds: string[] = [];
  for (const s of manifest.samples.filter((x) => x.role === "reference")) {
    const { faceId } = await enroll.enrollCalibrationSample(
      {
        subjectId: s.subjectId,
        consentRef: s.consentRef,
        datasetVersion: s.datasetVersion,
        captureTimestamp: s.captureTimestamp,
        scenario: s.scenario,
        device: s.device,
        demographic: s.demographic,
      },
      loadImage(s.imagePath),
    );
    refBySubject.set(s.subjectId, faceId);
    enrolledFaceIds.push(faceId);
  }
  console.log(
    `enrolled ${enrolledFaceIds.length} calibration reference(s) into ${gate.collectionId}`,
  );

  if (cmd === "enroll") return; // enrollment only

  if (cmd !== "run") fail(`unknown command "${cmd}" (enroll|run|clean|report)`);

  // ---- run probes, classify, measure ------------------------------------
  const policy = faceMatchPolicy();
  const rows: MetricRow[] = [];
  const keep = process.argv.includes("--keep");
  try {
    for (const s of manifest.samples.filter((x) => x.role === "probe")) {
      const ref = refBySubject.get(s.subjectId);
      if (!ref) continue;
      const cmp = await rek.calibrationCompare(ref, {
        image: loadImage(s.imagePath),
        photoId: s.id,
        photoVersion: 0,
      });
      const verdict = classifyComparison(cmp, null, { isCover: true, policy });
      const predicted: Outcome =
        verdict.decision === "PASSED"
          ? "accept"
          : verdict.decision === "REJECTED"
            ? "reject"
            : "review";
      rows.push({
        truth: s.truth ?? "nonmatch",
        predicted,
        label: s.label ?? s.scenario,
        device: s.device.platform,
        demographic: s.demographic ? Object.values(s.demographic).join("/") : undefined,
      });
    }

    const active = faceThresholds();
    const report = enroll.buildCalibrationReport({
      datasetVersion: manifest.datasetVersion,
      thresholdVersion: active.version,
      calibrationVersion: process.env.FACE_CALIBRATION_VERSION || "cal-unversioned",
      modelVersion: awsConfig().modelVersion,
      region: gate.region,
      collection: gate.collectionId,
      generatedAt: new Date().toISOString(),
      gitCommit: gitCommit(),
      rows,
    });

    const outDir = arg("out", "reports/calibration")!;
    mkdirSync(outDir, { recursive: true });
    const file = path.join(
      outDir,
      `calibration-run-${manifest.datasetVersion}-${report.generatedAt.replace(/[:.]/g, "-")}.json`,
    );
    writeFileSync(file, JSON.stringify(report, null, 2) + "\n");
    const m = report.metrics;
    console.log(
      `\nMEASURED (n=${m.n}): FAR=${m.far} FRR=${m.frr} precision=${m.precision} recall=${m.recall} review=${m.reviewRate}`,
    );
    console.log(`  TP=${m.tp} TN=${m.tn} FP=${m.fp} FN=${m.fn} reviews=${m.reviews}`);
    console.log(`Report: ${file}`);
  } finally {
    // ---- automatic cleanup: no calibration data remains -----------------
    if (!keep) {
      const { deleted } = await enroll.cleanupCalibrationFaces(enrolledFaceIds);
      console.log(`auto-cleanup: deleted ${deleted} indexed calibration face(s)`);
    } else {
      console.log(
        `--keep: ${enrolledFaceIds.length} face(s) LEFT in ${gate.collectionId} (clean later with: calibration clean)`,
      );
    }
  }
}

main().catch((e) => {
  console.error(`calibration crashed: ${e instanceof Error ? e.message : e}`);
  process.exit(2);
});
