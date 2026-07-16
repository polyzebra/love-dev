/**
 * Epic 1 / F2: the positive Photo Verified grant engine. Proves the engine
 * refuses in every non-eligible state, grants ONLY when every condition passes
 * (incl. a BOUND binding + current MATCH), is idempotent + atomic, clears with
 * audited reasons, that reference rotation clears the grant, and that the
 * worker never grants. faceVerifiedAt has exactly one writer (this engine).
 *
 * Live lane (real DB + mock provider). Run with:
 *   FACE_LIVENESS_ENABLED=1 npx tsx tests/photo-grant.test.ts
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
  const {
    evaluatePhotoGrant,
    grantPhotoVerification,
    clearPhotoVerification,
    PhotoGrantReason,
    PhotoClearReason,
  } = await import("../src/lib/services/photo-grant");
  const { enqueueProfilePhotoVerification, runProfilePhotoVerification, setFaceImageLoader } =
    await import("../src/lib/services/face-verification");
  const { createBoundLivenessSession, consumeLivenessFlow } =
    await import("../src/lib/services/face-liveness");
  const { rotateReference } = await import("../src/lib/services/face-reference");

  const saved = {
    p: env.FACE_MATCH_PROVIDER,
    l: env.FACE_LIVENESS_ENABLED,
    a: env.FACE_INTERNAL_USER_ALLOWLIST,
    c: env.FACE_INTERNAL_ALLOWLIST_COUNTRY_OVERRIDE,
    e: env.FACE_EMERGENCY_DISABLE,
  };
  env.FACE_MATCH_PROVIDER = "mock";
  env.FACE_LIVENESS_ENABLED = "1";
  delete env.FACE_EMERGENCY_DISABLE;
  const cover = `users/__pg__/photos/pg${RUN}`;
  setFaceImageLoader(async () => Buffer.from("face:owner"));

  let uid = "";
  const faceVerifiedAt = async () =>
    (await db.user.findUniqueOrThrow({ where: { id: uid }, select: { faceVerifiedAt: true } }))
      .faceVerifiedAt;
  const auditCount = (eventType: string) =>
    db.verificationAuditEvent.count({ where: { userId: uid, eventType } });
  const reEnqueueRun = async (marker: string) => {
    setFaceImageLoader(async () => Buffer.from(marker));
    await db.photoFaceCheck.deleteMany({ where: { userId: uid } });
    await enqueueProfilePhotoVerification(uid, "pg_recheck", { consent: true });
    return runProfilePhotoVerification(uid);
  };

  try {
    const email = `e2e-pg-${RUN}@example.com`;
    uid = (
      await admin.auth.admin.createUser({ email, password: `pg-${RUN}-Aa1!`, email_confirm: true })
    ).data.user!.id;
    env.FACE_INTERNAL_USER_ALLOWLIST = uid;
    env.FACE_INTERNAL_ALLOWLIST_COUNTRY_OVERRIDE = "1";
    const now = new Date();
    await db.user.create({
      data: {
        id: uid,
        email,
        name: "PG",
        emailVerified: now,
        phone: `+3538796${String(RUN).padStart(4, "0").slice(0, 4)}`,
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
        displayName: "PG",
        birthDate: new Date("1993-03-03"),
        gender: "WOMAN",
        country: "IE",
      },
    });
    await db.photo.create({
      data: {
        id: `pg${RUN}`,
        userId: uid,
        url: `/m/pg${RUN}`,
        position: 0,
        isCover: true,
        status: "ACTIVE",
        moderation: "APPROVED",
        storagePath: cover,
      },
    });

    // ---- system + identity gates ---------------------------------------
    await check("provider disabled -> PROVIDER_DISABLED, no grant", async () => {
      delete env.FACE_MATCH_PROVIDER;
      const e = await evaluatePhotoGrant(uid);
      assert.equal(e.reason, PhotoGrantReason.PROVIDER_DISABLED);
      const g = await grantPhotoVerification(uid);
      assert.deepEqual([g.granted, g.changed], [false, false]);
      assert.equal(await faceVerifiedAt(), null);
      env.FACE_MATCH_PROVIDER = "mock";
    });

    await check("emergency disabled -> EMERGENCY_DISABLED", async () => {
      env.FACE_EMERGENCY_DISABLE = "1";
      assert.equal((await evaluatePhotoGrant(uid)).reason, PhotoGrantReason.EMERGENCY_DISABLED);
      delete env.FACE_EMERGENCY_DISABLE;
    });

    await check("identity missing -> NOT_IDENTITY_VERIFIED", async () => {
      await db.user.update({ where: { id: uid }, data: { photoVerifiedAt: null } });
      assert.equal((await evaluatePhotoGrant(uid)).reason, PhotoGrantReason.NOT_IDENTITY_VERIFIED);
      await db.user.update({ where: { id: uid }, data: { photoVerifiedAt: now } });
    });

    // ---- reference + binding gates -------------------------------------
    await check("consent + no reference yet -> NO_FACE_REFERENCE", async () => {
      await enqueueProfilePhotoVerification(uid, "identity_verified", { consent: true });
      assert.equal((await evaluatePhotoGrant(uid)).reason, PhotoGrantReason.NO_FACE_REFERENCE);
    });

    await check("reference enrolled but no binding -> NO_BINDING", async () => {
      const created = await createBoundLivenessSession(uid);
      assert.ok(!("error" in created));
      await consumeLivenessFlow((created as { flowId: string }).flowId, uid);
      assert.equal((await evaluatePhotoGrant(uid)).reason, PhotoGrantReason.NO_BINDING);
    });

    await check("worker runs to AUTO_VERIFIED but NEVER grants (still NO_BINDING)", async () => {
      const dec = await reEnqueueRun("face:owner");
      assert.equal(dec?.status, "AUTO_VERIFIED", "worker matched");
      assert.equal(await faceVerifiedAt(), null, "worker did not grant faceVerifiedAt");
      assert.equal((await evaluatePhotoGrant(uid)).reason, PhotoGrantReason.NO_BINDING);
    });

    // ---- the ONLY eligible path ----------------------------------------
    let refId = "";
    await check(
      "BOUND binding + MATCH -> ELIGIBLE, grant sets faceVerifiedAt + audits",
      async () => {
        const ref = await db.faceReferenceRecord.findFirstOrThrow({
          where: { userId: uid, status: "LINKED" },
          orderBy: { referenceVersion: "desc" },
        });
        refId = ref.id;
        await db.faceIdentityBinding.create({
          data: {
            userId: uid,
            faceReferenceId: ref.id,
            method: "STRIPE_SELFIE_COMPARE",
            provider: "aws",
            status: "BOUND",
            boundAt: new Date(),
            similarityBand: "confident",
          },
        });
        assert.equal((await evaluatePhotoGrant(uid)).reason, PhotoGrantReason.ELIGIBLE);
        const g = await grantPhotoVerification(uid);
        assert.deepEqual([g.granted, g.changed], [true, true]);
        assert.notEqual(await faceVerifiedAt(), null, "granted");
        assert.equal(await auditCount("photo_grant_granted"), 1, "one grant audit");
      },
    );

    await check("grant is idempotent (second call no-op, no duplicate audit)", async () => {
      const g = await grantPhotoVerification(uid);
      assert.deepEqual([g.granted, g.changed], [true, false]);
      assert.equal(await auditCount("photo_grant_granted"), 1, "still one grant audit");
    });

    await check("clear is idempotent + audited", async () => {
      const c1 = await clearPhotoVerification(uid, PhotoClearReason.PHOTO_CHANGED);
      assert.equal(c1.cleared, true);
      assert.equal(await faceVerifiedAt(), null);
      assert.equal(await auditCount("photo_grant_cleared"), 1);
      const c2 = await clearPhotoVerification(uid, PhotoClearReason.PHOTO_CHANGED);
      assert.equal(c2.cleared, false, "already null -> no-op");
      assert.equal(await auditCount("photo_grant_cleared"), 1, "no duplicate clear audit");
    });

    await check(
      "concurrent grants are atomic - exactly one writes (no partial grant)",
      async () => {
        const [a, b] = await Promise.all([
          grantPhotoVerification(uid),
          grantPhotoVerification(uid),
        ]);
        const changes = [a.changed, b.changed].filter(Boolean).length;
        assert.equal(changes, 1, "exactly one concurrent grant wrote");
        assert.notEqual(await faceVerifiedAt(), null);
      },
    );

    // ---- review + rotation ---------------------------------------------
    await check("MANUAL_REVIEW -> UNDER_REVIEW", async () => {
      const dec = await reEnqueueRun("face:uncertain");
      assert.equal(dec?.status, "MANUAL_REVIEW");
      assert.equal((await evaluatePhotoGrant(uid)).reason, PhotoGrantReason.UNDER_REVIEW);
    });

    await check(
      "reference rotation CLEARS the grant (REFERENCE_ROTATED) + no longer eligible",
      async () => {
        // Bring back to granted first.
        await reEnqueueRun("face:owner");
        await grantPhotoVerification(uid);
        assert.notEqual(await faceVerifiedAt(), null, "granted before rotation");
        const clearsBefore = await auditCount("photo_grant_cleared");
        await rotateReference(uid, "provider_upgrade");
        assert.equal(await faceVerifiedAt(), null, "rotation cleared the grant");
        assert.equal(await auditCount("photo_grant_cleared"), clearsBefore + 1, "clear audited");
        const e = await evaluatePhotoGrant(uid);
        const notEligible: string[] = [
          PhotoGrantReason.NO_FACE_REFERENCE,
          PhotoGrantReason.NO_BINDING,
        ];
        assert.ok(notEligible.includes(e.reason), `rotation -> not eligible (${e.reason})`);
      },
    );

    await check("refusals are audited too (photo_grant_refused)", async () => {
      assert.ok(
        (await auditCount("photo_grant_refused")) > 0,
        "at least one refusal audit recorded",
      );
    });

    void refId;
  } finally {
    setFaceImageLoader(null);
    for (const [k, v] of [
      ["FACE_MATCH_PROVIDER", saved.p],
      ["FACE_LIVENESS_ENABLED", saved.l],
      ["FACE_INTERNAL_USER_ALLOWLIST", saved.a],
      ["FACE_INTERNAL_ALLOWLIST_COUNTRY_OVERRIDE", saved.c],
      ["FACE_EMERGENCY_DISABLE", saved.e],
    ] as const) {
      if (v === undefined) delete env[k];
      else env[k] = v;
    }
    if (uid) {
      await db.faceIdentityBinding.deleteMany({ where: { userId: uid } }).catch(() => {});
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
