/**
 * L9.6 - the CLAIMED-forever state-machine bug. A user whose AWS liveness PASSED
 * and whose reference ENROLLED (CONSUMED + referenceEnrolled) but who has no Stripe
 * identity (User.photoVerifiedAt = null) was stranded at ProfilePhotoVerification
 * status CLAIMED forever: runProfilePhotoVerification claimed the job, then bailed
 * on the identity precondition WITHOUT releasing the lease. This live test proves
 * the fix: a completed-liveness job always reaches a TERMINAL (never permanent
 * CLAIMED), without forcing another selfie, and grants NO public badge to a
 * non-identity-verified user. Live DB + in-process mock provider. Run:
 *   npx tsx tests/photo-verification-nonstripe.test.ts
 */
import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

process.env.AUTH_HASH_SALT = process.env.AUTH_HASH_SALT || "test-salt";
process.env.VERIFICATION_PROVIDER = "mock";
process.env.FACE_MATCH_PROVIDER = "mock";
process.env.FACE_LIVENESS_ENABLED = "1";

let passed = 0;
async function check(name: string, fn: () => Promise<void> | void): Promise<void> {
  await fn();
  passed += 1;
  console.log(`  ok - ${name}`);
}

const TERMINAL = new Set(["AUTO_VERIFIED", "MANUAL_REVIEW", "REJECTED", "SUSPENDED"]);

async function main() {
  const { db } = await import("../src/lib/db");
  const { runProfilePhotoVerification, setFaceImageLoader } = await import(
    "../src/lib/services/face-verification"
  );
  const { isPubliclyVerified } = await import("../src/lib/services/verification");
  const { enrollReference } = await import("./support/face-enroll");

  const uid = randomUUID();
  const email = `nonstripe-face-${Date.now().toString(36)}@example.com`;
  const now = new Date();

  // A registered, NON-Stripe user: photoVerifiedAt stays NULL (no identity layer).
  await db.user.create({
    data: {
      id: uid,
      email,
      name: "NonStripe Face",
      emailVerified: now,
      ageConfirmedAt: now,
      onboardingDone: true,
      // photoVerifiedAt intentionally omitted -> null (the crux of L9.6).
    },
  });
  const photo = await db.photo.create({
    data: {
      id: `ns${uid.slice(0, 8)}`,
      userId: uid,
      url: `/api/media/ns${uid.slice(0, 8)}/card`,
      position: 0,
      isCover: true,
      status: "ACTIVE",
      moderation: "APPROVED",
      storagePath: `users/${uid}/photos/cover`,
    },
  });
  // Mock provider reads marker bytes: "face:owner" -> the cover matches the reference.
  setFaceImageLoader(async () => Buffer.from("face:owner"));

  try {
    await check("precondition: non-Stripe user has no identity (photoVerifiedAt null)", async () => {
      const u = await db.user.findUniqueOrThrow({ where: { id: uid } });
      assert.equal(u.photoVerifiedAt, null);
    });

    await check("liveness enrols a usable reference -> job QUEUED (post-CONSUMED)", async () => {
      await enrollReference(uid);
      const job = await db.profilePhotoVerification.findUniqueOrThrow({ where: { userId: uid } });
      assert.equal(job.referenceStatus, "ACTIVE", "reference enrolled and ACTIVE");
      assert.ok(job.referenceId, "referenceId present (referenceEnrolled=true)");
      assert.notEqual(job.status, "CLAIMED");
    });

    await check("L9.6 FIX: runProfilePhotoVerification reaches a TERMINAL, never stuck CLAIMED", async () => {
      await runProfilePhotoVerification(uid);
      const job = await db.profilePhotoVerification.findUniqueOrThrow({ where: { userId: uid } });
      assert.notEqual(job.status, "CLAIMED", "must not be stranded CLAIMED (the L9.6 bug)");
      assert.notEqual(job.status, "QUEUED", "must have advanced past QUEUED");
      assert.ok(TERMINAL.has(job.status), `must be terminal, got ${job.status}`);
      // The lease must be released at the terminal.
      assert.equal(job.leaseToken, null, "lease released");
    });

    await check("video is NOT re-required: the reference survives (no fresh selfie)", async () => {
      const job = await db.profilePhotoVerification.findUniqueOrThrow({ where: { userId: uid } });
      assert.notEqual(job.status, "LIVENESS_REQUIRED", "must not demand another video");
      assert.equal(job.referenceStatus, "ACTIVE", "reference still usable");
    });

    await check("trust model intact: no PUBLIC badge without identity (photoVerifiedAt)", async () => {
      const u = await db.user.findUniqueOrThrow({ where: { id: uid } });
      assert.equal(u.photoVerifiedAt, null, "still no Stripe identity");
      assert.equal(isPubliclyVerified(u), false, "non-identity-verified user is NOT publicly verified");
    });

    console.log(`\n${passed} checks passed`);
  } finally {
    await db.photoFaceCheck.deleteMany({ where: { verification: { userId: uid } } }).catch(() => {});
    await db.livenessSession.deleteMany({ where: { userId: uid } }).catch(() => {});
    await db.faceReferenceRecord.deleteMany({ where: { userId: uid } }).catch(() => {});
    await db.verificationAuditEvent.deleteMany({ where: { userId: uid } }).catch(() => {});
    await db.profilePhotoVerification.deleteMany({ where: { userId: uid } }).catch(() => {});
    await db.photo.deleteMany({ where: { userId: uid } }).catch(() => {});
    await db.user.delete({ where: { id: uid } }).catch(() => {});
    void photo;
    await db.$disconnect();
  }
}

main().catch((error) => {
  console.error("FAIL:", error);
  process.exitCode = 1;
});
