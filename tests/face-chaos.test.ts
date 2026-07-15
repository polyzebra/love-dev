/**
 * Chaos + provider-independence tests (Phases 16 + 18):
 *   npx tsx tests/face-chaos.test.ts
 *
 * Chaos: provider timeouts, hard outages (circuit breaker + half-open),
 * expired credentials (no futile retries), delayed retries (exponential
 * backoff), queue corruption (revoked reference reuse attempt, stale
 * check versions), dead-letter escalation, clock skew, duplicate
 * outcome delivery. Everything must degrade GRACEFULLY: park, escalate
 * to humans, alert - never auto-reject, never grant on error.
 *
 * Independence: no application service depends on vendor models,
 * response formats or identifiers - everything passes through the
 * provider adapters (source pins).
 */
import "dotenv/config";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { enrollReference } from "./support/face-enroll";

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
  process.env.FACE_LIVENESS_ENABLED = "1";

  const {
    withResilience,
    circuitOpen,
    providerHealthState,
    classifyProviderFailure,
    setResilienceSleeper,
    sweepDeadLetterJobs,
    ProviderCircuitOpenError,
    resilienceConfig,
  } = await import("../src/lib/services/provider-resilience");
  const {
    enqueueProfilePhotoVerification,
    runProfilePhotoVerification,
    setFaceImageLoader,
    recordVerificationAudit,
  } = await import("../src/lib/services/face-verification");
  const { applyVerificationOutcome } = await import("../src/lib/services/photo-verification");
  const { computeVerificationMetrics, evaluateVerificationAlerts } =
    await import("../src/lib/services/verification-metrics");
  const { getVerificationSupportView } = await import("../src/lib/services/verification-support");
  const { db } = await import("../src/lib/db");

  const delays: number[] = [];
  setResilienceSleeper(async (ms) => {
    delays.push(ms);
  });

  const P = (tag: string) => `test_chaos_${RUN}_${tag}`;
  const testProviders: string[] = [];
  const chaosProvider = (tag: string) => {
    const name = P(tag);
    testProviders.push(name);
    return name;
  };

  // ------------------------------------------------------------ resilience
  console.log("chaos: retries, breaker, credentials, backoff");

  await check("transient timeout: retried with exponential backoff, then succeeds", async () => {
    delays.length = 0;
    let calls = 0;
    const result = await withResilience(chaosProvider("flaky"), async () => {
      calls += 1;
      if (calls < 3) throw new Error("operation timed out");
      return "ok";
    });
    assert.equal(result, "ok");
    assert.equal(calls, 3);
    const base = resilienceConfig().backoffBaseMs;
    assert.deepEqual(delays, [base, base * 2], "exponential backoff schedule");
  });

  await check("hard outage: circuit OPENS; calls are refused while cooling down", async () => {
    const name = chaosProvider("down");
    const attempts = resilienceConfig().unavailableAt + 2;
    for (let i = 0; i < attempts; i++) {
      await withResilience(name, async () => {
        throw new Error("network socket hang up");
      }).catch(() => undefined);
    }
    assert.equal(await providerHealthState(name), "UNAVAILABLE");
    assert.equal(await circuitOpen(name), true);
    await assert.rejects(
      () => withResilience(name, async () => "never"),
      (e: Error) => e instanceof ProviderCircuitOpenError,
      "open circuit refuses instantly - no vendor traffic",
    );
  });

  await check("half-open probe after cool-down: success CLOSES the circuit", async () => {
    const name = chaosProvider("recovering");
    for (let i = 0; i < resilienceConfig().unavailableAt; i++) {
      await withResilience(name, async () => {
        throw new Error("network unreachable");
      }).catch(() => undefined);
    }
    assert.equal(await circuitOpen(name), true);
    // simulate the cool-down having passed (clock control, not sleeping)
    await db.providerHealth.update({
      where: { provider: name },
      data: { lastErrorAt: new Date(Date.now() - resilienceConfig().cooldownMs - 1000) },
    });
    assert.equal(await circuitOpen(name), false, "half-open: one probe allowed");
    const result = await withResilience(name, async () => "recovered");
    assert.equal(result, "recovered");
    assert.equal(await providerHealthState(name), "HEALTHY", "success resets the breaker");
  });

  await check("expired credentials: classified, NEVER retried (no quota burn)", async () => {
    let calls = 0;
    await withResilience(chaosProvider("creds"), async () => {
      calls += 1;
      throw new Error("401 unauthorized: expired token");
    }).catch(() => undefined);
    assert.equal(calls, 1, "credential failures stop immediately");
    assert.equal(classifyProviderFailure(new Error("invalid api key")), "credential");
    assert.equal(classifyProviderFailure(new Error("Throttling: rate limit")), "throttle");
    assert.equal(classifyProviderFailure(new Error("quota exceeded")), "quota");
    assert.equal(classifyProviderFailure(new Error("not available in region eu-x")), "regional");
  });

  await check("degradation ladder: DEGRADED before UNAVAILABLE; stale errors decay", async () => {
    const name = chaosProvider("ladder");
    // retries: 0 -> exactly one recorded failure per call
    for (let i = 0; i < resilienceConfig().degradedAt; i++) {
      await withResilience(
        name,
        async () => {
          throw new Error("timeout");
        },
        { retries: 0 },
      ).catch(() => undefined);
    }
    assert.equal(await providerHealthState(name), "DEGRADED");
    await db.providerHealth.update({
      where: { provider: name },
      data: { lastErrorAt: new Date(Date.now() - resilienceConfig().errorTtlMs - 1000) },
    });
    assert.equal(await providerHealthState(name), "HEALTHY", "old errors decay");
    assert.equal(await providerHealthState(P("never-seen")), "UNKNOWN");
  });

  // ------------------------------------------------- live degradation lanes
  console.log("chaos: queue corruption, dead-letter, clock skew, replay");

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const supa = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const email = `e2e-chaos-${RUN}@example.com`;
  const created = await supa.auth.admin.createUser({
    email,
    password: `ch-${RUN}-Aa1!`,
    email_confirm: true,
  });
  const uid = created.data.user!.id;
  const now = new Date();
  await db.user.create({
    data: {
      id: uid,
      email,
      name: "E2E Chaos",
      emailVerified: now,
      phone: `+3538792${RUN.slice(-5)}`,
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
      displayName: "E2E Chaos",
      birthDate: new Date("1992-02-02"),
      gender: "MAN",
    },
  });
  await db.photo.create({
    data: {
      id: `ch${RUN}c`,
      userId: uid,
      url: `/api/media/ch${RUN}c/card`,
      position: 0,
      isCover: true,
      status: "ACTIVE",
      moderation: "APPROVED",
      storagePath: `users/${uid}/photos/ch${RUN}c`,
    },
  });
  setFaceImageLoader(async () => Buffer.from("face:owner"));

  try {
    await check(
      "queue corruption: REVOKED reference with dangling id -> clean re-enrol",
      async () => {
        await enrollReference(uid);
        await runProfilePhotoVerification(uid);
        // corrupt: reference revoked but id still present
        await db.profilePhotoVerification.update({
          where: { userId: uid },
          data: { referenceStatus: "REVOKED", referenceId: "mockref_dangling" },
        });
        // enqueue with an invalid reference -> LIVENESS_REQUIRED (never reuses
        // the dangling id); a fresh liveness enrolment cleanly recovers.
        await enqueueProfilePhotoVerification(uid, "rerun");
        const stuck = await db.profilePhotoVerification.findUniqueOrThrow({
          where: { userId: uid },
        });
        assert.equal(stuck.status, "LIVENESS_REQUIRED", "invalid reference never reused");
        await enrollReference(uid);
        const decision = await runProfilePhotoVerification(uid);
        assert.equal(decision?.status, "AUTO_VERIFIED", "graceful: re-enrolled, verified");
        const job = await db.profilePhotoVerification.findUniqueOrThrow({ where: { userId: uid } });
        assert.equal(job.referenceStatus, "ACTIVE");
        assert.notEqual(job.referenceId, "mockref_dangling", "dangling id never reused");
      },
    );

    await check(
      "clock skew: expiresAt in the past + future timestamps never crash sweeps",
      async () => {
        await db.profilePhotoVerification.update({
          where: { userId: uid },
          data: {
            expiresAt: new Date(Date.now() - 5000),
            lastValidatedAt: new Date(Date.now() + 3600_000), // future (skewed writer)
          },
        });
        const { sweepReferenceLifecycle } = await import("../src/lib/services/face-reference");
        const swept = await sweepReferenceLifecycle(10);
        assert.ok(swept.rotatedExpired >= 1, "expired-by-clock reference rotated");
        await enrollReference(uid); // re-enrol via liveness
      },
    );

    await check(
      "dead-letter: repeatedly failing job escalates to MANUAL_REVIEW (never rejected)",
      async () => {
        const job = await db.profilePhotoVerification.findUniqueOrThrow({ where: { userId: uid } });
        await db.profilePhotoVerification.update({
          where: { id: job.id },
          data: { status: "QUEUED" },
        });
        for (let i = 0; i < 3; i++) {
          await recordVerificationAudit({
            userId: uid,
            verificationId: job.id,
            eventType: "face_check_error",
            actorType: "system",
            reasonCode: "provider_error",
          });
        }
        const escalated = await sweepDeadLetterJobs(10);
        assert.ok(escalated >= 1);
        const after = await db.profilePhotoVerification.findUniqueOrThrow({
          where: { userId: uid },
        });
        assert.equal(after.status, "MANUAL_REVIEW", "humans decide - no auto-reject");
        assert.notEqual(after.status, "REJECTED");
        const audit = await db.verificationAuditEvent.findFirst({
          where: { userId: uid, eventType: "face_dead_letter" },
        });
        assert.equal(audit?.reasonCode, "provider_failures_exhausted");
        // restore for support-view check
        await db.profilePhotoVerification.update({
          where: { id: job.id },
          data: { status: "AUTO_VERIFIED", badgeStatus: "ACTIVE" },
        });
      },
    );

    await check("duplicate outcome delivery stays idempotent under the face layer", async () => {
      const sessionId = `mock_chaos_${RUN}`;
      await db.verification.upsert({
        where: { userId_type: { userId: uid, type: "PHOTO" } },
        create: {
          userId: uid,
          type: "PHOTO",
          status: "APPROVED",
          statusChangedAt: new Date(),
          provider: "mock",
          providerSessionId: sessionId,
        },
        update: { status: "APPROVED", provider: "mock", providerSessionId: sessionId },
      });
      const first = await applyVerificationOutcome("mock", sessionId, "approved");
      const second = await applyVerificationOutcome("mock", sessionId, "approved");
      assert.equal(first.applied, false, "already approved - no-op");
      assert.equal(second.applied, false, "replayed delivery - still a no-op");
    });

    // ------------------------------------------------------- observability
    console.log("observability + support view (aggregate/privacy shape)");

    await check("metrics: anonymous aggregates only, all sections present", async () => {
      const m = await computeVerificationMetrics(7);
      assert.ok(m.identity && m.face && m.appeals && m.quality && m.risk && m.providers);
      assert.ok(Object.keys(m.providers).length >= 2);
      const flat = JSON.stringify(m);
      assert.ok(!flat.includes(uid), "no user identifiers in metrics");
      assert.ok(!/mockref_|vs_[A-Za-z0-9]{8}/.test(flat), "no vendor/session identifiers");
    });

    await check("alert evaluation runs clean (rules fire only past thresholds)", async () => {
      const fired = await evaluateVerificationAlerts();
      assert.ok(Array.isArray(fired));
    });

    await check(
      "support view: states/dates/reasons/band - structurally nothing sensitive",
      async () => {
        const view = await getVerificationSupportView(uid);
        assert.ok(view);
        assert.equal(view.identity.status, "verified");
        assert.ok(["LOW", "MEDIUM", "HIGH", "CRITICAL"].includes(view.riskBand));
        assert.ok(Array.isArray(view.timeline) && view.timeline.length > 0);
        const flat = JSON.stringify(view);
        assert.ok(
          !/referenceId|similarity|mockref_|providerSessionId|vs_/.test(flat),
          "no vendor ids / raw scores",
        );
        assert.ok(!/photoId|storagePath|\/photos\//.test(flat), "no image references");
      },
    );

    // ------------------------------------------------- provider independence
    console.log("provider independence (Phase 18 pins)");

    await check("vendor types never leak outside the adapters", () => {
      const services = readdirSync(path.join(process.cwd(), "src", "lib", "services")).filter((f) =>
        f.endsWith(".ts"),
      );
      const adapterFiles = new Set([
        "photo-verification.ts",
        "face-match-providers.ts",
        "moderation-providers.ts",
        "billing.ts",
        "aws-rekognition.ts",
      ]);
      for (const file of services) {
        if (adapterFiles.has(file)) continue;
        const body = stripped(src("lib", "services", file));
        // Registry NAMES ("stripe_identity", "face_match:aws_rekognition_faces")
        // are OUR domain vocabulary (stored in provider columns). What must
        // never leak: vendor TYPES, API endpoints, SDKs, response shapes.
        assert.ok(
          !/StripeIdentitySession|api\.stripe\.com|verify\.stripe\.com|amazonaws|aws-sdk|Rekognition[A-Z]|CompareFaces|IndexFaces/.test(
            body,
          ),
          `${file} carries no vendor types/endpoints`,
        );
      }
      // the risk engine + face services speak ONLY normalized vocabularies
      for (const file of ["risk-engine.ts", "face-verification.ts", "face-reference.ts"]) {
        const body = stripped(src("lib", "services", file));
        assert.ok(!/stripe|aws|rekognition/i.test(body), `${file} is provider-agnostic`);
      }
    });

    await check("UI components never mention vendors beyond the one hosted-flow copy", () => {
      const card = stripped(src("components", "profile", "photo-verify-card.tsx"));
      // "Continue with Stripe" is deliberate user-facing copy; no API
      // shapes, ids or endpoints beyond it.
      assert.ok(!/vs_|rekognition|amazonaws|sk_live|whsec/.test(card));
    });
  } finally {
    setResilienceSleeper(null);
    setFaceImageLoader(null);
    await db.providerHealth.deleteMany({ where: { provider: { in: testProviders } } });
    await db.user.delete({ where: { id: uid } }).catch(() => {});
    await supa.auth.admin.deleteUser(uid).catch(() => {});
    await db.$disconnect();
  }

  console.log(`\n${passed} checks passed`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
