/**
 * F2 regression: the public badge must always reflect the CURRENT trusted
 * profile. A cover change withholds the badge IMMEDIATELY; the async worker
 * restores it ONLY on a confirmed MATCH (badgeStatus ACTIVE). MANUAL_REVIEW,
 * SUSPENDED and provider errors keep it withheld, and a stale (superseded)
 * worker can never restore trust.
 *
 * Live lane (real DB + mock provider). Marker-driven bytes via the image
 * loader override (this suite is about the BADGE, not the storage bucket -
 * F1 has its own no-override test). Run with:
 *   FACE_LIVENESS_ENABLED=1 npx tsx tests/face-badge-trust.test.ts
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
    setFaceImageLoader,
  } = await import("../src/lib/services/face-verification");
  const { getFaceMatchProvider } = await import("../src/lib/services/face-match-providers");
  const { createBoundLivenessSession, consumeLivenessFlow } =
    await import("../src/lib/services/face-liveness");
  const { isPubliclyVerified, PUBLIC_BADGE_SELECT } =
    await import("../src/lib/services/verification");

  const saved = {
    p: env.FACE_MATCH_PROVIDER,
    l: env.FACE_LIVENESS_ENABLED,
    a: env.FACE_INTERNAL_USER_ALLOWLIST,
    c: env.FACE_INTERNAL_ALLOWLIST_COUNTRY_OVERRIDE,
  };
  env.FACE_MATCH_PROVIDER = "mock";
  env.FACE_LIVENESS_ENABLED = "1";

  const markers = new Map<string, string>();
  setFaceImageLoader(async (sp) => Buffer.from(markers.get(sp ?? "") ?? "face:owner"));

  let uid = "";
  const coverPath = `users/__f2__/photos/cov${RUN}`;

  // Helpers -----------------------------------------------------------------
  const badgeHidden = async () => {
    const u = await db.user.findUniqueOrThrow({
      where: { id: uid },
      select: PUBLIC_BADGE_SELECT,
    });
    return !isPubliclyVerified(u);
  };
  const setBadge = (hidden: boolean) =>
    db.user.update({
      where: { id: uid },
      data: { faceBadgeSuspendedAt: hidden ? new Date() : null },
    });
  // Re-check the cover under the CURRENT marker: clear the cache + re-queue,
  // then run the worker. Returns the decision status.
  const rerunCover = async (marker: string) => {
    markers.set(coverPath, marker);
    await db.photoFaceCheck.deleteMany({ where: { userId: uid } });
    await enqueueProfilePhotoVerification(uid, "cover_changed", { consent: true });
    const dec = await runProfilePhotoVerification(uid);
    return dec?.status ?? null;
  };

  try {
    const email = `e2e-f2-${RUN}@example.com`;
    uid = (
      await admin.auth.admin.createUser({ email, password: `f2-${RUN}-Aa1!`, email_confirm: true })
    ).data.user!.id;
    env.FACE_INTERNAL_USER_ALLOWLIST = uid;
    env.FACE_INTERNAL_ALLOWLIST_COUNTRY_OVERRIDE = "1";
    const now = new Date();
    await db.user.create({
      data: {
        id: uid,
        email,
        name: "F2",
        emailVerified: now,
        phone: `+3538792${String(RUN).padStart(4, "0").slice(0, 4)}`,
        phoneVerifiedAt: now,
        ageConfirmedAt: now,
        termsVersion: "2026-07",
        privacyVersion: "2026-07",
        communityVersion: "2026-07",
        onboardingDone: true,
        photoVerifiedAt: now,
        // L6.5: baseline verified snapshot (galleryVersion defaults to 0) so the
        // badge is visible; this test drives the face-layer suspension lever.
        verifiedGalleryVersion: 0,
      },
    });
    await db.profile.create({
      data: {
        userId: uid,
        displayName: "F2",
        birthDate: new Date("1993-03-03"),
        gender: "WOMAN",
        country: "IE",
      },
    });
    await db.photo.create({
      data: {
        id: `f2c${RUN}`,
        userId: uid,
        url: `/api/media/f2c${RUN}/card`,
        position: 0,
        isCover: true,
        status: "ACTIVE",
        moderation: "APPROVED",
        storagePath: coverPath,
      },
    });
    markers.set(coverPath, "face:owner");

    // Enrol a reference (mock; no storage), verify -> badge live.
    await enqueueProfilePhotoVerification(uid, "identity_verified", { consent: true });
    const created = await createBoundLivenessSession(uid);
    assert.ok(!("error" in created));
    await consumeLivenessFlow((created as { flowId: string }).flowId, uid);
    const first = await runProfilePhotoVerification(uid);
    assert.equal(first?.status, "AUTO_VERIFIED", "baseline: verified");
    assert.equal(await badgeHidden(), false, "baseline: badge visible");

    // 1 - cover change withholds the badge IMMEDIATELY (before the worker) ---
    await check("cover replaced -> badge hidden immediately (no worker yet)", async () => {
      await onProfilePhotosChanged(uid, "cover_changed");
      assert.equal(await badgeHidden(), true, "badge withheld synchronously on cover change");
    });

    // gallery reorder that does NOT crown a new cover must NOT withhold ------
    await check("gallery reorder unchanged -> badge NOT withheld", async () => {
      await setBadge(false); // back to visible
      await onProfilePhotosChanged(uid, "photos_reordered");
      assert.equal(await badgeHidden(), false, "harmless reorder leaves the badge visible");
    });

    // 2 - async MATCH restores the badge -------------------------------------
    await check("worker MATCH (AUTO_VERIFIED) restores the badge", async () => {
      await setBadge(true); // simulate the immediate withhold
      const status = await rerunCover("face:owner");
      assert.equal(status, "AUTO_VERIFIED");
      assert.equal(await badgeHidden(), false, "MATCH restores");
    });

    // 3 - MANUAL_REVIEW must NEVER restore the badge -------------------------
    await check("worker MANUAL_REVIEW keeps the badge hidden (F2 core)", async () => {
      await setBadge(true);
      const status = await rerunCover("face:uncertain"); // FLAGGED cover -> MANUAL_REVIEW
      assert.equal(status, "MANUAL_REVIEW");
      assert.equal(await badgeHidden(), true, "MANUAL_REVIEW must not restore");
    });

    // 4 - SUSPENDED/REJECTED must NEVER restore the badge --------------------
    await check("worker adverse outcome keeps the badge hidden", async () => {
      await setBadge(true);
      const status = await rerunCover("face:other"); // confident mismatch -> REJECTED (badge SUSPENDED)
      assert.ok(status === "REJECTED" || status === "SUSPENDED", `expected adverse, got ${status}`);
      assert.equal(await badgeHidden(), true, "adverse outcome must not restore");
    });

    // 5 - provider error follows the documented WITHHOLD policy --------------
    await check("provider error keeps the badge withheld (fail closed for grants)", async () => {
      await setBadge(true);
      markers.set(coverPath, "face:owner");
      await db.photoFaceCheck.deleteMany({ where: { userId: uid } });
      await enqueueProfilePhotoVerification(uid, "cover_changed", { consent: true });
      const mock = getFaceMatchProvider();
      const throwing = {
        ...mock,
        compareReferenceToPhoto: async () => {
          throw new Error("provider timeout");
        },
      };
      const dec = await runProfilePhotoVerification(uid, { provider: throwing });
      assert.equal(dec, null, "provider error -> job parked, no decision");
      assert.equal(await badgeHidden(), true, "badge stays withheld on provider error");
    });

    // 6 - a STALE worker (lease superseded mid-run) cannot restore trust -----
    await check("stale worker cannot restore the badge (lease race guard)", async () => {
      await setBadge(true);
      markers.set(coverPath, "face:owner");
      await db.photoFaceCheck.deleteMany({ where: { userId: uid } });
      await enqueueProfilePhotoVerification(uid, "cover_changed", { consent: true });
      const mock = getFaceMatchProvider();
      // While THIS worker is comparing, a newer cover change re-enqueues the
      // job and nulls our lease. Our owner-MATCH must NOT restore the badge.
      const racing = {
        ...mock,
        compareReferenceToPhoto: async (
          refId: string,
          input: { image: Buffer; photoId: string; photoVersion: number },
        ) => {
          await enqueueProfilePhotoVerification(uid, "cover_changed", { consent: true });
          return mock.compareReferenceToPhoto(refId, input);
        },
      };
      const dec = await runProfilePhotoVerification(uid, { provider: racing });
      assert.equal(dec, null, "superseded worker returns null (commit guard)");
      assert.equal(await badgeHidden(), true, "stale MATCH did not restore trust");
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
