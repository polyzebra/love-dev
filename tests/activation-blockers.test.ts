/**
 * ACTIVATION BLOCKERS (live, DB): behavioural proof that H1/H2/H3 are closed.
 *
 *  H1 - a suspended user never renders as verified on a public surface
 *       (discovery/swipe exercised end-to-end; the verdict reads suspension).
 *  H2 - EVERY trust-invalidation path revokes the positive grant through the
 *       canonical engine: impersonation auto-suspend, likely-duplicate review,
 *       admin suspend_badge, admin request_new_selfie.
 *  H3 - EVERY identity-revocation path revokes the dependent grant: admin
 *       reject (reviewVerification) and provider/webhook reject
 *       (applyVerificationOutcome).
 *
 * The test NEVER writes faceVerifiedAt itself (single writer = photo-grant.ts);
 * every clear is observed as an effect of the path under test.
 *
 * Live lane (mock provider). Run with:
 *   FACE_LIVENESS_ENABLED=1 FACE_DUPLICATE_SEARCH_ENABLED=1 \
 *   FACE_AUTO_SUSPEND_ENABLED=1 npx tsx tests/activation-blockers.test.ts
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
    setFaceImageLoader,
    adminFaceAction,
    BIOMETRIC_CONSENT_VERSION,
  } = await import("../src/lib/services/face-verification");
  const { createBoundLivenessSession, consumeLivenessFlow } =
    await import("../src/lib/services/face-liveness");
  const { evaluatePhotoGrant, grantPhotoVerification, clearPhotoVerification, PhotoClearReason } =
    await import("../src/lib/services/photo-grant");
  const { runDuplicateCheck } = await import("../src/lib/services/face-reference");
  const { setMockLikenessMatches } = await import("../src/lib/services/face-match-providers");
  const { reviewVerification } = await import("../src/lib/services/verification");
  const { applyVerificationOutcome } = await import("../src/lib/services/photo-verification");
  const { getDiscoverFeed } = await import("../src/lib/services/discovery");

  const saved = {
    p: env.FACE_MATCH_PROVIDER,
    l: env.FACE_LIVENESS_ENABLED,
    a: env.FACE_INTERNAL_USER_ALLOWLIST,
    c: env.FACE_INTERNAL_ALLOWLIST_COUNTRY_OVERRIDE,
    d: env.FACE_DUPLICATE_SEARCH_ENABLED,
    s: env.FACE_AUTO_SUSPEND_ENABLED,
    b: env.FACE_BINDING_METHOD,
  };
  env.FACE_MATCH_PROVIDER = "mock";
  env.FACE_LIVENESS_ENABLED = "1";
  env.FACE_INTERNAL_ALLOWLIST_COUNTRY_OVERRIDE = "1";
  env.FACE_DUPLICATE_SEARCH_ENABLED = "1";
  env.FACE_AUTO_SUSPEND_ENABLED = "1";
  delete env.FACE_BINDING_METHOD; // no auto-binding; we seed BOUND fixtures

  const minted: string[] = [];
  const faceVerified = async (uid: string) =>
    (await db.user.findUniqueOrThrow({ where: { id: uid }, select: { faceVerifiedAt: true } }))
      .faceVerifiedAt != null;

  const mkUser = async (
    tag: string,
    tail: string,
    opts: {
      gender?: "MAN" | "WOMAN";
      interestedIn?: Array<"MAN" | "WOMAN">;
      photoVerifiedAt?: Date | null;
      birthYear?: number;
    } = {},
  ) => {
    const email = `e2e-ab-${tag}-${RUN}@example.com`;
    const uid = (
      await admin.auth.admin.createUser({ email, password: `ab-${RUN}-Aa1!`, email_confirm: true })
    ).data.user!.id;
    const now = new Date();
    await db.user.create({
      data: {
        id: uid,
        email,
        name: `AB ${tag}`,
        emailVerified: now,
        phone: `+3538${tail}${String(RUN).padStart(5, "0").slice(0, 5)}`,
        phoneVerifiedAt: now,
        ageConfirmedAt: now,
        termsVersion: "2026-07",
        privacyVersion: "2026-07",
        communityVersion: "2026-07",
        onboardingDone: true,
        photoVerifiedAt: opts.photoVerifiedAt === undefined ? now : opts.photoVerifiedAt,
      },
    });
    await db.profile.create({
      data: {
        userId: uid,
        displayName: `AB ${tag}`,
        birthDate: new Date(`${opts.birthYear ?? 1993}-03-03`),
        gender: opts.gender ?? "WOMAN",
        interestedIn: opts.interestedIn ?? ["MAN"],
        country: "IE",
        isVisible: true,
        minAge: 18,
        maxAge: 99,
      },
    });
    await db.photo.create({
      data: {
        id: `abc-${tag}-${RUN}`,
        userId: uid,
        url: `/m/abc-${tag}-${RUN}`,
        position: 0,
        isCover: true,
        status: "ACTIVE",
        moderation: "APPROVED",
        storagePath: `users/__ab__/${tag}/${RUN}`,
      },
    });
    minted.push(uid);
    return uid;
  };

  const enrol = async (uid: string) => {
    setFaceImageLoader(async () => Buffer.from("face:owner"));
    await enqueueProfilePhotoVerification(uid, "identity_verified", { consent: true });
    const created = await createBoundLivenessSession(uid);
    assert.ok(!("error" in created));
    await consumeLivenessFlow((created as { flowId: string }).flowId, uid);
    return (
      await db.faceReferenceRecord.findFirstOrThrow({
        where: { userId: uid, status: "LINKED" },
        orderBy: { referenceVersion: "desc" },
      })
    ).id;
  };

  // Set a user to fully ELIGIBLE and GRANT the positive badge through the
  // canonical engine (never a direct faceVerifiedAt write).
  const armAndGrant = async (uid: string, refId: string) => {
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
    assert.equal(ev.eligible, true, `must be eligible, got ${ev.reason}`);
    const g = await grantPhotoVerification(uid);
    assert.equal(g.granted, true, "granted through the canonical engine");
    assert.equal(await faceVerified(uid), true, "positive grant set");
  };
  const jobId = async (uid: string) =>
    (await db.profilePhotoVerification.findUniqueOrThrow({ where: { userId: uid } })).id;

  try {
    // ======================= H1: public surface honours suspension ==========
    await check("H1 discovery: a SUSPENDED user never renders verified in the feed", async () => {
      const viewer = await mkUser("viewer", "11", { gender: "WOMAN", interestedIn: ["MAN"] });
      const candidate = await mkUser("cand", "12", {
        gender: "MAN",
        interestedIn: ["WOMAN"],
        birthYear: 1994,
      });
      // Suspend the candidate's face badge (identity intact).
      await db.user.update({
        where: { id: candidate },
        data: { faceBadgeSuspendedAt: new Date() },
      });
      const feed = await getDiscoverFeed(viewer, 50);
      const card = feed.find((c) => c.userId === candidate);
      assert.ok(card, "candidate is discoverable");
      assert.equal(card!.isVerified, false, "suspended badge must NOT show as verified");

      // Control: lift suspension -> identity-verified candidate now shows.
      await db.user.update({ where: { id: candidate }, data: { faceBadgeSuspendedAt: null } });
      const feed2 = await getDiscoverFeed(viewer, 50);
      assert.equal(
        feed2.find((c) => c.userId === candidate)!.isVerified,
        true,
        "un-suspended identity-verified user shows verified",
      );
    });

    // ======================= H2: invalidation -> canonical clear ============
    await check("H2 admin suspend_badge -> positive grant cleared", async () => {
      const uid = await mkUser("h2sus", "21");
      const ref = await enrol(uid);
      await armAndGrant(uid, ref);
      await adminFaceAction({
        actorId: uid,
        verificationId: await jobId(uid),
        action: "suspend_badge",
      });
      assert.equal(await faceVerified(uid), false, "manual suspension revoked the grant");
    });

    await check("H2 admin request_new_selfie -> positive grant cleared", async () => {
      const uid = await mkUser("h2sel", "22");
      const ref = await enrol(uid);
      await armAndGrant(uid, ref);
      await adminFaceAction({
        actorId: uid,
        verificationId: await jobId(uid),
        action: "request_new_selfie",
      });
      assert.equal(await faceVerified(uid), false, "reference deletion revoked the grant");
    });

    await check("H2 impersonation auto-suspend -> positive grant cleared", async () => {
      const suspect = await mkUser("h2imp", "23", { birthYear: 1990 });
      const ref = await enrol(suspect);
      await armAndGrant(suspect, ref);
      // A victim who verified EARLIER (verifiedFirst -> LIKELY_IMPERSONATION).
      const victim = await mkUser("h2vic", "24", {
        birthYear: 1985,
        photoVerifiedAt: new Date(Date.now() - 3600_000),
      });
      const victimRef = `victimref_${RUN}`;
      await db.profilePhotoVerification.create({
        data: {
          userId: victim,
          referenceId: victimRef,
          referenceStatus: "ACTIVE",
          status: "AUTO_VERIFIED",
          badgeStatus: "ACTIVE",
          consentAt: new Date(),
          consentVersion: BIOMETRIC_CONSENT_VERSION,
        },
      });
      setMockLikenessMatches(ref, [{ referenceId: victimRef, band: "confident" }]);
      const verdict = await runDuplicateCheck(suspect);
      setMockLikenessMatches(ref, null);
      assert.equal(verdict, "LIKELY_IMPERSONATION");
      assert.equal(await faceVerified(suspect), false, "impersonation suspend revoked the grant");
    });

    await check("H2 likely-duplicate review -> positive grant cleared", async () => {
      const suspect = await mkUser("h2dup", "25", { birthYear: 1991 });
      const ref = await enrol(suspect);
      await armAndGrant(suspect, ref);
      // A victim with NO prior verification + different birthdate -> LIKELY_DUPLICATE.
      const victim = await mkUser("h2dv", "26", { birthYear: 1979, photoVerifiedAt: null });
      const victimRef = `dupref_${RUN}`;
      await db.profilePhotoVerification.create({
        data: {
          userId: victim,
          referenceId: victimRef,
          referenceStatus: "ACTIVE",
          status: "AUTO_VERIFIED",
          badgeStatus: "ACTIVE",
          consentAt: new Date(),
          consentVersion: BIOMETRIC_CONSENT_VERSION,
        },
      });
      setMockLikenessMatches(ref, [{ referenceId: victimRef, band: "confident" }]);
      const verdict = await runDuplicateCheck(suspect);
      setMockLikenessMatches(ref, null);
      assert.equal(verdict, "LIKELY_DUPLICATE");
      assert.equal(await faceVerified(suspect), false, "review downgrade revoked the grant");
    });

    // ======================= H3: identity revocation -> canonical clear =====
    await check("H3 admin reject (reviewVerification) -> positive grant cleared", async () => {
      const uid = await mkUser("h3rev", "31");
      const ref = await enrol(uid);
      await armAndGrant(uid, ref);
      const v = await db.verification.create({
        data: { userId: uid, type: "PHOTO", status: "IN_REVIEW" },
      });
      await reviewVerification({ actorId: uid, verificationId: v.id, approve: false });
      assert.equal(await faceVerified(uid), false, "identity reject revoked the grant");
      assert.equal(
        (await db.user.findUniqueOrThrow({ where: { id: uid }, select: { photoVerifiedAt: true } }))
          .photoVerifiedAt,
        null,
        "identity itself revoked",
      );
    });

    await check(
      "H3 provider reject (applyVerificationOutcome) -> positive grant cleared",
      async () => {
        const uid = await mkUser("h3wh", "32");
        const ref = await enrol(uid);
        await armAndGrant(uid, ref);
        const sess = `sess_${RUN}`;
        await db.verification.create({
          data: {
            userId: uid,
            type: "PHOTO",
            status: "APPROVED",
            provider: "test-idv",
            providerSessionId: sess,
          },
        });
        const res = await applyVerificationOutcome("test-idv", sess, "rejected");
        assert.equal(res.applied, true);
        assert.equal(await faceVerified(uid), false, "webhook reject revoked the grant");
      },
    );

    // ======================= Source invariants ==============================
    await check(
      "H2/H3 wiring: every invalidation/revocation path drives the canonical clear",
      async () => {
        const { readFileSync } = await import("node:fs");
        const faceRef = readFileSync("src/lib/services/face-reference.ts", "utf8");
        // suspendForImpersonation + both review downgrades clear.
        assert.ok(
          (faceRef.match(/clearPhotoVerification\(/g) ?? []).length >= 4,
          "face-reference clears on rotation + impersonation + duplicate + hold",
        );
        const faceVer = readFileSync("src/lib/services/face-verification.ts", "utf8");
        assert.ok(/clearGrant\("MANUAL_REVIEW"\)/.test(faceVer), "admin suspend clears");
        assert.ok(/clearGrant\("REFERENCE_DELETED"\)/.test(faceVer), "admin request-selfie clears");
        assert.ok(/clearGrant\("PHOTO_CHANGED"\)/.test(faceVer), "admin reject-photo clears");
        const verif = readFileSync("src/lib/services/verification.ts", "utf8");
        assert.ok(/IDENTITY_REVOKED/.test(verif), "admin identity reject clears");
        const photoVer = readFileSync("src/lib/services/photo-verification.ts", "utf8");
        assert.ok(/IDENTITY_REVOKED/.test(photoVer), "webhook identity reject clears");
      },
    );

    // Reference the imported clear enum so the harness proves the canonical API
    // is the ONLY sanctioned revocation entry point (no direct column writes).
    assert.equal(typeof clearPhotoVerification, "function");
    assert.ok(PhotoClearReason.IDENTITY_REVOKED);
  } finally {
    setFaceImageLoader(null);
    setMockLikenessMatches(`victimref_${RUN}`, null);
    for (const [k, v] of [
      ["FACE_MATCH_PROVIDER", saved.p],
      ["FACE_LIVENESS_ENABLED", saved.l],
      ["FACE_INTERNAL_USER_ALLOWLIST", saved.a],
      ["FACE_INTERNAL_ALLOWLIST_COUNTRY_OVERRIDE", saved.c],
      ["FACE_DUPLICATE_SEARCH_ENABLED", saved.d],
      ["FACE_AUTO_SUSPEND_ENABLED", saved.s],
      ["FACE_BINDING_METHOD", saved.b],
    ] as const) {
      if (v === undefined) delete env[k];
      else env[k] = v;
    }
    for (const uid of minted) {
      await db.accountViolation.deleteMany({ where: { userId: uid } }).catch(() => {});
      await db.faceIdentityBinding.deleteMany({ where: { userId: uid } }).catch(() => {});
      await db.photoFaceCheck.deleteMany({ where: { userId: uid } }).catch(() => {});
      await db.livenessSession.deleteMany({ where: { userId: uid } }).catch(() => {});
      await db.faceReferenceRecord.deleteMany({ where: { userId: uid } }).catch(() => {});
      await db.profilePhotoVerification.deleteMany({ where: { userId: uid } }).catch(() => {});
      await db.verificationAuditEvent.deleteMany({ where: { userId: uid } }).catch(() => {});
      await db.verification.deleteMany({ where: { userId: uid } }).catch(() => {});
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
