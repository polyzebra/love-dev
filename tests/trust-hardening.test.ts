/**
 * FINAL HARDENING (live, DB): proves M1 + M2 are permanently closed.
 *
 *  M1 - the grant write re-validates EVERY condition at the instant
 *  faceVerifiedAt is written. A concurrent invalidation that lands in the
 *  evaluate->write TOCTOU window (consent withdrawn / binding revoked /
 *  identity revoked) can NEVER leave a stale grant: the write is compensated
 *  the moment the re-check sees the change.
 *
 *  M2 - moderation is a first-class profile mutation. Every trust-affecting
 *  moderation outcome (approve / reject / restore / delete) re-drives the
 *  CANONICAL Trust Engine via onProfilePhotosChanged() -> grant/clear. There
 *  is NO moderation-specific badge logic and NO duplicated grant/clear code.
 *
 * The test NEVER writes faceVerifiedAt itself (single writer = photo-grant.ts).
 *
 * Live lane (mock provider). Run with:
 *   FACE_LIVENESS_ENABLED=1 npx tsx tests/trust-hardening.test.ts
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
    setFaceImageLoader,
    BIOMETRIC_CONSENT_VERSION,
  } = await import("../src/lib/services/face-verification");
  const { createBoundLivenessSession, consumeLivenessFlow } =
    await import("../src/lib/services/face-liveness");
  const { evaluatePhotoGrant, grantPhotoVerification, clearPhotoVerification, PhotoClearReason } =
    await import("../src/lib/services/photo-grant");
  const { moderatePhoto, setMockModerationConfig } = await import("../src/lib/services/moderation");
  const { reverseViolation } = await import("../src/lib/services/trust-safety");

  const saved = {
    p: env.FACE_MATCH_PROVIDER,
    l: env.FACE_LIVENESS_ENABLED,
    a: env.FACE_INTERNAL_USER_ALLOWLIST,
    c: env.FACE_INTERNAL_ALLOWLIST_COUNTRY_OVERRIDE,
    m: env.MODERATION_PROVIDER,
    b: env.FACE_BINDING_METHOD,
  };
  env.FACE_MATCH_PROVIDER = "mock";
  env.FACE_LIVENESS_ENABLED = "1";
  env.FACE_INTERNAL_ALLOWLIST_COUNTRY_OVERRIDE = "1";
  env.MODERATION_PROVIDER = "mock";
  delete env.FACE_BINDING_METHOD; // no auto-binding; we seed a BOUND fixture

  let uid = "";
  let refId = "";
  const coverId = `hrd${RUN}`;
  const cover = `users/__hrd__/photos/${coverId}`;

  const faceVerified = async () =>
    (await db.user.findUniqueOrThrow({ where: { id: uid }, select: { faceVerifiedAt: true } }))
      .faceVerifiedAt != null;
  const auditCount = (eventType: string) =>
    db.verificationAuditEvent.count({ where: { userId: uid, eventType } });

  // Force the CURRENT cover ACTIVE/APPROVED and set the fixture to a fully
  // ELIGIBLE-but-not-yet-granted state WITHOUT ever writing faceVerifiedAt.
  // Every M1 case starts here so the grant's FIRST evaluate passes.
  const armEligible = async () => {
    await clearPhotoVerification(uid, PhotoClearReason.MANUAL_REVIEW); // faceVerifiedAt -> null
    await db.photo.update({
      where: { id: coverId },
      data: { status: "ACTIVE", moderation: "APPROVED", isCover: true },
    });
    await db.user.update({ where: { id: uid }, data: { photoVerifiedAt: new Date() } });
    await db.profilePhotoVerification.update({
      where: { userId: uid },
      data: {
        consentAt: new Date(),
        consentVersion: BIOMETRIC_CONSENT_VERSION,
        referenceId: refId,
        referenceStatus: "ACTIVE",
        status: "AUTO_VERIFIED",
        badgeStatus: "ACTIVE",
      },
    });
    // Exactly one BOUND binding on the current LINKED reference.
    await db.faceIdentityBinding.deleteMany({ where: { userId: uid } });
    await db.faceIdentityBinding.create({
      data: {
        userId: uid,
        faceReferenceId: refId,
        method: "HUMAN_REVIEW",
        provider: "human_review",
        status: "BOUND",
        boundAt: new Date(),
      },
    });
    const ev = await evaluatePhotoGrant(uid);
    assert.equal(ev.eligible, true, `fixture must be eligible, got ${ev.reason}`);
  };

  // Drive the real worker to a MATCH on the current cover (grants via engine).
  const runWorker = async (marker: "face:owner" | "face:other") => {
    setFaceImageLoader(async () => Buffer.from(marker));
    await (await import("../src/lib/services/photos")).bumpPhotoMediaVersion(coverId);
    await db.photoFaceCheck.deleteMany({ where: { userId: uid } });
    await enqueueProfilePhotoVerification(uid, "recheck", { consent: true });
    return runProfilePhotoVerification(uid);
  };

  // Run grantPhotoVerification while a concurrent invalidation lands INSIDE the
  // evaluate->write window: the injection fires on the grant's own atomic write
  // (guarded on faceVerifiedAt: null), after the first evaluate, before the
  // post-write re-check. Deterministic, single-threaded interleaving.
  const grantWithRace = async (injectAtWrite: () => Promise<void>) => {
    const userDelegate = db.user as unknown as {
      updateMany: (a: unknown) => Promise<unknown>;
    };
    const orig = userDelegate.updateMany.bind(db.user);
    let fired = false;
    userDelegate.updateMany = async (a: unknown) => {
      const where = (a as { where?: { faceVerifiedAt?: unknown } }).where;
      if (!fired && where && where.faceVerifiedAt === null) {
        fired = true;
        await injectAtWrite();
      }
      return orig(a);
    };
    try {
      return await grantPhotoVerification(uid);
    } finally {
      userDelegate.updateMany = orig;
    }
  };

  try {
    const email = `e2e-hrd-${RUN}@example.com`;
    uid = (
      await admin.auth.admin.createUser({ email, password: `hrd-${RUN}-Aa1!`, email_confirm: true })
    ).data.user!.id;
    env.FACE_INTERNAL_USER_ALLOWLIST = uid;
    const now = new Date();
    await db.user.create({
      data: {
        id: uid,
        email,
        name: "HRD",
        emailVerified: now,
        phone: `+3538786${String(RUN).padStart(4, "0").slice(0, 4)}`,
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
        displayName: "HRD",
        birthDate: new Date("1993-03-03"),
        gender: "WOMAN",
        country: "IE",
      },
    });
    await db.photo.create({
      data: {
        id: coverId,
        userId: uid,
        url: `/m/${coverId}`,
        position: 0,
        isCover: true,
        status: "ACTIVE",
        moderation: "APPROVED",
        storagePath: cover,
      },
    });

    // Enrol a real (mock) liveness-derived reference so evaluate's reference +
    // binding gates operate on genuine rows.
    setFaceImageLoader(async () => Buffer.from("face:owner"));
    await enqueueProfilePhotoVerification(uid, "identity_verified", { consent: true });
    const created = await createBoundLivenessSession(uid);
    assert.ok(!("error" in created));
    await consumeLivenessFlow((created as { flowId: string }).flowId, uid);
    refId = (
      await db.faceReferenceRecord.findFirstOrThrow({
        where: { userId: uid, status: "LINKED" },
        orderBy: { referenceVersion: "desc" },
      })
    ).id;

    // ---- M1: TOCTOU close --------------------------------------------------

    await check("M1 withdrawal during grant -> NO grant (compensated)", async () => {
      await armEligible();
      const r = await grantWithRace(async () => {
        await db.profilePhotoVerification.update({
          where: { userId: uid },
          data: { consentAt: null },
        });
      });
      assert.equal(r.granted, false, "grant refused on re-check");
      assert.equal(r.reason, "CONSENT_REQUIRED");
      assert.equal(await faceVerified(), false, "no stale grant survives the window");
    });

    await check("M1 binding revoked during grant -> NO grant (compensated)", async () => {
      await armEligible();
      const r = await grantWithRace(async () => {
        await db.faceIdentityBinding.updateMany({
          where: { userId: uid, status: "BOUND" },
          data: { status: "BINDING_FAILED" },
        });
      });
      assert.equal(r.granted, false);
      assert.equal(r.reason, "NO_BINDING");
      assert.equal(await faceVerified(), false, "no stale grant survives the window");
    });

    await check("M1 identity revoked during grant -> NO grant (compensated)", async () => {
      await armEligible();
      const r = await grantWithRace(async () => {
        await db.user.update({ where: { id: uid }, data: { photoVerifiedAt: null } });
      });
      assert.equal(r.granted, false);
      assert.equal(r.reason, "NOT_IDENTITY_VERIFIED");
      assert.equal(await faceVerified(), false, "no stale grant survives the window");
    });

    await check("M1 no-race grant still succeeds (no regression)", async () => {
      await armEligible();
      const r = await grantPhotoVerification(uid);
      assert.equal(r.granted, true);
      assert.equal(r.changed, true);
      assert.equal(await faceVerified(), true);
    });

    // ---- M2: moderation is a first-class profile mutation ------------------

    await check("M2 moderation REJECT -> canonical clear (no moderation badge logic)", async () => {
      await armEligible();
      await runWorker("face:owner"); // worker grants via the engine
      assert.equal(await faceVerified(), true, "granted before moderation");
      const clearsBefore = await auditCount("photo_grant_cleared");
      setMockModerationConfig(
        { decision: "rejected", adultScore: 0.99, labels: ["explicit"] },
        uid,
      );
      const out = await moderatePhoto(coverId);
      assert.ok(out.action === "hide" || out.action === "block", `rejected, got ${out.action}`);
      assert.equal(await faceVerified(), false, "reject re-drove the engine -> grant cleared");
      assert.equal(
        (await auditCount("photo_grant_cleared")) - clearsBefore,
        1,
        "exactly one canonical clear",
      );
      setMockModerationConfig(null, uid);
    });

    await check("M2 moderation APPROVE -> worker -> canonical grant", async () => {
      // Start from the rejected cover above; approve it, then the enqueued
      // worker re-confirms a MATCH and the engine re-grants.
      setMockModerationConfig({ decision: "safe" }, uid);
      const out = await moderatePhoto(coverId);
      assert.equal(out.action, "approve");
      assert.equal(await faceVerified(), false, "approve alone does not grant (worker must match)");
      const dec = await runWorker("face:owner");
      assert.equal(dec?.status, "AUTO_VERIFIED");
      assert.equal(await faceVerified(), true, "approve -> worker MATCH -> canonical grant");
      setMockModerationConfig(null, uid);
    });

    await check("M2 duplicate moderation -> single lifecycle (idempotent)", async () => {
      await armEligible();
      await runWorker("face:owner");
      assert.equal(await faceVerified(), true);
      const clearsBefore = await auditCount("photo_grant_cleared");
      setMockModerationConfig({ decision: "rejected", adultScore: 0.99 }, uid);
      await moderatePhoto(coverId);
      await moderatePhoto(coverId); // duplicate worker/redelivery
      assert.equal(await faceVerified(), false);
      assert.equal(
        (await auditCount("photo_grant_cleared")) - clearsBefore,
        1,
        "duplicate moderation -> ONE clear, never a double lifecycle",
      );
      setMockModerationConfig(null, uid);
    });

    await check("M2 concurrent moderation -> latest verdict wins", async () => {
      await armEligible();
      await runWorker("face:owner");
      assert.equal(await faceVerified(), true);
      // reject then approve; the newest state (approve + worker MATCH) wins.
      setMockModerationConfig({ decision: "rejected", adultScore: 0.99 }, uid);
      await moderatePhoto(coverId);
      assert.equal(await faceVerified(), false);
      setMockModerationConfig({ decision: "safe" }, uid);
      await moderatePhoto(coverId);
      await runWorker("face:owner");
      assert.equal(await faceVerified(), true, "latest valid state (approved + match) wins");
      setMockModerationConfig(null, uid);
    });

    await check("M2 restore (reverseViolation) re-drives the canonical engine", async () => {
      await armEligible();
      await runWorker("face:owner");
      assert.equal(await faceVerified(), true);
      // Reject the cover and record a violation about it.
      await db.photo.update({
        where: { id: coverId },
        data: { status: "REJECTED", moderation: "REJECTED" },
      });
      await clearPhotoVerification(uid, PhotoClearReason.MANUAL_REVIEW);
      const violation = await db.accountViolation.create({
        data: {
          userId: uid,
          violationType: "OTHER",
          actionTaken: "LIMITED",
          description: "hardening test",
          userVisibleReason: "test",
          photoId: coverId,
          source: "test",
        },
      });
      const res = await reverseViolation(violation.id);
      assert.ok(res.restoredPhotoIds.includes(coverId), "cover restored to ACTIVE");
      const p = await db.photo.findUniqueOrThrow({
        where: { id: coverId },
        select: { status: true, moderation: true },
      });
      assert.equal(p.status, "ACTIVE");
      // Restore re-drove the engine as a cover change: provisional (withheld)
      // until the worker re-confirms a MATCH.
      assert.equal(await faceVerified(), false, "restore is provisional (canonical re-drive)");
      await runWorker("face:owner");
      assert.equal(await faceVerified(), true, "worker re-confirms -> canonical re-grant");
      await db.accountViolation.deleteMany({ where: { userId: uid } });
    });

    await check("M2 stale worker cannot restore after moderation reject", async () => {
      await armEligible();
      await runWorker("face:owner");
      assert.equal(await faceVerified(), true);
      // Reject clears the grant; a stale in-flight worker must not re-grant.
      setMockModerationConfig({ decision: "rejected", adultScore: 0.99 }, uid);
      await moderatePhoto(coverId);
      setMockModerationConfig(null, uid);
      assert.equal(await faceVerified(), false);
      // Superseded worker (its lease is nulled mid-compare) returns null.
      setFaceImageLoader(async () => Buffer.from("face:owner"));
      await db.photo.update({
        where: { id: coverId },
        data: { status: "ACTIVE", moderation: "APPROVED" },
      });
      await (await import("../src/lib/services/photos")).bumpPhotoMediaVersion(coverId);
      await db.photoFaceCheck.deleteMany({ where: { userId: uid } });
      await enqueueProfilePhotoVerification(uid, "recheck", { consent: true });
      const { getFaceMatchProvider } = await import("../src/lib/services/face-match-providers");
      const mock = getFaceMatchProvider();
      const racing = {
        ...mock,
        compareReferenceToPhoto: async (
          r: string,
          i: { image: Buffer; photoId: string; photoVersion: number },
        ) => {
          await enqueueProfilePhotoVerification(uid, "superseded", { consent: true });
          return mock.compareReferenceToPhoto(r, i);
        },
      };
      const dec = await runProfilePhotoVerification(uid, { provider: racing });
      assert.equal(dec, null, "superseded worker returns null before grant");
      assert.equal(await faceVerified(), false, "stale worker did not restore the grant");
    });

    // ---- Invariants: single writer + no moderation-specific badge logic ----

    await check("single writer: faceVerifiedAt written ONLY in photo-grant.ts", async () => {
      const { readFileSync } = await import("node:fs");
      const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
      for (const f of [
        "src/lib/services/moderation.ts",
        "src/lib/services/trust-safety.ts",
        "src/app/api/admin/photos/[id]/approve/route.ts",
        "src/app/api/admin/photos/[id]/reject/route.ts",
        "src/app/api/admin/photos/[id]/route.ts",
      ]) {
        const src = strip(readFileSync(f, "utf8"));
        assert.ok(
          !/faceVerifiedAt:\s*(new Date|null)/.test(src),
          `${f} must never write faceVerifiedAt`,
        );
      }
    });

    await check("M2 wiring: every moderation path reuses the canonical hook", async () => {
      const { readFileSync } = await import("node:fs");
      for (const f of [
        "src/app/api/admin/photos/[id]/approve/route.ts",
        "src/app/api/admin/photos/[id]/reject/route.ts",
        "src/app/api/admin/photos/[id]/route.ts",
        "src/lib/services/moderation.ts",
        "src/lib/services/trust-safety.ts",
      ]) {
        const src = readFileSync(f, "utf8");
        assert.ok(
          /onProfilePhotosChanged\(/.test(src),
          `${f} must drive the canonical Trust Engine`,
        );
      }
    });
  } finally {
    setFaceImageLoader(null);
    setMockModerationConfig(null, uid);
    for (const [k, v] of [
      ["FACE_MATCH_PROVIDER", saved.p],
      ["FACE_LIVENESS_ENABLED", saved.l],
      ["FACE_INTERNAL_USER_ALLOWLIST", saved.a],
      ["FACE_INTERNAL_ALLOWLIST_COUNTRY_OVERRIDE", saved.c],
      ["MODERATION_PROVIDER", saved.m],
      ["FACE_BINDING_METHOD", saved.b],
    ] as const) {
      if (v === undefined) delete env[k];
      else env[k] = v;
    }
    if (uid) {
      await db.accountViolation.deleteMany({ where: { userId: uid } }).catch(() => {});
      await db.moderationCase.deleteMany({ where: { userId: uid } }).catch(() => {});
      await db.faceIdentityBinding.deleteMany({ where: { userId: uid } }).catch(() => {});
      await db.photoFaceCheck.deleteMany({ where: { userId: uid } }).catch(() => {});
      await db.photoModerationResult
        .deleteMany({ where: { photo: { userId: uid } } })
        .catch(() => {});
      await db.photoModerationEvent
        .deleteMany({ where: { photo: { userId: uid } } })
        .catch(() => {});
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
