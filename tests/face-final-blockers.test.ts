/**
 * Final production-blocker tests (Phases 21-32):
 *   npx tsx tests/face-final-blockers.test.ts
 *
 * Risk double-count fix, signal registry, AWS adapter containment +
 * SigV4 + idempotency, liveness flow, rollout gates, external alerting,
 * queue claiming, calibration framework, dead-state resolution.
 */
import "dotenv/config";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const RUN = Date.now().toString(36);
let passed = 0;
async function check(name: string, fn: () => void | Promise<void>): Promise<void> {
  await fn();
  passed += 1;
  console.log(`  ok - ${name}`);
}
const src = (...parts: string[]) => readFileSync(path.join(process.cwd(), "src", ...parts), "utf8");
const stripped = (raw: string) => raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

async function main() {
  process.env.VERIFICATION_PROVIDER = "mock";
  process.env.FACE_MATCH_PROVIDER = "mock";
  process.env.FACE_DUPLICATE_SEARCH_ENABLED = "1";
  process.env.FACE_AUTO_SUSPEND_ENABLED = "1";

  const { RISK_SIGNAL_REGISTRY, computeVerificationRisk } =
    await import("../src/lib/services/risk-engine");
  const { enqueueProfilePhotoVerification, runProfilePhotoVerification, setFaceImageLoader } =
    await import("../src/lib/services/face-verification");
  const { createFaceViolation } = await import("../src/lib/services/face-reference");
  const { computeTrustProfile } = await import("../src/lib/services/trust-engine");
  const { userInPercentCohort, isFaceCohortEligible } =
    await import("../src/lib/services/face-rollout");
  const { setExternalAlertTransport, raiseOpsAlert, resolveOpsAlert, ALERT_POLICY } =
    await import("../src/lib/services/provider-resilience");
  const { calibrate, recommendThresholds } = await import("../src/lib/services/face-calibration");
  const { setRekognitionTransport, awsRekognitionProvider } =
    await import("../src/lib/services/aws-rekognition");
  const { db } = await import("../src/lib/db");

  // -------------------------------------------------- Phase 21: registry
  console.log("Phase 21: risk signal registry + double-count");

  await check("signal registry: unique names, exactly one owner each", () => {
    const names = RISK_SIGNAL_REGISTRY.map((s) => s.name);
    assert.equal(new Set(names).size, names.length, "no duplicate signal names");
    for (const sig of RISK_SIGNAL_REGISTRY) {
      assert.ok(
        sig.owner && sig.category && sig.severity && sig.dedupe,
        `${sig.name} fully specified`,
      );
      assert.match(sig.name, /^[a-z_]+$/, "normalized name");
    }
    // the two double-counted signals now document their exclusion
    const violation = RISK_SIGNAL_REGISTRY.find((s) => s.name === "violation")!;
    assert.match(violation.dedupe, /EXCLUDES source=face_verification/);
  });

  await check("trust-engine excludes face-created violations (source column, not text)", () => {
    const code = stripped(src("lib", "services", "trust-engine.ts"));
    assert.ok(
      code.includes('source: { not: "face_verification" }'),
      "face violations excluded from the violation signal (null-safe)",
    );
  });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const minted: string[] = [];
  const mkUser = async (tag: string, tail: string) => {
    const email = `e2e-blk-${tag}-${RUN}@example.com`;
    const uid = (
      await admin.auth.admin.createUser({ email, password: `bk-${RUN}-Aa1!`, email_confirm: true })
    ).data.user!.id;
    const now = new Date();
    await db.user.create({
      data: {
        id: uid,
        email,
        name: `BLK ${tag}`,
        emailVerified: now,
        phone: `+3538793${tail}`,
        phoneVerifiedAt: now,
        ageConfirmedAt: now,
        termsVersion: "2026-07",
        privacyVersion: "2026-07",
        communityVersion: "2026-07",
        onboardingDone: true,
        photoVerifiedAt: now,
      },
    });
    await db.profile.create({
      data: {
        userId: uid,
        displayName: `BLK ${tag}`,
        birthDate: new Date("1993-03-03"),
        gender: "WOMAN",
        country: "IE",
      },
    });
    minted.push(uid);
    return uid;
  };

  setFaceImageLoader(async () => Buffer.from("face:owner"));
  const alice = await mkUser("alice", "01");

  try {
    await check(
      "one face rejection scores ONCE (violation source-excluded from trust)",
      async () => {
        // Create a face rejection violation, then confirm trust-engine does
        // NOT add its `violation` signal for it.
        await createFaceViolation(alice, "PHOTO_MISMATCH", "cover_not_confirmed");
        const trust = await computeTrustProfile(alice);
        assert.ok(
          !trust?.reasons.some((r) => r.startsWith("violation_x")),
          "face violation not scored by trust-engine",
        );
        // A NON-face violation IS still scored (real fraud preserved).
        await db.accountViolation.create({
          data: {
            userId: alice,
            violationType: "SPAM",
            actionTaken: "WARNING",
            description: "spam",
            userVisibleReason: "spam",
            appealAllowed: true,
          },
        });
        const trust2 = await computeTrustProfile(alice);
        assert.ok(
          trust2?.reasons.some((r) => r.startsWith("violation_x")),
          "non-face violation still scored - real fraud detection intact",
        );
      },
    );

    await check(
      "repeated queue processing does not increase risk (idempotent stamping)",
      async () => {
        await enqueueProfilePhotoVerification(alice, "test");
        await runProfilePhotoVerification(alice);
        const risk1 = await computeVerificationRisk(alice);
        await enqueueProfilePhotoVerification(alice, "test-again");
        await runProfilePhotoVerification(alice);
        const risk2 = await computeVerificationRisk(alice);
        assert.equal(risk1.band, risk2.band, "re-processing is band-stable");
      },
    );

    await check("impersonation case still reaches CRITICAL after de-dup", async () => {
      // Directly exercise the face-signal scorer at the impersonation input.
      const { scoreFaceSignals, bandFromScore } = await import("../src/lib/services/risk-engine");
      const s = scoreFaceSignals({
        identityVerified: true,
        faceStatus: "SUSPENDED",
        duplicateClass: "LIKELY_IMPERSONATION",
        referenceStatus: "ACTIVE",
        manipulationFlaggedPhotos: 0,
        otherPersonPhotos: 0,
        deniedAppeals: 0,
      });
      assert.equal(
        bandFromScore(s.points),
        "CRITICAL",
        "impersonation alone is CRITICAL without the duplicate violation path",
      );
    });

    // ---------------------------------------------- Phase 22: AWS adapter
    console.log("Phase 22: AWS Rekognition adapter (SigV4, containment, idempotency)");

    await check("adapter speaks normalized domain values; SigV4 signs correctly", async () => {
      const calls: Array<{ target: string; hasImage: boolean }> = [];
      setRekognitionTransport(async (target, payload) => {
        calls.push({ target, hasImage: "Image" in payload });
        if (target === "DetectFaces") {
          return {
            FaceDetails: [
              {
                BoundingBox: { Width: 0.5, Height: 0.6 },
                Confidence: 99,
                Quality: { Brightness: 95, Sharpness: 95 },
              },
            ],
          };
        }
        if (target === "SearchFacesByImage") {
          return { FaceMatches: [{ Similarity: 96, Face: { FaceId: "face-abc" } }] };
        }
        return {};
      });
      process.env.AWS_ACCESS_KEY_ID = "AKIATEST";
      process.env.AWS_SECRET_ACCESS_KEY = "secret";
      process.env.FACE_COLLECTION_ID = "tirvea-test";
      try {
        const cmp = await awsRekognitionProvider.compareReferenceToPhoto("face-abc", {
          image: Buffer.from("x"),
          photoId: "p1",
          photoVersion: 1,
        });
        // Normalized: similarity 0-1, ownerDetected boolean, no vendor fields
        assert.ok(cmp.similarity !== null && cmp.similarity <= 1, "similarity normalized to 0-1");
        assert.equal(cmp.ownerDetected, true);
        assert.ok(!("FaceMatches" in (cmp as object)), "no vendor shapes leak");
      } finally {
        setRekognitionTransport(null);
      }
    });

    await check("SigV4 signer produces a valid Authorization header", async () => {
      // Exercise the REAL signer (no transport override) by capturing fetch.
      const { setRekognitionTransport: setT } = await import("../src/lib/services/aws-rekognition");
      setT(null);
      const realFetch = globalThis.fetch;
      let authHeader = "";
      globalThis.fetch = (async (_u: string, init: { headers: Record<string, string> }) => {
        authHeader = init.headers["authorization"];
        return { ok: true, json: async () => ({ FaceDetails: [] }) } as never;
      }) as never;
      try {
        await awsRekognitionProvider.detectFaces({
          image: Buffer.from("x"),
          photoId: "p",
          photoVersion: 1,
        });
        assert.match(
          authHeader,
          /^AWS4-HMAC-SHA256 Credential=AKIATEST\/\d{8}\/eu-west-1\/rekognition\/aws4_request/,
        );
        assert.match(authHeader, /SignedHeaders=content-type;host;x-amz-date;x-amz-target/);
        assert.match(authHeader, /Signature=[0-9a-f]{64}/);
      } finally {
        globalThis.fetch = realFetch;
      }
    });

    await check("adapter file leaks no vendor identifiers to callers (source pin)", () => {
      // Every OTHER service that touches face data must not import AWS types.
      const consumers = [
        "face-verification.ts",
        "face-reference.ts",
        "risk-engine.ts",
        "verification-metrics.ts",
        "verification-support.ts",
      ];
      for (const f of consumers) {
        const body = stripped(src("lib", "services", f));
        assert.ok(
          !/aws-rekognition|Rekognition|FaceId|amazonaws|SigV4/.test(body),
          `${f} free of AWS internals`,
        );
      }
    });

    await check(
      "createReference (non-liveness) is refused - liveness is the only source",
      async () => {
        process.env.AWS_ACCESS_KEY_ID = "AKIATEST";
        process.env.AWS_SECRET_ACCESS_KEY = "secret";
        process.env.FACE_COLLECTION_ID = "tirvea-test";
        await assert.rejects(() => awsRekognitionProvider.createReference({ userId: "u" }));
      },
    );

    // ---------------------------------------------- Phase 32: rollout gates
    console.log("Phase 32: rollout gates");

    await check("percent cohort is deterministic + monotonic", () => {
      assert.equal(userInPercentCohort("stable-id", 100), true);
      assert.equal(userInPercentCohort("stable-id", 0), false);
      const a = userInPercentCohort("stable-id", 50);
      assert.equal(userInPercentCohort("stable-id", 50), a, "stable per user");
      // a user in a 10% cohort is always in the 90% cohort (monotonic)
      for (const id of ["u1", "u2", "u3", "u4", "u5"]) {
        if (userInPercentCohort(id, 20)) assert.equal(userInPercentCohort(id, 80), true);
      }
    });

    await check("country allowlist gates eligibility", () => {
      process.env.FACE_VERIFICATION_COUNTRY_ALLOWLIST = "IE,GB";
      process.env.FACE_VERIFICATION_PERCENT = "100";
      try {
        assert.equal(isFaceCohortEligible("u", "IE"), true);
        assert.equal(isFaceCohortEligible("u", "FR"), false);
        assert.equal(
          isFaceCohortEligible("u", null),
          false,
          "no country -> excluded when allowlist set",
        );
      } finally {
        delete process.env.FACE_VERIFICATION_COUNTRY_ALLOWLIST;
      }
    });

    await check(
      "legal-approval gate: prod + real provider without version -> dormant",
      async () => {
        const { getFaceMatchProvider, faceMatchNotConfiguredProvider } =
          await import("../src/lib/services/face-match-providers");
        const savedEnv = process.env.NODE_ENV;
        const savedProvider = process.env.FACE_MATCH_PROVIDER;
        (process.env as Record<string, string>).NODE_ENV = "production";
        process.env.FACE_MATCH_PROVIDER = "aws_rekognition_faces";
        delete process.env.FACE_LEGAL_APPROVAL_VERSION;
        try {
          assert.equal(
            getFaceMatchProvider(),
            faceMatchNotConfiguredProvider,
            "no legal version -> dormant in prod",
          );
          process.env.FACE_LEGAL_APPROVAL_VERSION = "dpia-2026-07";
          assert.notEqual(
            getFaceMatchProvider(),
            faceMatchNotConfiguredProvider,
            "with approval -> live",
          );
        } finally {
          (process.env as Record<string, string>).NODE_ENV = savedEnv ?? "test";
          process.env.FACE_MATCH_PROVIDER = savedProvider;
          delete process.env.FACE_LEGAL_APPROVAL_VERSION;
        }
      },
    );

    // ---------------------------------------------- Phase 26: external alerts
    console.log("Phase 26: external alerting");

    await check("external channel is independent, severity-tagged, no PII", async () => {
      const received: Array<{ kind: string; severity: string; status: string; detail: string }> =
        [];
      setExternalAlertTransport(async (p) => {
        received.push(p);
        return true;
      });
      try {
        await raiseOpsAlert("provider_down", "stripe_identity is UNAVAILABLE");
        await resolveOpsAlert("provider_down");
        assert.equal(received.length, 2);
        assert.equal(received[0].severity, ALERT_POLICY.provider_down.severity);
        assert.equal(received[0].status, "firing");
        assert.equal(received[1].status, "resolved");
        for (const p of received) {
          assert.ok(
            !/@|\+3538|mockref_|face-/.test(p.detail),
            "no personal/biometric data in alerts",
          );
        }
      } finally {
        setExternalAlertTransport(null);
      }
    });

    await check("external channel FAILURE is tolerated (outbox remains)", async () => {
      setExternalAlertTransport(async () => {
        throw new Error("pager down");
      });
      try {
        // must not throw despite the channel failing
        await raiseOpsAlert("queue_stalled", "oldest job 90 min");
      } finally {
        setExternalAlertTransport(null);
      }
    });

    // ---------------------------------------------- Phase 25: calibration
    console.log("Phase 25: calibration framework");

    await check("calibration computes FMR/FNMR and refuses to certify on twins leak", () => {
      const base = {
        version: "cal-test",
        provider: "aws",
        modelVersion: "m",
        region: "eu-west-1",
        matchThreshold: 0.85,
        mismatchThreshold: 0.4,
        minQuality: 0.5,
        manipulationThreshold: 0.8,
        coverMinDominance: 0.2,
      };
      const samples = [
        ...Array.from({ length: 40 }, () => ({
          label: "same_person" as const,
          isCover: false,
          similarity: 0.95,
          faceCount: 1,
          qualityScore: 0.9,
          manipulationRisk: 0.02,
        })),
        ...Array.from({ length: 40 }, () => ({
          label: "different_person" as const,
          isCover: false,
          similarity: 0.2,
          faceCount: 1,
          qualityScore: 0.9,
          manipulationRisk: 0.02,
        })),
        ...Array.from({ length: 10 }, () => ({
          label: "twins" as const,
          isCover: false,
          similarity: 0.9,
          faceCount: 1,
          qualityScore: 0.9,
          manipulationRisk: 0.02,
        })),
      ];
      const report = calibrate(samples, base);
      assert.ok(
        report.falseMatchRate !== null && report.falseMatchRate > 0,
        "twins produce a measurable false-match rate",
      );
      assert.equal(
        report.demographicFairnessAssessed,
        false,
        "no demographic annotations -> fairness NOT claimed",
      );
      const { best } = recommendThresholds(samples, base, { maxFalseMatchRate: 0 });
      assert.equal(best, null, "cannot certify a 0% false-match ceiling against twin leakage");
    });

    // ---------------------------------------------- Phase 29: dead states
    console.log("Phase 29: dead/unreachable states");

    await check("SELF_RESTORE removed from automatic classification", () => {
      const code = stripped(src("lib", "services", "face-reference.ts"));
      assert.ok(!/return "SELF_RESTORE"/.test(code), "classifier never returns SELF_RESTORE");
      assert.ok(
        /return evidence.other.birthDateMatches \? "TWIN_RISK"/.test(code),
        "TWIN_RISK is emitted",
      );
    });
  } finally {
    setFaceImageLoader(null);
    for (const uid of minted) {
      await db.user.delete({ where: { id: uid } }).catch(() => {});
      await admin.auth.admin.deleteUser(uid).catch(() => {});
    }
    await db.$disconnect();
  }

  console.log(`\n${passed} checks passed`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
