/**
 * G3.2 - calibration tooling. Unit lane (no DB, no live AWS): the Rekognition
 * transport is injected so IndexFaces/SearchFaces/DeleteFaces/ListFaces are
 * deterministic. Proves production lockout, calibration-only enrollment,
 * cleanup, report + version stamping, collection isolation, attempted
 * production execution, and that PRODUCTION behaviour is unchanged.
 *
 * Run with: npx tsx tests/calibration-tooling.test.ts
 */
import assert from "node:assert/strict";

let passed = 0;
async function check(name: string, fn: () => void | Promise<void>): Promise<void> {
  await fn();
  passed += 1;
  console.log(`  ok - ${name}`);
}

const env = process.env as Record<string, string | undefined>;
const KEYS = [
  "NODE_ENV",
  "FACE_ENVIRONMENT",
  "FACE_CALIBRATION_MODE",
  "FACE_CALIBRATION_COLLECTION_ID",
  "FACE_COLLECTION_ID",
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
  "AWS_REKOGNITION_REGION",
  "FACE_MATCH_PROVIDER",
];

async function main() {
  const SAVED = Object.fromEntries(KEYS.map((k) => [k, env[k]]));
  const rek = await import("../src/lib/services/aws-rekognition");
  const cal = await import("../src/lib/services/face-calibration-enroll");

  // Record every AWS call the transport receives.
  const calls: Array<{ target: string; payload: Record<string, unknown> }> = [];
  rek.setRekognitionTransport(async (target, payload) => {
    calls.push({ target, payload });
    switch (target) {
      case "IndexFaces":
        return { FaceRecords: [{ Face: { FaceId: `cal-${calls.length}` } }] };
      case "DetectFaces":
        return {
          FaceDetails: [
            {
              Confidence: 99,
              BoundingBox: { Width: 0.5, Height: 0.6 },
              Quality: { Sharpness: 95, Brightness: 95 },
            },
          ],
        };
      case "SearchFacesByImage":
        return { FaceMatches: [{ Similarity: 97, Face: { FaceId: "cal-1" } }] };
      case "ListFaces":
        return { Faces: [{ FaceId: "x1" }, { FaceId: "x2" }], FaceModelVersion: "7.0" };
      case "DeleteFaces":
        return {};
      default:
        return {};
    }
  });

  // A correctly-configured NON-production calibration environment.
  const goodEnv = () => {
    env.NODE_ENV = "test";
    env.FACE_ENVIRONMENT = "staging";
    env.FACE_CALIBRATION_MODE = "1";
    env.FACE_CALIBRATION_COLLECTION_ID = "tirvea-faces-calibration-staging";
    env.FACE_COLLECTION_ID = "tirvea-faces-prod";
    env.AWS_REKOGNITION_REGION = "eu-west-1";
  };
  const meta = (over: Partial<cal_meta> = {}): cal_meta => ({
    subjectId: "subjA",
    consentRef: "consent://calibration/2026-07/subjA",
    datasetVersion: "ds-v1",
    captureTimestamp: "2026-07-17T10:00:00Z",
    scenario: "daylight",
    device: { platform: "iPhone", model: "15" },
    ...over,
  });
  type cal_meta = import("../src/lib/services/face-calibration-enroll").CalibrationSubjectMeta;

  try {
    // ---- 1. production lockout -------------------------------------------
    await check("production lockout: every gate fails closed", () => {
      goodEnv();
      env.FACE_ENVIRONMENT = "production";
      assert.throws(() => rek.assertCalibrationMode(), /FACE_ENVIRONMENT=production/);
      goodEnv();
      env.NODE_ENV = "production";
      assert.throws(() => rek.assertCalibrationMode(), /production/);
      goodEnv();
      env.FACE_CALIBRATION_MODE = "0";
      assert.throws(() => rek.assertCalibrationMode(), /FACE_CALIBRATION_MODE/);
      goodEnv();
      delete env.FACE_CALIBRATION_COLLECTION_ID;
      assert.throws(() => rek.assertCalibrationMode(), /COLLECTION_ID is not set/);
      goodEnv();
      // Both calibration-named AND equal -> the "differ from prod" gate fires.
      env.FACE_COLLECTION_ID = env.FACE_CALIBRATION_COLLECTION_ID;
      assert.throws(() => rek.assertCalibrationMode(), /differ from FACE_COLLECTION_ID/);
      goodEnv();
      env.FACE_CALIBRATION_COLLECTION_ID = "tirvea-faces-staging"; // no "calibration"
      assert.throws(() => rek.assertCalibrationMode(), /explicitly named/);
      goodEnv();
      const g = rek.assertCalibrationMode();
      assert.equal(g.collectionId, "tirvea-faces-calibration-staging");
    });

    // ---- 2. calibration-only enrollment + 5. collection isolation --------
    await check("calibration enrollment indexes ONLY the calibration collection", async () => {
      goodEnv();
      calls.length = 0;
      const r = await cal.enrollCalibrationSample(meta(), Buffer.from("face:owner"));
      assert.ok(r.faceId.startsWith("cal-"), "returns a faceId");
      assert.match(r.externalImageId, /^cal:ds-v1:subjA:daylight:/, "labelled externalImageId");
      const idx = calls.find((c) => c.target === "IndexFaces");
      assert.ok(idx, "IndexFaces was called");
      assert.equal(
        idx!.payload.CollectionId,
        "tirvea-faces-calibration-staging",
        "targets CAL collection",
      );
      assert.notEqual(
        idx!.payload.CollectionId,
        env.FACE_COLLECTION_ID,
        "never the prod collection",
      );
    });

    await check("enrollment refuses incomplete metadata (no anonymous enrollment)", async () => {
      goodEnv();
      assert.deepEqual(
        cal.validateCalibrationMeta({ subjectId: "x" }).length > 0,
        true,
        "missing fields are reported",
      );
      await assert.rejects(
        () => cal.enrollCalibrationSample(meta({ consentRef: "" }), Buffer.from("x")),
        /consentRef is required/,
      );
    });

    // ---- 3. cleanup ------------------------------------------------------
    await check("cleanup deletes indexed faces from the calibration collection", async () => {
      goodEnv();
      calls.length = 0;
      const c = await cal.cleanupCalibrationFaces(["cal-1", "cal-2"]);
      assert.equal(c.deleted, 2);
      const del = calls.find((x) => x.target === "DeleteFaces");
      assert.equal(del!.payload.CollectionId, "tirvea-faces-calibration-staging");
      // purge lists then deletes everything
      calls.length = 0;
      const p = await cal.purgeCalibrationCollection();
      assert.equal(p.deleted, 2);
      assert.ok(calls.some((x) => x.target === "ListFaces"));
      assert.ok(calls.some((x) => x.target === "DeleteFaces"));
    });

    // ---- 4. measured metrics + report + version stamping -----------------
    await check("measured confusion metrics are correct", () => {
      const rows: import("../src/lib/services/face-calibration-enroll").MetricRow[] = [
        { truth: "match", predicted: "accept" }, // TP
        { truth: "match", predicted: "reject" }, // FN
        { truth: "match", predicted: "review" }, // review
        { truth: "nonmatch", predicted: "accept" }, // FP (false accept)
        { truth: "nonmatch", predicted: "reject" }, // TN
        { truth: "nonmatch", predicted: "review" }, // review
      ];
      const m = cal.computeCalibrationMetrics(rows);
      assert.equal(m.tp, 1);
      assert.equal(m.fn, 1);
      assert.equal(m.fp, 1);
      assert.equal(m.tn, 1);
      assert.equal(m.reviews, 2);
      assert.equal(m.far, 0.3333); // 1/3
      assert.equal(m.frr, 0.3333);
      assert.equal(m.precision, 0.5); // 1/(1+1)
      assert.equal(m.recall, 0.3333);
      assert.equal(m.reviewRate, 0.3333);
    });

    await check("report is versioned + stamped (dataset/threshold/model/commit/timestamp)", () => {
      const report = cal.buildCalibrationReport({
        datasetVersion: "ds-v1",
        thresholdVersion: "v0",
        calibrationVersion: "cal-2026-07",
        modelVersion: "7.0",
        region: "eu-west-1",
        collection: "tirvea-faces-calibration-staging",
        generatedAt: "2026-07-17T10:00:00Z",
        gitCommit: "abc1234",
        rows: [
          {
            truth: "match",
            predicted: "accept",
            label: "daylight",
            device: "iPhone",
            demographic: "g1",
          },
          {
            truth: "nonmatch",
            predicted: "reject",
            label: "impostor",
            device: "Android",
            demographic: "g2",
          },
        ],
      });
      for (const f of [
        "datasetVersion",
        "thresholdVersion",
        "calibrationVersion",
        "modelVersion",
        "region",
        "collection",
        "generatedAt",
        "gitCommit",
      ] as const) {
        assert.ok(report[f], `report carries ${f}`);
      }
      assert.equal(report.modelVersion, "7.0");
      assert.equal(report.gitCommit, "abc1234");
      assert.ok(report.byLabel.daylight && report.byDevice.iPhone, "per-label + per-device slices");
      assert.equal(report.demographicFairnessAssessed, false, "not enough per-group samples");
    });

    // ---- 6. attempted production execution -------------------------------
    await check("attempted production execution is blocked at every entrypoint", async () => {
      goodEnv();
      env.FACE_ENVIRONMENT = "production";
      assert.throws(() => rek.assertCalibrationMode(), rek.CalibrationModeError);
      await assert.rejects(
        () => rek.calibrationIndexFace({ image: Buffer.from("x"), externalImageId: "cal:x" }),
        /production/,
      );
      await assert.rejects(
        () => cal.enrollCalibrationSample(meta(), Buffer.from("x")),
        /production/,
      );
      await assert.rejects(() => rek.calibrationDeleteFaces(["a"]), /production/);
    });

    // ---- 7. PRODUCTION BEHAVIOUR UNCHANGED -------------------------------
    await check("production createReference is STILL liveness-only (unchanged)", async () => {
      goodEnv();
      env.FACE_MATCH_PROVIDER = "aws_rekognition_faces";
      env.AWS_ACCESS_KEY_ID = "test";
      env.AWS_SECRET_ACCESS_KEY = "test";
      await assert.rejects(
        () =>
          rek.awsRekognitionProvider.createReference({
            userId: "x",
            selfieImage: Buffer.from("x"),
          }),
        /liveness-derived reference/,
        "static enrollment via the production path is still refused",
      );
    });

    await check("source: production paths never call the calibration index", async () => {
      const { readFileSync } = await import("node:fs");
      const worker = readFileSync("src/lib/services/face-verification.ts", "utf8");
      const registry = readFileSync("src/lib/services/face-reference-registry.ts", "utf8");
      assert.ok(
        !/calibrationIndexFace|assertCalibrationMode/.test(worker),
        "worker never enrolls calibration faces",
      );
      assert.ok(!/calibrationIndexFace/.test(registry), "registry never enrolls calibration faces");
    });
  } finally {
    rek.setRekognitionTransport(null);
    for (const [k, v] of Object.entries(SAVED)) {
      if (v === undefined) delete env[k];
      else env[k] = v;
    }
  }

  console.log(`\n${passed} checks passed`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
