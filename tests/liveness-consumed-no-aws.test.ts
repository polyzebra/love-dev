/**
 * L9.9 - after a liveness session is CONSUMED, no code path may call
 * GetFaceLivenessSessionResults again (AWS discards the session -> the call throws
 * SessionNotFoundException, which the diagnostic surfaced as lastSafeErrorCode).
 * The only offending caller was the admin diagnostic, which read AWS
 * unconditionally. This proves: a CONSUMED session's diagnostic reads LOCAL state
 * only (never AWS), returns the stored terminal profilePhotoStatus, and the poll
 * path returns the terminal state (not provider_unavailable) on SessionNotFound.
 * Live DB + source guards. Run:  npx tsx tests/liveness-consumed-no-aws.test.ts
 */
import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

process.env.AUTH_HASH_SALT = process.env.AUTH_HASH_SALT || "test-salt";
process.env.FACE_MATCH_PROVIDER = "mock";
process.env.FACE_LIVENESS_ENABLED = "1";

let passed = 0;
async function check(name: string, fn: () => Promise<void> | void): Promise<void> {
  await fn();
  passed += 1;
  console.log(`  ok - ${name}`);
}

const SVC = "src/lib/services/face-liveness.ts";
const read = (p: string) => readFileSync(p, "utf8");

function main2SourceGuards(): void {
  const src = read(SVC);

  // The diagnostic must gate the AWS read on an in-flight (not consumed) session.
  const diagAt = src.indexOf("export async function getLivenessFlowDiagnostic");
  const diag = src.slice(diagAt);
  assert.match(diag, /const inFlight =\s*\n?\s*!consumed/, "diagnostic computes inFlight = !consumed");
  const gate = diag.indexOf("if (inFlight && provider.getLivenessResult)");
  assert.notEqual(gate, -1, "AWS read is gated behind inFlight");
  passed += 1;
  console.log("  ok - diagnostic reads AWS ONLY while in-flight (never after CONSUMED)");

  // consumeLivenessFlow: the CONSUMED early-return precedes the AWS call.
  const consumedReturn = src.indexOf('session.status === "CONSUMED"');
  const awsCall = src.indexOf("await provider.getLivenessResult(session.sessionId)");
  assert.ok(consumedReturn !== -1 && awsCall !== -1 && consumedReturn < awsCall,
    "CONSUMED must return before the poll's getLivenessResult call");
  passed += 1;
  console.log("  ok - poll returns on CONSUMED before ever calling getLivenessResult");

  // SessionNotFound after consumption -> terminal state, never provider_unavailable.
  assert.match(src, /SessionNotFound/i, "poll handles SessionNotFound explicitly");
  const snf = src.indexOf("/SessionNotFound/i.test(msg)");
  assert.notEqual(snf, -1, "poll branches on a SessionNotFound test");
  const near = src.slice(snf, snf + 400);
  assert.match(near, /checking_profile_photos/, "SessionNotFound-after-consumed resumes the terminal state");
  passed += 1;
  console.log("  ok - SessionNotFound after CONSUMED resumes terminal state, not provider_unavailable");
}

async function main() {
  main2SourceGuards();

  const { db } = await import("../src/lib/db");
  const { getLivenessFlowDiagnostic } = await import("../src/lib/services/face-liveness");
  const { faceEnvironment } = await import("../src/lib/services/face-rollout");

  const uid = randomUUID();
  const env = faceEnvironment();
  const now = new Date();

  await db.user.create({
    data: { id: uid, email: `l99-${uid.slice(0, 8)}@example.com`, emailVerified: now },
  });
  const job = await db.profilePhotoVerification.create({
    data: {
      userId: uid,
      provider: "mock",
      status: "MANUAL_REVIEW", // a STORED terminal outcome
      referenceId: `ref-${uid.slice(0, 8)}`,
      referenceStatus: "ACTIVE",
      consentVersion: "x",
      consentAt: now,
    },
  });
  await db.faceReferenceRecord.create({
    data: {
      userId: uid,
      verificationId: job.id,
      environment: env,
      referenceVersion: 1,
      status: "LINKED",
      externalFaceId: `ext-${uid.slice(0, 8)}`,
      externalImageId: `img-${uid.slice(0, 8)}`,
      idempotencyKey: `idem-${uid.slice(0, 8)}`,
      provider: "mock",
    },
  });
  await db.livenessSession.create({
    data: {
      sessionId: `sess-${uid.slice(0, 8)}`,
      userId: uid,
      verificationId: job.id,
      provider: "mock",
      environment: env,
      status: "CONSUMED", // already consumed - AWS would 404 a GetFaceLivenessSessionResults
      consumedAt: now,
      attemptNumber: 1,
      flowId: `flow-${uid}`,
      expiresAt: new Date(now.getTime() - 60_000), // also past-TTL, like production
    },
  });

  try {
    await check("CONSUMED diagnostic reads LOCAL state only - never calls AWS", async () => {
      const d = await getLivenessFlowDiagnostic(uid);
      assert.ok(d, "diagnostic returns a snapshot");
      assert.equal(d!.consumed, true);
      // providerStatus starts with "local:" ONLY when the AWS read was skipped.
      // If GetFaceLivenessSessionResults had run, it would be an AWS status.
      assert.match(d!.providerStatus ?? "", /^local:/, "provider status is local, not an AWS call");
      // No AWS call -> no SessionNotFoundException surfaced.
      assert.equal(d!.lastSafeErrorCode, null, "no SessionNotFound after CONSUMED");
    });

    await check("diagnostic returns the STORED terminal state (MANUAL_REVIEW), not AWS", async () => {
      const d = await getLivenessFlowDiagnostic(uid);
      assert.equal(d!.profilePhotoStatus, "MANUAL_REVIEW");
      assert.equal(d!.referenceEnrolled, true);
    });

    console.log(`\n${passed} checks passed`);
  } finally {
    await db.faceReferenceRecord.deleteMany({ where: { userId: uid } }).catch(() => {});
    await db.livenessSession.deleteMany({ where: { userId: uid } }).catch(() => {});
    await db.profilePhotoVerification.deleteMany({ where: { userId: uid } }).catch(() => {});
    await db.user.delete({ where: { id: uid } }).catch(() => {});
    await db.$disconnect();
  }
}

main().catch((error) => {
  console.error("FAIL:", error);
  process.exitCode = 1;
});
