/**
 * Epic 2 (live, DB): the FaceBindingEngine facade. Proves the engine drives
 * FaceIdentityBinding through validated, audited transitions; that it is
 * DORMANT without a provider (NOT_IMPLEMENTED, never BOUND); that only the
 * test double produces BOUND; that rotation/withdrawal invalidate; that
 * illegal transitions are refused; and that the BOUND row is exactly the shape
 * Epic 1's evaluatePhotoGrant() queries. No production provider exists.
 *
 * Live lane. Run with: npx tsx tests/face-binding-engine.test.ts
 */
import "dotenv/config";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { FakeBindingProvider } from "./support/fake-binding-provider";

let passed = 0;
async function check(name: string, fn: () => Promise<void>): Promise<void> {
  await fn();
  passed += 1;
  console.log(`  ok - ${name}`);
}

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
  const { FaceBindingEngine, setBindingProviderOverride, resetBindingProviders } =
    await import("../src/lib/services/face-binding");

  let uid = "";
  let refId = "";
  const fake = new FakeBindingProvider({ method: "HUMAN_REVIEW", status: "BOUND" });
  const auditCount = (eventType: string) =>
    db.verificationAuditEvent.count({ where: { userId: uid, eventType } });
  const statusOf = (id: string) =>
    db.faceIdentityBinding
      .findUniqueOrThrow({ where: { id }, select: { status: true } })
      .then((b) => b.status);

  try {
    const email = `e2e-bind-${RUN}@example.com`;
    uid = (
      await admin.auth.admin.createUser({
        email,
        password: `bind-${RUN}-Aa1!`,
        email_confirm: true,
      })
    ).data.user!.id;
    const now = new Date();
    await db.user.create({
      data: {
        id: uid,
        email,
        name: "BIND",
        emailVerified: now,
        phone: `+3538799${String(RUN).padStart(4, "0").slice(0, 4)}`,
        phoneVerifiedAt: now,
        ageConfirmedAt: now,
        termsVersion: "2026-07",
        privacyVersion: "2026-07",
        communityVersion: "2026-07",
        onboardingDone: true,
        photoVerifiedAt: now,
      },
    });
    const job = await db.profilePhotoVerification.create({
      data: { userId: uid, provider: "mock", status: "QUEUED", badgeStatus: "NONE" },
    });
    const ref = await db.faceReferenceRecord.create({
      data: {
        userId: uid,
        verificationId: job.id,
        referenceVersion: 1,
        provider: "mock",
        environment: "staging",
        idempotencyKey: `idem-${RUN}`,
        externalImageId: `img-${RUN}`,
        status: "LINKED",
      },
    });
    refId = ref.id;

    // ---- request -------------------------------------------------------
    let bindingId = "";
    await check("requestBinding: NOT_BOUND -> BINDING_REQUIRED + audit", async () => {
      const r = await FaceBindingEngine.requestBinding(
        { userId: uid, faceReferenceId: refId },
        "HUMAN_REVIEW",
      );
      assert.equal(r.code, "OK");
      assert.equal(r.status, "BINDING_REQUIRED");
      bindingId = r.bindingId!;
      assert.equal(await auditCount("binding_requested"), 1);
    });

    // ---- dormant: no provider -> NOT_IMPLEMENTED, never BOUND ----------
    await check("processBinding with NO provider -> NOT_IMPLEMENTED (dormant)", async () => {
      resetBindingProviders();
      const r = await FaceBindingEngine.processBinding(bindingId);
      assert.equal(r.code, "NOT_IMPLEMENTED");
      assert.equal(await statusOf(bindingId), "BINDING_REQUIRED", "unadvanced");
      assert.equal(
        await db.faceIdentityBinding.count({ where: { userId: uid, status: "BOUND" } }),
        0,
      );
    });

    // ---- the ONLY path to BOUND: a registered test double -------------
    await check("processBinding with the Fake -> BOUND (started + succeeded audits)", async () => {
      setBindingProviderOverride("HUMAN_REVIEW", fake);
      fake.setOutcome("BOUND");
      const r = await FaceBindingEngine.processBinding(bindingId);
      assert.equal(r.code, "OK");
      assert.equal(r.status, "BOUND");
      const row = await db.faceIdentityBinding.findUniqueOrThrow({ where: { id: bindingId } });
      assert.equal(row.status, "BOUND");
      assert.equal(
        row.faceReferenceId,
        refId,
        "BOUND row targets the current reference (evaluatePhotoGrant shape)",
      );
      assert.notEqual(row.boundAt, null);
      assert.equal(await auditCount("binding_started"), 1);
      assert.equal(await auditCount("binding_succeeded"), 1);
    });

    await check("audit has NO PII (bindingId + method only)", async () => {
      const ev = await db.verificationAuditEvent.findFirstOrThrow({
        where: { userId: uid, eventType: "binding_succeeded" },
      });
      const meta = (ev.metadata ?? {}) as Record<string, unknown>;
      assert.deepEqual(Object.keys(meta).sort(), ["bindingId", "method"]);
      assert.equal(meta.method, "HUMAN_REVIEW");
    });

    // ---- rotation / withdrawal invalidation ---------------------------
    await check("invalidate(reference_rotated) -> NOT_BOUND + audit", async () => {
      const n = await FaceBindingEngine.invalidateBinding(uid, "reference_rotated");
      assert.equal(n, 1);
      assert.equal(await statusOf(bindingId), "NOT_BOUND");
      assert.equal(await auditCount("binding_invalidated"), 1);
    });

    // ---- MANUAL_REVIEW + completeReview -------------------------------
    await check(
      "MANUAL_REVIEW outcome -> review requested, then completeReview -> BOUND",
      async () => {
        const req = await FaceBindingEngine.requestBinding(
          { userId: uid, faceReferenceId: refId },
          "HUMAN_REVIEW",
        );
        fake.setOutcome("MANUAL_REVIEW");
        const p = await FaceBindingEngine.processBinding(req.bindingId!);
        assert.equal(p.status, "MANUAL_REVIEW");
        assert.ok((await auditCount("binding_review_requested")) >= 1);
        const done = await FaceBindingEngine.completeReview(req.bindingId!, "BOUND", { id: uid });
        assert.equal(done.status, "BOUND");
        assert.ok((await auditCount("binding_review_completed")) >= 1);
      },
    );

    // ---- provider unavailable -----------------------------------------
    await check("provider unavailable -> PROVIDER_UNAVAILABLE, no BOUND", async () => {
      const req = await FaceBindingEngine.requestBinding(
        { userId: uid, faceReferenceId: refId },
        "HUMAN_REVIEW",
      );
      fake.setAvailable(false);
      const p = await FaceBindingEngine.processBinding(req.bindingId!);
      assert.equal(p.status, "PROVIDER_UNAVAILABLE");
      fake.setAvailable(true);
    });

    // ---- illegal transition refused -----------------------------------
    await check("illegal transition refused (completeReview on BINDING_REQUIRED)", async () => {
      const req = await FaceBindingEngine.requestBinding(
        { userId: uid, faceReferenceId: refId },
        "HUMAN_REVIEW",
      );
      // BINDING_REQUIRED -> BOUND is NOT allowed (must pass IN_PROGRESS/REVIEW).
      const r = await FaceBindingEngine.completeReview(req.bindingId!, "BOUND", { id: uid });
      assert.equal(r.code, "ILLEGAL_TRANSITION");
      assert.equal(await statusOf(req.bindingId!), "BINDING_REQUIRED", "unchanged");
    });

    await check("consent withdrawal invalidation -> CONSENT_WITHDRAWN", async () => {
      const req = await FaceBindingEngine.requestBinding(
        { userId: uid, faceReferenceId: refId },
        "HUMAN_REVIEW",
      );
      fake.setOutcome("BOUND");
      await FaceBindingEngine.processBinding(req.bindingId!);
      await FaceBindingEngine.invalidateBinding(uid, "consent_withdrawn");
      assert.equal(await statusOf(req.bindingId!), "CONSENT_WITHDRAWN");
    });
  } finally {
    resetBindingProviders();
    if (uid) {
      await db.faceIdentityBinding.deleteMany({ where: { userId: uid } }).catch(() => {});
      await db.faceReferenceRecord.deleteMany({ where: { userId: uid } }).catch(() => {});
      await db.profilePhotoVerification.deleteMany({ where: { userId: uid } }).catch(() => {});
      await db.verificationAuditEvent.deleteMany({ where: { userId: uid } }).catch(() => {});
      await db.user.deleteMany({ where: { id: uid } }).catch(() => {});
      await admin.auth.admin.deleteUser(uid).catch(() => {});
    }
    void refId;
    await db.$disconnect();
  }

  console.log(`\n${passed} checks passed`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
