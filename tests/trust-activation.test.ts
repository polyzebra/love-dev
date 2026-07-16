/**
 * Epic 6 (live, DB): the AUTOMATIC Trust Engine lifecycle. Proves the WORKER
 * (runProfilePhotoVerification) and the photo-mutation / withdrawal hooks
 * maintain faceVerifiedAt entirely through grantPhotoVerification() /
 * clearPhotoVerification() - the test NEVER calls grant/clear itself. The
 * worker never writes faceVerifiedAt directly (single writer = photo-grant.ts).
 *
 * Live lane (mock provider). Run with:
 *   FACE_LIVENESS_ENABLED=1 npx tsx tests/trust-activation.test.ts
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
    enqueueProfilePhotoVerification,
    runProfilePhotoVerification,
    onProfilePhotosChanged,
    withdrawFaceConsent,
    setFaceImageLoader,
  } = await import("../src/lib/services/face-verification");
  const { getFaceMatchProvider } = await import("../src/lib/services/face-match-providers");
  const { createBoundLivenessSession, consumeLivenessFlow } =
    await import("../src/lib/services/face-liveness");
  const { rotateReference } = await import("../src/lib/services/face-reference");

  const saved = {
    p: env.FACE_MATCH_PROVIDER,
    l: env.FACE_LIVENESS_ENABLED,
    a: env.FACE_INTERNAL_USER_ALLOWLIST,
    c: env.FACE_INTERNAL_ALLOWLIST_COUNTRY_OVERRIDE,
  };
  env.FACE_MATCH_PROVIDER = "mock";
  env.FACE_LIVENESS_ENABLED = "1";
  env.FACE_INTERNAL_ALLOWLIST_COUNTRY_OVERRIDE = "1";
  delete env.FACE_BINDING_METHOD; // no auto-binding; we seed a BOUND fixture

  let uid = "";
  const cover = `users/__act__/photos/act${RUN}`;
  const faceVerified = async () =>
    (await db.user.findUniqueOrThrow({ where: { id: uid }, select: { faceVerifiedAt: true } }))
      .faceVerifiedAt != null;
  const grantAudits = () =>
    db.verificationAuditEvent.count({ where: { userId: uid, eventType: "photo_grant_granted" } });
  const rerun = async (marker: string) => {
    setFaceImageLoader(async () => Buffer.from(marker));
    const c = await db.photo.findFirst({
      where: { userId: uid, isCover: true, status: "ACTIVE" },
      select: { id: true },
    });
    if (c) await (await import("../src/lib/services/photos")).bumpPhotoMediaVersion(c.id);
    await db.photoFaceCheck.deleteMany({ where: { userId: uid } });
    await enqueueProfilePhotoVerification(uid, "recheck", { consent: true });
    return runProfilePhotoVerification(uid);
  };

  try {
    const email = `e2e-act-${RUN}@example.com`;
    uid = (
      await admin.auth.admin.createUser({ email, password: `act-${RUN}-Aa1!`, email_confirm: true })
    ).data.user!.id;
    env.FACE_INTERNAL_USER_ALLOWLIST = uid;
    const now = new Date();
    await db.user.create({
      data: {
        id: uid,
        email,
        name: "ACT",
        emailVerified: now,
        phone: `+3538785${String(RUN).padStart(4, "0").slice(0, 4)}`,
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
        displayName: "ACT",
        birthDate: new Date("1993-03-03"),
        gender: "WOMAN",
        country: "IE",
      },
    });
    await db.photo.create({
      data: {
        id: `act${RUN}`,
        userId: uid,
        url: `/m/act${RUN}`,
        position: 0,
        isCover: true,
        status: "ACTIVE",
        moderation: "APPROVED",
        storagePath: cover,
      },
    });

    // Enrol a reference (mock) + seed a BOUND binding on the current reference.
    setFaceImageLoader(async () => Buffer.from("face:owner"));
    await enqueueProfilePhotoVerification(uid, "identity_verified", { consent: true });
    const created = await createBoundLivenessSession(uid);
    assert.ok(!("error" in created));
    await consumeLivenessFlow((created as { flowId: string }).flowId, uid);
    const ref = await db.faceReferenceRecord.findFirstOrThrow({
      where: { userId: uid, status: "LINKED" },
      orderBy: { referenceVersion: "desc" },
    });
    await db.faceIdentityBinding.create({
      data: {
        userId: uid,
        faceReferenceId: ref.id,
        method: "HUMAN_REVIEW",
        provider: "human_review",
        status: "BOUND",
        boundAt: new Date(),
      },
    });

    // 1: MATCH -> AUTOMATIC grant (test never calls grantPhotoVerification).
    await check("worker MATCH -> automatic grant sets faceVerifiedAt", async () => {
      const dec = await rerun("face:owner");
      assert.equal(dec?.status, "AUTO_VERIFIED");
      assert.equal(await faceVerified(), true, "granted automatically by the worker");
      assert.equal(await grantAudits(), 1);
    });

    // 2: cover change -> AUTOMATIC clear (immediate hook).
    await check("cover change -> automatic clear (onProfilePhotosChanged)", async () => {
      await onProfilePhotosChanged(uid, "cover_changed");
      assert.equal(await faceVerified(), false, "grant cleared the instant the cover changes");
    });

    // 3: fix cover (same person) -> AUTOMATIC restore.
    await check("same-person re-check -> automatic restore", async () => {
      const dec = await rerun("face:owner");
      assert.equal(dec?.status, "AUTO_VERIFIED");
      assert.equal(await faceVerified(), true, "restored automatically");
    });

    // 4: impostor cover -> adverse -> AUTOMATIC clear.
    await check("impostor cover -> adverse -> automatic clear", async () => {
      const dec = await rerun("face:other");
      assert.ok(dec?.status !== "AUTO_VERIFIED");
      assert.equal(await faceVerified(), false, "cleared on mismatch");
    });

    // 5: restore again.
    await check("re-match again -> automatic restore", async () => {
      await rerun("face:owner");
      assert.equal(await faceVerified(), true);
    });

    // 6: duplicate concurrent runs -> exactly one grant (idempotent/atomic).
    await check("duplicate concurrent worker runs -> ONE grant", async () => {
      // clear + re-arm, then two concurrent runs.
      await onProfilePhotosChanged(uid, "cover_changed"); // clears
      const before = await grantAudits();
      setFaceImageLoader(async () => Buffer.from("face:owner"));
      const c = await db.photo.findFirstOrThrow({
        where: { userId: uid, isCover: true },
        select: { id: true },
      });
      await (await import("../src/lib/services/photos")).bumpPhotoMediaVersion(c.id);
      await db.photoFaceCheck.deleteMany({ where: { userId: uid } });
      await enqueueProfilePhotoVerification(uid, "recheck", { consent: true });
      await Promise.all([runProfilePhotoVerification(uid), runProfilePhotoVerification(uid)]);
      assert.equal(await faceVerified(), true);
      assert.equal((await grantAudits()) - before, 1, "exactly one new grant audit");
    });

    // 7: stale worker cannot restore (lease race guard, F2) - grant not written.
    await check("stale worker cannot auto-grant (superseded by a newer enqueue)", async () => {
      await onProfilePhotosChanged(uid, "cover_changed"); // clears grant
      setFaceImageLoader(async () => Buffer.from("face:owner"));
      const cph = await db.photo.findFirstOrThrow({
        where: { userId: uid, isCover: true },
        select: { id: true },
      });
      await (await import("../src/lib/services/photos")).bumpPhotoMediaVersion(cph.id);
      await db.photoFaceCheck.deleteMany({ where: { userId: uid } });
      await enqueueProfilePhotoVerification(uid, "recheck", { consent: true });
      const mock = getFaceMatchProvider();
      const racing = {
        ...mock,
        compareReferenceToPhoto: async (
          r: string,
          i: { image: Buffer; photoId: string; photoVersion: number },
        ) => {
          await enqueueProfilePhotoVerification(uid, "cover_changed_again", { consent: true }); // nulls our lease
          return mock.compareReferenceToPhoto(r, i);
        },
      };
      const dec = await runProfilePhotoVerification(uid, { provider: racing });
      assert.equal(dec, null, "superseded worker returns null (before grant)");
      assert.equal(await faceVerified(), false, "stale worker did not auto-grant");
    });

    // 8: withdraw consent -> AUTOMATIC clear.
    await check("withdraw consent -> automatic clear", async () => {
      await rerun("face:owner"); // re-grant
      assert.equal(await faceVerified(), true);
      await withdrawFaceConsent(uid);
      assert.equal(await faceVerified(), false, "grant cleared on consent withdrawal");
    });

    // 9: rotation -> AUTOMATIC clear (Epic 1 wiring, still holds).
    await check("reference rotation -> automatic clear", async () => {
      // re-enrol + re-grant first.
      await enqueueProfilePhotoVerification(uid, "identity_verified", { consent: true });
      const c2 = await createBoundLivenessSession(uid);
      if (!("error" in c2)) await consumeLivenessFlow(c2.flowId, uid);
      const ref2 = await db.faceReferenceRecord.findFirst({
        where: { userId: uid, status: "LINKED" },
        orderBy: { referenceVersion: "desc" },
      });
      if (ref2)
        await db.faceIdentityBinding.create({
          data: {
            userId: uid,
            faceReferenceId: ref2.id,
            method: "HUMAN_REVIEW",
            provider: "human_review",
            status: "BOUND",
            boundAt: new Date(),
          },
        });
      await rerun("face:owner");
      // rotation clears regardless of current grant state.
      await rotateReference(uid, "provider_upgrade");
      assert.equal(await faceVerified(), false, "grant cleared on rotation");
    });

    // The worker never writes faceVerifiedAt directly.
    await check("single writer: worker calls the engine, never writes faceVerifiedAt", async () => {
      const { readFileSync } = await import("node:fs");
      const src = readFileSync("src/lib/services/face-verification.ts", "utf8");
      assert.ok(
        !/faceVerifiedAt:\s*(new Date|null)/.test(src),
        "worker never writes the grant column",
      );
      assert.ok(
        /grantPhotoVerification|clearPhotoVerification/.test(src),
        "worker drives the grant engine",
      );
    });
  } finally {
    setFaceImageLoader(null);
    for (const [k, v] of [
      ["FACE_MATCH_PROVIDER", saved.p],
      ["FACE_LIVENESS_ENABLED", saved.l],
      ["FACE_INTERNAL_USER_ALLOWLIST", saved.a],
      ["FACE_INTERNAL_ALLOWLIST_COUNTRY_OVERRIDE", saved.c],
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
      await db.notification.deleteMany({ where: { userId: uid } }).catch(() => {});
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
