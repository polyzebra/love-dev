/**
 * H2 regression: FACE_EMERGENCY_DISABLE is an INSTANT kill switch - it halts
 * not just new admission but every in-flight processing/enrollment path:
 *   - runProfilePhotoVerification (no comparison, no grant)
 *   - sweepQueuedFaceChecks (processes nothing)
 *   - consumeLivenessFlow (no IndexFaces enrollment)
 * Each is proven ON (halted) and OFF (control proceeds).
 *
 * Live lane (real DB + mock provider). Run with:
 *   FACE_LIVENESS_ENABLED=1 npx tsx tests/face-emergency-disable.test.ts
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
  const { enqueueProfilePhotoVerification, runProfilePhotoVerification, sweepQueuedFaceChecks, setFaceImageLoader } =
    await import("../src/lib/services/face-verification");
  const { createBoundLivenessSession, consumeLivenessFlow } = await import(
    "../src/lib/services/face-liveness"
  );

  const saved = { p: env.FACE_MATCH_PROVIDER, l: env.FACE_LIVENESS_ENABLED, a: env.FACE_INTERNAL_USER_ALLOWLIST, c: env.FACE_INTERNAL_ALLOWLIST_COUNTRY_OVERRIDE, e: env.FACE_EMERGENCY_DISABLE };
  env.FACE_MATCH_PROVIDER = "mock";
  env.FACE_LIVENESS_ENABLED = "1";
  delete env.FACE_EMERGENCY_DISABLE;
  setFaceImageLoader(async () => Buffer.from("face:owner"));

  let uid = "";
  const jobStatus = async () =>
    (await db.profilePhotoVerification.findUnique({ where: { userId: uid }, select: { status: true } }))?.status;
  const activeRefs = () =>
    db.faceReferenceRecord.count({ where: { userId: uid, status: { in: ["PROVIDER_CREATED", "LINKED"] } } });

  try {
    const email = `e2e-h2-${RUN}@example.com`;
    uid = (await admin.auth.admin.createUser({ email, password: `h2-${RUN}-Aa1!`, email_confirm: true })).data.user!.id;
    env.FACE_INTERNAL_USER_ALLOWLIST = uid;
    env.FACE_INTERNAL_ALLOWLIST_COUNTRY_OVERRIDE = "1";
    const now = new Date();
    await db.user.create({
      data: {
        id: uid, email, name: "H2", emailVerified: now,
        phone: `+3538790${String(RUN).padStart(4, "0").slice(0, 4)}`, phoneVerifiedAt: now,
        ageConfirmedAt: now, termsVersion: "2026-07", privacyVersion: "2026-07",
        communityVersion: "2026-07", onboardingDone: true, photoVerifiedAt: now,
      },
    });
    await db.profile.create({ data: { userId: uid, displayName: "H2", birthDate: new Date("1993-03-03"), gender: "WOMAN", country: "IE" } });
    await db.photo.create({ data: { id: `h2c${RUN}`, userId: uid, url: `/m/h2c${RUN}`, position: 0, isCover: true, status: "ACTIVE", moderation: "APPROVED", storagePath: `users/__h2__/photos/h2c${RUN}` } });

    // ---- Enrollment: kill switch ON blocks IndexFaces --------------------
    await check("consumeLivenessFlow refuses enrollment while emergency-disabled", async () => {
      await enqueueProfilePhotoVerification(uid, "identity_verified", { consent: true });
      const created = await createBoundLivenessSession(uid);
      assert.ok(!("error" in created));
      const flow = (created as { flowId: string }).flowId;
      env.FACE_EMERGENCY_DISABLE = "1";
      const r = await consumeLivenessFlow(flow, uid);
      assert.equal(r.state, "provider_unavailable", "kill switch -> no enrollment");
      assert.equal(await activeRefs(), 0, "no reference minted while disabled");
      delete env.FACE_EMERGENCY_DISABLE;
      // Control: with the switch off, the SAME flow enrolls.
      const r2 = await consumeLivenessFlow(flow, uid);
      assert.equal(r2.state, "checking_profile_photos");
      assert.equal(await activeRefs(), 1, "reference enrolled once re-enabled");
    });

    // ---- Worker: kill switch ON blocks comparison + grant ---------------
    await check("runProfilePhotoVerification halts while emergency-disabled", async () => {
      await enqueueProfilePhotoVerification(uid, "recheck", { consent: true });
      assert.equal(await jobStatus(), "QUEUED", "job queued and ready");
      env.FACE_EMERGENCY_DISABLE = "1";
      const dec = await runProfilePhotoVerification(uid);
      assert.equal(dec, null, "no decision while disabled");
      assert.equal(await jobStatus(), "QUEUED", "job untouched (never claimed/checked)");
      delete env.FACE_EMERGENCY_DISABLE;
      const dec2 = await runProfilePhotoVerification(uid); // control
      assert.equal(dec2?.status, "AUTO_VERIFIED", "processes once re-enabled");
    });

    // ---- Sweep: kill switch ON processes nothing ------------------------
    await check("sweepQueuedFaceChecks processes nothing while emergency-disabled", async () => {
      await enqueueProfilePhotoVerification(uid, "recheck2", { consent: true });
      env.FACE_EMERGENCY_DISABLE = "1";
      const n = await sweepQueuedFaceChecks(10);
      assert.equal(n, 0, "sweep halted");
      assert.equal(await jobStatus(), "QUEUED", "job left claimable");
      delete env.FACE_EMERGENCY_DISABLE;
    });
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
