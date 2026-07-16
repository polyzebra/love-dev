/**
 * Epic 5 (live, DB): the internal Trust rehearsal. Exercises the ENTIRE trust
 * engine end-to-end through supported services only - identity -> consent ->
 * liveness -> binding -> human review -> BOUND -> profile MATCH -> grant ->
 * Photo Verified -> cover swaps (keep / suspend / restore) -> withdraw ->
 * delete -> emergency disable -> rollback - with structured, PII-free evidence
 * and deterministic cleanup. No production users; no manual DB edits in the
 * lifecycle (test only seeds the internal subject + controls mock cover bytes).
 *
 * Live lane. Run with: FACE_LIVENESS_ENABLED=1 npx tsx tests/trust-rehearsal.test.ts
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
  const { preflight, admitSubject, runTrustRehearsal, rollbackRehearsal } =
    await import("../src/lib/services/trust-rehearsal");
  const { setFaceImageLoader } = await import("../src/lib/services/face-verification");

  // Full configured + legally-approved rehearsal environment.
  const SAVED = Object.fromEntries(
    [
      "FACE_MATCH_PROVIDER",
      "FACE_LIVENESS_ENABLED",
      "FACE_BINDING_METHOD",
      "FACE_BINDING_LEGAL_APPROVAL_VERSION",
      "FACE_LEGAL_APPROVED_VERSIONS",
      "FACE_LEGAL_APPROVAL_VERSION",
      "FACE_AWS_DPA_CONFIRMED",
      "FACE_CALIBRATION_APPROVED",
      "FACE_CALIBRATION_VERSION",
      "ALERT_WEBHOOK_URL",
      "FACE_VERIFICATION_PERCENT",
      "FACE_INTERNAL_USER_ALLOWLIST",
      "FACE_INTERNAL_ALLOWLIST_COUNTRY_OVERRIDE",
      "FACE_EMERGENCY_DISABLE_TESTED",
      "FACE_EMERGENCY_DISABLE",
    ].map((k) => [k, env[k]]),
  );
  Object.assign(env, {
    FACE_MATCH_PROVIDER: "mock",
    FACE_LIVENESS_ENABLED: "1",
    FACE_BINDING_METHOD: "HUMAN_REVIEW",
    FACE_BINDING_LEGAL_APPROVAL_VERSION: "rehearsal-bind-v1",
    FACE_LEGAL_APPROVED_VERSIONS: "rehearsal-legal-v1",
    FACE_LEGAL_APPROVAL_VERSION: "rehearsal-legal-v1",
    FACE_AWS_DPA_CONFIRMED: "1",
    FACE_CALIBRATION_APPROVED: "1",
    FACE_CALIBRATION_VERSION: "cal-rehearsal",
    ALERT_WEBHOOK_URL: "https://hooks.example.com/ops",
    FACE_VERIFICATION_PERCENT: "0",
    FACE_INTERNAL_ALLOWLIST_COUNTRY_OVERRIDE: "1",
    FACE_EMERGENCY_DISABLE_TESTED: "1",
  });
  delete env.FACE_EMERGENCY_DISABLE;
  const setCover = async (m: "face:owner" | "face:other" | "face:uncertain") =>
    setFaceImageLoader(async () => Buffer.from(m));

  const minted: string[] = [];
  const mkUser = async (tag: string, tail: string) => {
    const email = `e2e-reh5-${tag}-${RUN}@example.com`;
    const uid = (
      await admin.auth.admin.createUser({ email, password: `r5-${RUN}-Aa1!`, email_confirm: true })
    ).data.user!.id;
    const now = new Date();
    await db.user.create({
      data: {
        id: uid,
        email,
        name: `R5 ${tag}`,
        emailVerified: now,
        phone: `+35388${tail}${String(RUN).padStart(4, "0").slice(0, 2)}`,
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
        displayName: `R5 ${tag}`,
        birthDate: new Date("1993-03-03"),
        gender: "WOMAN",
        country: "IE",
      },
    });
    minted.push(uid);
    return uid;
  };

  let subject = "";
  let reviewer = "";
  try {
    subject = await mkUser("subj", "01");
    reviewer = await mkUser("rev", "02");
    await db.photo.create({
      data: {
        id: `r5c${RUN}`,
        userId: subject,
        url: `/m/r5c${RUN}`,
        position: 0,
        isCover: true,
        status: "ACTIVE",
        moderation: "APPROVED",
        storagePath: `users/__r5__/photos/r5c${RUN}`,
      },
    });
    env.FACE_INTERNAL_USER_ALLOWLIST = `${subject},${reviewer}`;

    await check("preflight PASSES when fully configured + approved", async () => {
      const pf = preflight();
      assert.equal(
        pf.ok,
        true,
        pf.checks
          .filter((c) => c.status === "FAIL")
          .map((c) => c.id)
          .join(","),
      );
    });

    await check("preflight FAILS (blocks rehearsal) if a required blocker exists", async () => {
      const saved = env.FACE_MATCH_PROVIDER;
      delete env.FACE_MATCH_PROVIDER;
      const pf = preflight();
      assert.equal(pf.ok, false, "unset provider -> FAIL -> no rehearsal");
      env.FACE_MATCH_PROVIDER = saved;
    });

    await check("admission: allowlisted internal subject is admitted", async () => {
      const a = await admitSubject(subject);
      assert.equal(a.admitted, true, a.detail);
    });

    await check("admission: a non-allowlisted user is refused", async () => {
      const stranger = await mkUser("stranger", "03");
      const a = await admitSubject(stranger);
      assert.equal(a.admitted, false);
      assert.equal(a.code, "NOT_ALLOWLISTED");
    });

    let report: Awaited<ReturnType<typeof runTrustRehearsal>>;
    await check("FULL lifecycle runs end-to-end, every step PASS", async () => {
      report = await runTrustRehearsal({ subjectId: subject, reviewerId: reviewer, setCover });
      const failed = report.steps.filter((s) => s.status === "FAIL");
      assert.equal(failed.length, 0, `failing steps: ${failed.map((s) => s.id).join(", ")}`);
      assert.equal(report.ok, true);
    });

    await check("evidence is structured + PII-free (ids/statuses only)", async () => {
      const blob = JSON.stringify(report);
      assert.ok(!/externalFaceId|FaceId|arn:aws|sessionId/i.test(blob), "no biometric ids");
      assert.ok(report.evidence.auditEventCount > 0, "audit trail captured");
      assert.equal(
        report.evidence.photoVerifiedGranted,
        false,
        "end state after withdrawal: no Photo Verified",
      );
    });

    await check("rollback is deterministic + idempotent, leaves NO stale state", async () => {
      const r1 = await rollbackRehearsal({ subjectIds: [subject, reviewer] });
      assert.ok(r1.subjects.length === 2);
      // No grant, no active reference, no binding, no job left.
      const u = await db.user.findUniqueOrThrow({
        where: { id: subject },
        select: { faceVerifiedAt: true },
      });
      assert.equal(u.faceVerifiedAt, null, "Photo Verified cleared");
      assert.equal(
        await db.faceIdentityBinding.count({ where: { userId: subject } }),
        0,
        "bindings removed",
      );
      assert.equal(
        await db.faceReferenceRecord.count({
          where: { userId: subject, status: { in: ["PROVIDER_CREATED", "LINKED"] } },
        }),
        0,
        "no active reference",
      );
      assert.equal(
        await db.profilePhotoVerification.count({ where: { userId: subject } }),
        0,
        "job dropped",
      );
      const r2 = await rollbackRehearsal({ subjectIds: [subject, reviewer] });
      assert.ok(
        r2.subjects.every((s) => s.referencesFailed === 0),
        "idempotent",
      );
    });
  } finally {
    setFaceImageLoader(null);
    for (const [k, v] of Object.entries(SAVED)) {
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
