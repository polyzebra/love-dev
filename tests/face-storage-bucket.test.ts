/**
 * F1 regression: the face pipeline must load profile bytes from the CANONICAL
 * bucket (PHOTOS_BUCKET = "listing-images"), NOT a hardcoded "photos".
 *
 * Unlike every other face suite, this test intentionally does NOT install a
 * faceImageLoaderOverride - it exercises the REAL storage download path:
 *   runProfilePhotoVerification -> loadPhotoBytes -> storage.from(PHOTOS_BUCKET)
 * A real object is uploaded to the canonical bucket at the cover's storage
 * path. If the pipeline downloads from the wrong bucket (e.g. "photos"), the
 * object is not found, bytes are null, and the cover lands image_unreadable ->
 * MANUAL_REVIEW instead of AUTO_VERIFIED - so this test FAILS the moment the
 * bucket is changed back. It never calls AWS (mock provider reads the bytes).
 *
 * Live lane (real Supabase storage + DB). Run with:
 *   FACE_LIVENESS_ENABLED=1 npx tsx tests/face-storage-bucket.test.ts
 */
import "dotenv/config";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";

let passed = 0;
async function check(name: string, fn: () => Promise<void>): Promise<void> {
  await fn();
  passed += 1;
  console.log(`  ok - ${name}`);
}

const env = process.env as Record<string, string | undefined>;
const RUN = Math.abs(hashStr(`${process.env.USER ?? "x"}:${process.argv.join()}`)) % 100000;
function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}

async function main() {
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
  const { db } = await import("../src/lib/db");
  const { PHOTOS_BUCKET } = await import("../src/lib/services/photos");
  const { enqueueProfilePhotoVerification, runProfilePhotoVerification } = await import(
    "../src/lib/services/face-verification"
  );
  const { createBoundLivenessSession, consumeLivenessFlow } = await import(
    "../src/lib/services/face-liveness"
  );

  // Admit deterministically via the internal allowlist; mock provider + liveness.
  const saved = {
    p: env.FACE_MATCH_PROVIDER,
    l: env.FACE_LIVENESS_ENABLED,
    a: env.FACE_INTERNAL_USER_ALLOWLIST,
    c: env.FACE_INTERNAL_ALLOWLIST_COUNTRY_OVERRIDE,
  };
  env.FACE_MATCH_PROVIDER = "mock";
  env.FACE_LIVENESS_ENABLED = "1";

  let uid = "";
  const storagePath = `users/__f1regression__/photos/f1${RUN}`;
  const objectPath = `${storagePath}/card.webp`;

  try {
    const email = `e2e-f1-${RUN}@example.com`;
    uid = (
      await admin.auth.admin.createUser({ email, password: `f1-${RUN}-Aa1!`, email_confirm: true })
    ).data.user!.id;
    env.FACE_INTERNAL_USER_ALLOWLIST = uid;
    env.FACE_INTERNAL_ALLOWLIST_COUNTRY_OVERRIDE = "1";

    const now = new Date();
    await db.user.create({
      data: {
        id: uid,
        email,
        name: "F1",
        emailVerified: now,
        phone: `+3538791${String(RUN).padStart(4, "0").slice(0, 4)}`,
        phoneVerifiedAt: now,
        ageConfirmedAt: now,
        termsVersion: "2026-07",
        privacyVersion: "2026-07",
        communityVersion: "2026-07",
        onboardingDone: true,
        photoVerifiedAt: now, // identity verified - the face layer follows it
      },
    });
    await db.profile.create({
      data: {
        userId: uid,
        displayName: "F1",
        birthDate: new Date("1993-03-03"),
        gender: "WOMAN",
        country: "IE",
      },
    });
    await db.photo.create({
      data: {
        id: `f1${RUN}`,
        userId: uid,
        url: `/api/media/f1${RUN}/card`,
        position: 0,
        isCover: true,
        status: "ACTIVE",
        moderation: "APPROVED",
        storagePath,
      },
    });

    // Put REAL bytes in the CANONICAL bucket at the cover's card path. The mock
    // provider reads the "face:owner" marker straight from these bytes.
    await check("upload cover bytes to the canonical bucket", async () => {
      const { error } = await admin.storage
        .from(PHOTOS_BUCKET)
        .upload(objectPath, new Blob([new Uint8Array(Buffer.from("face:owner"))]), {
          upsert: true,
          contentType: "image/webp",
        });
      assert.equal(error, null, `upload to ${PHOTOS_BUCKET} failed: ${error?.message}`);
    });

    // Consent + enrol a reference (mock; no storage), then QUEUE the check.
    await enqueueProfilePhotoVerification(uid, "f1_regression", { consent: true });
    const created = await createBoundLivenessSession(uid);
    assert.ok(!("error" in created), "liveness session created");
    const flow = (created as { flowId: string }).flowId;
    const r = await consumeLivenessFlow(flow, uid);
    assert.equal(r.state, "checking_profile_photos", "reference enrolled via liveness");

    await check(
      "pipeline reads bytes from the canonical bucket -> AUTO_VERIFIED (fails if bucket reverts to 'photos')",
      async () => {
        // NO setFaceImageLoader here - this drives the real storage download.
        const decision = await runProfilePhotoVerification(uid);
        assert.ok(decision, "a decision was produced");
        assert.equal(
          decision!.status,
          "AUTO_VERIFIED",
          `expected AUTO_VERIFIED (owner bytes read from ${PHOTOS_BUCKET}); ` +
            `MANUAL_REVIEW here means loadPhotoBytes could not find the object -> wrong bucket`,
        );
      },
    );
  } finally {
    for (const [k, v] of [
      ["FACE_MATCH_PROVIDER", saved.p],
      ["FACE_LIVENESS_ENABLED", saved.l],
      ["FACE_INTERNAL_USER_ALLOWLIST", saved.a],
      ["FACE_INTERNAL_ALLOWLIST_COUNTRY_OVERRIDE", saved.c],
    ] as const) {
      if (v === undefined) delete env[k];
      else env[k] = v;
    }
    await admin.storage.from(PHOTOS_BUCKET).remove([objectPath]).catch(() => {});
    if (uid) {
      await db.photoFaceCheck.deleteMany({ where: { userId: uid } }).catch(() => {});
      await db.livenessSession.deleteMany({ where: { userId: uid } }).catch(() => {});
      await db.faceReferenceRecord.deleteMany({ where: { userId: uid } }).catch(() => {});
      await db.profilePhotoVerification.deleteMany({ where: { userId: uid } }).catch(() => {});
      await db.verificationAuditEvent.deleteMany({ where: { userId: uid } }).catch(() => {});
      await db.photo.deleteMany({ where: { userId: uid } }).catch(() => {});
      await db.profile.deleteMany({ where: { userId: uid } }).catch(() => {});
      await db.user.deleteMany({ where: { id: uid } }).catch(() => {});
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
