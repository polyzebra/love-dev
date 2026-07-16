/**
 * Internal rehearsal tooling (Phase 8). Proves the eight hard gates REFUSE
 * an unprepared environment and pass a fully-prepared one, and that the
 * headless simulate journey walks all 14 steps to a biometric-safe PASS.
 * Live lane (real DB + mock provider). Run with:
 *   FACE_LIVENESS_ENABLED=1 npx tsx tests/face-rehearsal.test.ts
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
  const rehearsal = await import("../src/lib/services/face-rehearsal");

  // Force the mock provider + liveness for the headless journey.
  env.FACE_MATCH_PROVIDER = "mock";
  env.FACE_LIVENESS_ENABLED = "1";

  const minted: string[] = [];
  const mkUser = async (tag: string, tail: string) => {
    const email = `e2e-reh-${tag}-${RUN}@example.com`;
    const uid = (
      await admin.auth.admin.createUser({ email, password: `rh-${RUN}-Aa1!`, email_confirm: true })
    ).data.user!.id;
    const now = new Date();
    await db.user.create({
      data: {
        id: uid,
        email,
        name: `REH ${tag}`,
        emailVerified: now,
        phone: `+3538794${tail}`,
        phoneVerifiedAt: now,
        ageConfirmedAt: now,
        termsVersion: "2026-07",
        privacyVersion: "2026-07",
        communityVersion: "2026-07",
        onboardingDone: true,
      },
    });
    await db.profile.create({
      data: {
        userId: uid,
        displayName: `REH ${tag}`,
        birthDate: new Date("1993-03-03"),
        gender: "WOMAN",
        country: "IE",
      },
    });
    await db.photo.create({
      data: {
        id: `rh${RUN}${tag}`,
        userId: uid,
        url: `/api/media/rh${RUN}${tag}/card`,
        position: 0,
        isCover: true,
        status: "ACTIVE",
        moderation: "APPROVED",
        storagePath: `users/${uid}/photos/rh${RUN}${tag}`,
      },
    });
    minted.push(uid);
    return uid;
  };

  // Snapshot the env we mutate so the suite leaves no trace.
  const GATE_KEYS = [
    "FACE_LEGAL_APPROVED_VERSIONS",
    "FACE_LEGAL_APPROVAL_VERSION",
    "FACE_AWS_DPA_CONFIRMED",
    "FACE_CALIBRATION_APPROVED",
    "FACE_CALIBRATION_VERSION",
    "FACE_VERIFICATION_PERCENT",
    "FACE_INTERNAL_USER_ALLOWLIST",
    "FACE_EMERGENCY_DISABLE_TESTED",
    "ALERT_WEBHOOK_URL",
  ];
  const saved: Record<string, string | undefined> = {};
  for (const k of GATE_KEYS) saved[k] = env[k];

  let subject = "";
  let cover = "";

  try {
    subject = await mkUser("subj", "01");
    cover = await mkUser("cov", "02");

    await check("gates REFUSE an unprepared environment", async () => {
      for (const k of GATE_KEYS) delete env[k];
      const g = rehearsal.evaluateRehearsalGates();
      assert.equal(g.ready, false, "not ready with nothing configured");
      assert.ok(g.gates.every((x) => x.ok === false || x.id === "verification_percent_zero"));
    });

    await check("a supplied-but-unapproved legal version does NOT satisfy the gate", async () => {
      env.FACE_LEGAL_APPROVED_VERSIONS = "2026-07-legal-v1";
      env.FACE_LEGAL_APPROVAL_VERSION = "some-other-version";
      const g = rehearsal.evaluateRehearsalGates();
      const supplied = g.gates.find((x) => x.id === "legal_version_supplied")!;
      assert.equal(supplied.ok, false, "must match a counsel-approved version");
    });

    await check("all eight gates pass once the environment is fully prepared", async () => {
      env.FACE_LEGAL_APPROVED_VERSIONS = "2026-07-legal-v1";
      env.FACE_LEGAL_APPROVAL_VERSION = "2026-07-legal-v1";
      env.FACE_AWS_DPA_CONFIRMED = "1";
      env.FACE_CALIBRATION_APPROVED = "1";
      env.FACE_CALIBRATION_VERSION = "cal-2026-07";
      env.FACE_VERIFICATION_PERCENT = "0";
      env.FACE_INTERNAL_USER_ALLOWLIST = `${subject},${cover}`;
      env.FACE_EMERGENCY_DISABLE_TESTED = "1";
      env.ALERT_WEBHOOK_URL = "https://hooks.example.com/ops";
      const g = rehearsal.evaluateRehearsalGates();
      assert.equal(
        g.ready,
        true,
        g.gates
          .filter((x) => !x.ok)
          .map((x) => x.id)
          .join(","),
      );
    });

    let run: Awaited<ReturnType<typeof rehearsal.simulateRehearsalJourney>>;
    await check("headless simulate journey walks all 14 steps to a PASS", async () => {
      run = await rehearsal.simulateRehearsalJourney({
        subjectId: subject,
        coverSubjectId: cover,
        actorId: subject,
      });
      assert.equal(run.steps.length, 14);
      const failing = run.steps.filter((s) => s.status === "FAIL");
      assert.equal(
        failing.length,
        0,
        `failing steps: ${failing.map((s) => `${s.step}:${s.note}`).join(" | ")}`,
      );
      assert.equal(run.ok, true);
    });

    await check("no raw biometric identifier appears anywhere in the run", async () => {
      assert.equal(run.biometricSafe, true);
      const blob = JSON.stringify(run);
      assert.ok(
        !/externalFaceId|FaceId|arn:aws|sessionId/i.test(blob),
        "run output is biometric-free",
      );
    });

    await check("cleanup restores subjects (idempotent)", async () => {
      const r1 = await rehearsal.cleanupRehearsal({ subjectIds: [subject, cover] });
      assert.equal(r1.subjects.length, 2);
      // Identity flag + badge cleared; no references, no job left.
      const u = await db.user.findUnique({
        where: { id: subject },
        select: { photoVerifiedAt: true, faceBadgeSuspendedAt: true },
      });
      assert.equal(u?.photoVerifiedAt, null);
      assert.equal(u?.faceBadgeSuspendedAt, null);
      assert.equal(await db.profilePhotoVerification.count({ where: { userId: subject } }), 0);
      // Second run must not throw and must report zero failures.
      const r2 = await rehearsal.cleanupRehearsal({ subjectIds: [subject, cover] });
      assert.ok(r2.subjects.every((s) => s.referencesFailed === 0));
    });
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete env[k];
      else env[k] = v;
    }
    // Teardown DB rows + auth users.
    for (const uid of minted) {
      await db.photo.deleteMany({ where: { userId: uid } }).catch(() => {});
      await db.livenessSession.deleteMany({ where: { userId: uid } }).catch(() => {});
      await db.faceReferenceRecord.deleteMany({ where: { userId: uid } }).catch(() => {});
      await db.profilePhotoVerification.deleteMany({ where: { userId: uid } }).catch(() => {});
      await db.verificationAuditEvent.deleteMany({ where: { userId: uid } }).catch(() => {});
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
