/**
 * Epic 3 (live, DB): the Human Review binding provider + review decision
 * service. Proves the provider never produces BOUND on its own; that only an
 * authorized review through FaceBindingEngine.completeReview() reaches BOUND;
 * that BOUND ALONE never grants Photo Verified (a current cover MATCH is still
 * required); and the failure/consent/identity/concurrency guards. Dormant
 * unless configured + legally approved.
 *
 * Live lane. Run with: FACE_LIVENESS_ENABLED=1 npx tsx tests/human-review-binding.test.ts
 */
import "dotenv/config";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
  const { humanReviewConfigured, humanReviewBindingProvider, BindingReviewReason } =
    await import("../src/lib/services/human-review-binding");
  const { getBindingProvider, BINDING_STATUS } = await import("../src/lib/services/face-binding");
  const { submitBindingReview } = await import("../src/lib/services/face-binding-review");
  const { enqueueProfilePhotoVerification, setFaceImageLoader } =
    await import("../src/lib/services/face-verification");
  const { createBoundLivenessSession, consumeLivenessFlow } =
    await import("../src/lib/services/face-liveness");

  const REVIEWER = { id: "" };

  const saved = {
    p: env.FACE_MATCH_PROVIDER,
    l: env.FACE_LIVENESS_ENABLED,
    m: env.FACE_BINDING_METHOD,
    lg: env.FACE_BINDING_LEGAL_APPROVAL_VERSION,
    a: env.FACE_INTERNAL_USER_ALLOWLIST,
    c: env.FACE_INTERNAL_ALLOWLIST_COUNTRY_OVERRIDE,
    e: env.FACE_EMERGENCY_DISABLE,
  };
  env.FACE_MATCH_PROVIDER = "mock";
  env.FACE_LIVENESS_ENABLED = "1";
  env.FACE_BINDING_METHOD = "HUMAN_REVIEW";
  env.FACE_BINDING_LEGAL_APPROVAL_VERSION = "test-binding-legal-v1";
  env.FACE_INTERNAL_ALLOWLIST_COUNTRY_OVERRIDE = "1";
  delete env.FACE_EMERGENCY_DISABLE;

  const minted: string[] = [];
  const mkUser = async (tag: string, tail: string, opts: { identity?: boolean } = {}) => {
    const email = `e2e-hr-${tag}-${RUN}@example.com`;
    const uid = (
      await admin.auth.admin.createUser({ email, password: `hr-${RUN}-Aa1!`, email_confirm: true })
    ).data.user!.id;
    const now = new Date();
    await db.user.create({
      data: {
        id: uid,
        email,
        name: `HR ${tag}`,
        emailVerified: now,
        phone: `+35389${tail}${String(RUN).padStart(4, "0").slice(0, 2)}`,
        phoneVerifiedAt: now,
        ageConfirmedAt: now,
        termsVersion: "2026-07",
        privacyVersion: "2026-07",
        communityVersion: "2026-07",
        onboardingDone: true,
        photoVerifiedAt: opts.identity === false ? null : now,
      },
    });
    await db.profile.create({
      data: {
        userId: uid,
        displayName: `HR ${tag}`,
        birthDate: new Date("1993-03-03"),
        gender: "WOMAN",
        country: "IE",
      },
    });
    await db.photo.create({
      data: {
        id: `hr${tag}${RUN}`,
        userId: uid,
        url: `/m/hr${tag}${RUN}`,
        position: 0,
        isCover: true,
        status: "ACTIVE",
        moderation: "APPROVED",
        storagePath: `users/__hr${tag}__/photos/hr${RUN}`,
      },
    });
    minted.push(uid);
    return uid;
  };
  // Enrol -> LINKED reference + (auto) MANUAL_REVIEW binding via the hook.
  const enroll = async (uid: string, marker = "face:owner") => {
    setFaceImageLoader(async () => Buffer.from(marker));
    env.FACE_INTERNAL_USER_ALLOWLIST = uid;
    await enqueueProfilePhotoVerification(uid, "identity_verified", { consent: true });
    const created = await createBoundLivenessSession(uid);
    assert.ok(!("error" in created));
    await consumeLivenessFlow((created as { flowId: string }).flowId, uid);
    return db.faceIdentityBinding.findFirstOrThrow({
      where: { userId: uid, status: "MANUAL_REVIEW" },
    });
  };
  const faceVerifiedAt = (uid: string) =>
    db.user
      .findUniqueOrThrow({ where: { id: uid }, select: { faceVerifiedAt: true } })
      .then((u) => u.faceVerifiedAt);
  const bindingStatus = (id: string) =>
    db.faceIdentityBinding
      .findUniqueOrThrow({ where: { id }, select: { status: true } })
      .then((b) => b.status);

  try {
    REVIEWER.id = await mkUser("rev", "00"); // a real user id to act as reviewer

    // ---- provider: never self-produces BOUND ---------------------------
    await check("provider.createBinding -> MANUAL_REVIEW (never BOUND)", async () => {
      const out = await humanReviewBindingProvider.createBinding();
      assert.equal(out.status, BINDING_STATUS.MANUAL_REVIEW);
      const refresh = await humanReviewBindingProvider.refreshBinding();
      assert.equal(refresh.status, BINDING_STATUS.MANUAL_REVIEW);
    });

    await check("dormant unless configured + legally approved", async () => {
      assert.equal(humanReviewConfigured(), true, "configured in this test");
      assert.ok(getBindingProvider("HUMAN_REVIEW"), "factory resolves when configured");
      const savedLegal = env.FACE_BINDING_LEGAL_APPROVAL_VERSION;
      delete env.FACE_BINDING_LEGAL_APPROVAL_VERSION;
      assert.equal(humanReviewConfigured(), false, "no legal approval -> dormant");
      assert.equal(
        getBindingProvider("HUMAN_REVIEW"),
        null,
        "factory returns null when unconfigured",
      );
      env.FACE_BINDING_LEGAL_APPROVAL_VERSION = savedLegal;
    });

    // ---- enrollment auto-opens a review binding ------------------------
    await check(
      "enrollment opens a MANUAL_REVIEW binding when human review is configured",
      async () => {
        const uid = await mkUser("enr", "01");
        const b = await enroll(uid);
        assert.equal(b.status, "MANUAL_REVIEW");
        assert.equal(b.method, "HUMAN_REVIEW");
      },
    );

    // ---- GOLDEN: BOUND + current MATCH -> grant ------------------------
    await check(
      "BOUND + current cover MATCH -> grantPhotoVerification sets faceVerifiedAt",
      async () => {
        const uid = await mkUser("gold", "02");
        const b = await enroll(uid, "face:owner");
        const r = await submitBindingReview({
          bindingId: b.id,
          decision: "BOUND",
          reasonCode: BindingReviewReason.SAME_PERSON_CONFIRMED,
          reviewer: REVIEWER,
        });
        assert.equal(r.ok, true, r.code);
        assert.equal(await bindingStatus(b.id), "BOUND");
        assert.equal(r.granted, true, "granted after MATCH");
        assert.notEqual(await faceVerifiedAt(uid), null);
      },
    );

    // ---- BOUND ALONE never grants without a MATCH ----------------------
    await check("BOUND but cover MISMATCH -> binding BOUND yet NO grant", async () => {
      const uid = await mkUser("nomatch", "03");
      const b = await enroll(uid, "face:owner");
      // Flip the cover bytes to an impostor before the post-BOUND profile run.
      setFaceImageLoader(async () => Buffer.from("face:other"));
      await db.photoFaceCheck.deleteMany({ where: { userId: uid } });
      const r = await submitBindingReview({
        bindingId: b.id,
        decision: "BOUND",
        reasonCode: BindingReviewReason.SAME_PERSON_CONFIRMED,
        reviewer: REVIEWER,
      });
      assert.equal(await bindingStatus(b.id), "BOUND", "binding still bound");
      assert.equal(r.granted, false, "no grant without MATCH");
      assert.equal(await faceVerifiedAt(uid), null, "faceVerifiedAt stays null");
    });

    // ---- BINDING_FAILED -----------------------------------------------
    await check("BINDING_FAILED -> failed + no grant + account usable", async () => {
      const uid = await mkUser("fail", "04");
      const b = await enroll(uid);
      const r = await submitBindingReview({
        bindingId: b.id,
        decision: "BINDING_FAILED",
        reasonCode: BindingReviewReason.DIFFERENT_PERSON,
        reviewer: REVIEWER,
      });
      assert.equal(r.ok, true);
      assert.equal(await bindingStatus(b.id), "BINDING_FAILED");
      assert.equal(await faceVerifiedAt(uid), null);
      const u = await db.user.findUniqueOrThrow({ where: { id: uid }, select: { status: true } });
      assert.equal(u.status, "ACTIVE", "no automatic ban/restriction");
    });

    // ---- REQUEST_NEW_CAPTURE ------------------------------------------
    await check(
      "REQUEST_NEW_CAPTURE -> binding invalidated + reference LIVENESS_REQUIRED",
      async () => {
        const uid = await mkUser("newcap", "05");
        const b = await enroll(uid);
        const r = await submitBindingReview({
          bindingId: b.id,
          decision: "REQUEST_NEW_CAPTURE",
          reasonCode: BindingReviewReason.FACE_OBSCURED,
          reviewer: REVIEWER,
        });
        assert.equal(r.ok, true);
        assert.equal(await bindingStatus(b.id), "NOT_BOUND");
        const job = await db.profilePhotoVerification.findUniqueOrThrow({
          where: { userId: uid },
          select: { status: true },
        });
        assert.equal(job.status, "LIVENESS_REQUIRED");
      },
    );

    // ---- guards --------------------------------------------------------
    await check("consent withdrawn -> BOUND blocked (CONSENT_NOT_ACTIVE)", async () => {
      const uid = await mkUser("noconsent", "06");
      const b = await enroll(uid);
      await db.profilePhotoVerification.update({
        where: { userId: uid },
        data: { consentAt: null, consentVersion: null },
      });
      const r = await submitBindingReview({
        bindingId: b.id,
        decision: "BOUND",
        reasonCode: BindingReviewReason.SAME_PERSON_CONFIRMED,
        reviewer: REVIEWER,
      });
      assert.equal(r.code, "CONSENT_NOT_ACTIVE");
      assert.equal(await bindingStatus(b.id), "MANUAL_REVIEW", "unchanged");
    });

    await check("identity not verified -> BOUND blocked (IDENTITY_NOT_VERIFIED)", async () => {
      const uid = await mkUser("noid", "07");
      const b = await enroll(uid);
      await db.user.update({ where: { id: uid }, data: { photoVerifiedAt: null } });
      const r = await submitBindingReview({
        bindingId: b.id,
        decision: "BOUND",
        reasonCode: BindingReviewReason.SAME_PERSON_CONFIRMED,
        reviewer: REVIEWER,
      });
      assert.equal(r.code, "IDENTITY_NOT_VERIFIED");
    });

    await check("invalid reason for decision -> INVALID_REASON", async () => {
      const uid = await mkUser("badreason", "08");
      const b = await enroll(uid);
      const r = await submitBindingReview({
        bindingId: b.id,
        decision: "BOUND",
        reasonCode: BindingReviewReason.DIFFERENT_PERSON,
        reviewer: REVIEWER,
      });
      assert.equal(r.code, "INVALID_REASON");
    });

    await check("double submit is not re-reviewable + concurrent reviews: one wins", async () => {
      const uid = await mkUser("concurrent", "09");
      const b = await enroll(uid);
      const [a, c] = await Promise.all([
        submitBindingReview({
          bindingId: b.id,
          decision: "BOUND",
          reasonCode: BindingReviewReason.SAME_PERSON_CONFIRMED,
          reviewer: REVIEWER,
        }),
        submitBindingReview({
          bindingId: b.id,
          decision: "BINDING_FAILED",
          reasonCode: BindingReviewReason.DIFFERENT_PERSON,
          reviewer: REVIEWER,
        }),
      ]);
      const wins = [a, c].filter((x) => x.ok).length;
      assert.equal(wins, 1, "exactly one concurrent decision wins");
      // A third submit is not reviewable.
      const third = await submitBindingReview({
        bindingId: b.id,
        decision: "BOUND",
        reasonCode: BindingReviewReason.SAME_PERSON_CONFIRMED,
        reviewer: REVIEWER,
      });
      assert.equal(third.code, "NOT_REVIEWABLE");
    });

    await check("emergency disable -> no completion (EMERGENCY_DISABLED)", async () => {
      const uid = await mkUser("emerg", "10");
      const b = await enroll(uid);
      env.FACE_EMERGENCY_DISABLE = "1";
      const r = await submitBindingReview({
        bindingId: b.id,
        decision: "BOUND",
        reasonCode: BindingReviewReason.SAME_PERSON_CONFIRMED,
        reviewer: REVIEWER,
      });
      assert.equal(r.code, "EMERGENCY_DISABLED");
      delete env.FACE_EMERGENCY_DISABLE;
      assert.equal(await bindingStatus(b.id), "MANUAL_REVIEW");
    });

    // ---- audit + exclusivity + route authz (source) --------------------
    await check(
      "BOUND decision audited: actorType admin, reviewer server-derived, no PII",
      async () => {
        const ev = await db.verificationAuditEvent.findFirst({
          where: { eventType: "binding_bound", actorId: REVIEWER.id },
          orderBy: { createdAt: "desc" },
        });
        assert.ok(ev, "binding_bound audit exists");
        assert.equal(ev!.actorType, "admin");
        const meta = (ev!.metadata ?? {}) as Record<string, unknown>;
        assert.ok(!("image" in meta) && !("similarity" in meta), "no biometric data in audit");
      },
    );

    await check(
      "review service never writes FaceIdentityBinding.status directly (engine-only)",
      async () => {
        const src = readFileSync("src/lib/services/face-binding-review.ts", "utf8");
        assert.ok(
          !/faceIdentityBinding\.(update|updateMany|create|upsert)/.test(src),
          "no direct binding mutation",
        );
        assert.ok(
          !/faceVerifiedAt:\s*(new Date|null)/.test(src),
          "review service never writes faceVerifiedAt directly",
        );
      },
    );

    await check(
      "route: safety:manage required + reviewer server-derived (no client reviewerId)",
      async () => {
        const src = readFileSync(
          "src/app/api/admin/verification/bindings/[id]/review/route.ts",
          "utf8",
        );
        assert.ok(/requirePermission\("safety:manage"\)/.test(src), "strong permission");
        assert.ok(/reviewer:\s*\{\s*id:\s*actor\.id\s*\}/.test(src), "reviewer from session");
        assert.ok(!/reviewerId/.test(src), "no client reviewerId");
      },
    );
  } finally {
    setFaceImageLoader(null);
    for (const [k, v] of [
      ["FACE_MATCH_PROVIDER", saved.p],
      ["FACE_LIVENESS_ENABLED", saved.l],
      ["FACE_BINDING_METHOD", saved.m],
      ["FACE_BINDING_LEGAL_APPROVAL_VERSION", saved.lg],
      ["FACE_INTERNAL_USER_ALLOWLIST", saved.a],
      ["FACE_INTERNAL_ALLOWLIST_COUNTRY_OVERRIDE", saved.c],
      ["FACE_EMERGENCY_DISABLE", saved.e],
    ] as const) {
      if (v === undefined) delete env[k];
      else env[k] = v;
    }
    for (const uid of minted) {
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
