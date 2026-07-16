/**
 * Consent withdrawal end-to-end (Phase 6). A verified user turns OFF face
 * comparison -> consent cleared, no new jobs admitted, pending jobs no-op,
 * provider reference deleted (with retry on outage), badge hidden, identity
 * verdict intact, re-consent re-enrolls, duplicate withdrawal safe.
 * Live lane (Prisma + mock provider + injected image loader). Run with:
 *   npx tsx tests/face-consent-withdrawal.test.ts
 */
import "dotenv/config";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { enrollReference } from "./support/face-enroll";

const RUN = Date.now().toString(36);
let passed = 0;
async function check(name: string, fn: () => Promise<void>): Promise<void> {
  await fn();
  passed += 1;
  console.log(`  ok - ${name}`);
}

async function main() {
  process.env.VERIFICATION_PROVIDER = "mock";
  process.env.FACE_MATCH_PROVIDER = "mock";
  process.env.FACE_LIVENESS_ENABLED = "1";
  delete process.env.FACE_EMERGENCY_DISABLE;
  delete process.env.FACE_VERIFICATION_PERCENT;

  const { db } = await import("../src/lib/db");
  const {
    withdrawFaceConsent,
    runProfilePhotoVerification,
    enqueueProfilePhotoVerification,
    setFaceImageLoader,
  } = await import("../src/lib/services/face-verification");
  const { admitToFaceVerification } = await import("../src/lib/services/face-rollout");
  const { isPubliclyVerified } = await import("../src/lib/services/verification");
  const { mockFaceMatchProvider } = await import("../src/lib/services/face-match-providers");

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  setFaceImageLoader(async () => Buffer.from("face:owner"));
  const minted: string[] = [];

  async function verifiedUser(tag: string): Promise<string> {
    const email = `cw-${tag}-${RUN}@example.com`;
    const uid = (
      await admin.auth.admin.createUser({ email, password: `cw-${RUN}-Aa1!`, email_confirm: true })
    ).data.user!.id;
    minted.push(uid);
    const now = new Date();
    await db.user.create({
      data: { id: uid, email, emailVerified: now, onboardingDone: true, photoVerifiedAt: now },
    });
    await db.profile.create({
      data: {
        userId: uid,
        displayName: `CW ${tag}`,
        birthDate: new Date("1994-04-04"),
        gender: "WOMAN",
      },
    });
    await db.photo.create({
      data: {
        id: `cw${RUN}${tag}`,
        userId: uid,
        url: `/api/media/cw${RUN}${tag}/card`,
        position: 0,
        isCover: true,
        status: "ACTIVE",
        moderation: "APPROVED",
        storagePath: `users/${uid}/photos/cw${RUN}${tag}`,
      },
    });
    await enrollReference(uid); // consents + creates reference + QUEUED
    await runProfilePhotoVerification(uid); // -> AUTO_VERIFIED, badge ACTIVE
    return uid;
  }

  try {
    const uid = await verifiedUser("main");

    await check("precondition: badge live, reference enrolled, consent present", async () => {
      const u = await db.user.findUniqueOrThrow({ where: { id: uid } });
      assert.ok(isPubliclyVerified(u), "badge is publicly visible before withdrawal");
      const job = await db.profilePhotoVerification.findUniqueOrThrow({ where: { userId: uid } });
      assert.ok(job.consentAt && job.referenceId, "consent + reference present");
      const refs = await db.faceReferenceRecord.count({ where: { userId: uid } });
      assert.ok(refs >= 1, "a provider reference record exists");
    });

    const photoVerifiedBefore = (await db.user.findUniqueOrThrow({ where: { id: uid } }))
      .photoVerifiedAt;

    await withdrawFaceConsent(uid);

    await check("withdrawal stops admission (no new face jobs)", async () => {
      const d = await admitToFaceVerification(uid);
      assert.equal(d.admit, false);
      assert.equal(d.reason, "consent_missing");
      const enq = await enqueueProfilePhotoVerification(uid, "photo_uploaded");
      assert.equal(enq, false, "enqueue refused after withdrawal");
    });

    await check(
      "provider reference deletion requested + confirmed (deletedAt stamped)",
      async () => {
        const recs = await db.faceReferenceRecord.findMany({ where: { userId: uid } });
        assert.ok(recs.length >= 1);
        assert.ok(
          recs.every((r) => r.status === "DELETED" && r.deletedAt !== null),
          "every reference deleted at the provider",
        );
      },
    );

    await check("public badge hidden; identity verdict PRESERVED", async () => {
      const u = await db.user.findUniqueOrThrow({ where: { id: uid } });
      assert.ok(u.faceBadgeSuspendedAt, "badge suspended");
      assert.equal(isPubliclyVerified(u), false, "badge no longer public");
      assert.deepEqual(
        u.photoVerifiedAt,
        photoVerifiedBefore,
        "identity photoVerifiedAt untouched",
      );
    });

    await check("job idled for re-enrollment (consent cleared, no reference)", async () => {
      const job = await db.profilePhotoVerification.findUniqueOrThrow({ where: { userId: uid } });
      assert.equal(job.consentAt, null);
      assert.equal(job.consentVersion, null);
      assert.equal(job.referenceId, null);
      assert.equal(job.status, "LIVENESS_REQUIRED");
    });

    await check("pending job no-ops after withdrawal (consent guard)", async () => {
      // Force a runnable-looking job, then run: the consent guard idles it.
      await db.profilePhotoVerification.update({
        where: { userId: uid },
        data: { status: "QUEUED" },
      });
      const decision = await runProfilePhotoVerification(uid);
      assert.equal(decision, null, "run no-ops");
      const job = await db.profilePhotoVerification.findUniqueOrThrow({ where: { userId: uid } });
      assert.equal(job.status, "LIVENESS_REQUIRED", "idled, never processed");
    });

    await check("re-consent requires fresh enrollment, then admission works again", async () => {
      await enrollReference(uid); // fresh consent + fresh reference
      const d = await admitToFaceVerification(uid);
      assert.equal(d.admit, true, "admitted again after re-consent");
      const job = await db.profilePhotoVerification.findUniqueOrThrow({ where: { userId: uid } });
      assert.ok(job.consentAt && job.referenceId, "fresh consent + reference");
    });

    await check("duplicate withdrawal is a safe no-op", async () => {
      const r1 = await withdrawFaceConsent(uid);
      const r2 = await withdrawFaceConsent(uid);
      assert.deepEqual([r1.withdrawn, r2.withdrawn], [true, true]);
      const u = await db.user.findUniqueOrThrow({ where: { id: uid } });
      assert.ok(u.faceBadgeSuspendedAt && u.photoVerifiedAt, "still withdrawn, identity intact");
    });

    await check(
      "vendor outage on deletion -> retry retained (never lost), badge still hidden",
      async () => {
        const uid2 = await verifiedUser("outage");
        const original = mockFaceMatchProvider.deleteReference;
        // Simulate a vendor outage for the deletion call.
        (mockFaceMatchProvider as { deleteReference: (id: string) => Promise<void> }).deleteReference =
          async () => {
            throw new Error("vendor timeout");
          };
        try {
          await withdrawFaceConsent(uid2);
        } finally {
          (mockFaceMatchProvider as { deleteReference: typeof original }).deleteReference =
            original;
        }
        // Withdrawal still succeeded locally (fail-safe): consent cleared, badge hidden.
        const u2 = await db.user.findUniqueOrThrow({ where: { id: uid2 } });
        assert.ok(u2.faceBadgeSuspendedAt, "badge hidden despite vendor outage");
        // The reference is RETAINED for retry (DELETE_PENDING/DELETE_FAILED, attempts++), never lost.
        const recs = await db.faceReferenceRecord.findMany({ where: { userId: uid2 } });
        assert.ok(recs.length >= 1);
        assert.ok(
          recs.every((r) => r.deleteAttempts >= 1 && r.status !== "DELETED"),
          "deletion queued for retry, not silently dropped",
        );
      },
    );
  } finally {
    for (const uid of minted) {
      await db.photo.deleteMany({ where: { userId: uid } }).catch(() => {});
      await db.faceReferenceRecord.deleteMany({ where: { userId: uid } }).catch(() => {});
      await db.profilePhotoVerification.deleteMany({ where: { userId: uid } }).catch(() => {});
      await db.verificationAuditEvent.deleteMany({ where: { userId: uid } }).catch(() => {});
      await db.profile.deleteMany({ where: { userId: uid } }).catch(() => {});
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
