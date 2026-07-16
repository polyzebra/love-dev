/**
 * H1 regression: consent withdrawal must stop biometric enrollment. An OPEN
 * liveness session left over from before withdrawal must NOT be consumable
 * into a new reference afterwards - closing the gap where IndexFaces ran
 * without current consent and minted a reference that escaped deletion.
 *
 * Two layers are asserted:
 *  (1) withdrawFaceConsent invalidates open sessions -> consume is denied;
 *  (2) an independent consent guard in consumeLivenessFlow denies enrollment
 *      whenever the job's current consent is absent (closes the TOCTOU race).
 *
 * Live lane (real DB + mock provider). Run with:
 *   FACE_LIVENESS_ENABLED=1 npx tsx tests/face-consent-liveness-guard.test.ts
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
  const { enqueueProfilePhotoVerification, withdrawFaceConsent } = await import(
    "../src/lib/services/face-verification"
  );
  const { createBoundLivenessSession, consumeLivenessFlow } = await import(
    "../src/lib/services/face-liveness"
  );

  const saved = { p: env.FACE_MATCH_PROVIDER, l: env.FACE_LIVENESS_ENABLED, a: env.FACE_INTERNAL_USER_ALLOWLIST, c: env.FACE_INTERNAL_ALLOWLIST_COUNTRY_OVERRIDE };
  env.FACE_MATCH_PROVIDER = "mock";
  env.FACE_LIVENESS_ENABLED = "1";

  const mint = async (tag: string, tail: string) => {
    const email = `e2e-h1-${tag}-${RUN}@example.com`;
    const uid = (await admin.auth.admin.createUser({ email, password: `h1-${RUN}-Aa1!`, email_confirm: true })).data.user!.id;
    const now = new Date();
    await db.user.create({
      data: {
        id: uid, email, name: `H1 ${tag}`, emailVerified: now,
        phone: `+35387${tail}${String(RUN).padStart(4, "0").slice(0, 3)}`, phoneVerifiedAt: now,
        ageConfirmedAt: now, termsVersion: "2026-07", privacyVersion: "2026-07",
        communityVersion: "2026-07", onboardingDone: true, photoVerifiedAt: now,
      },
    });
    await db.profile.create({ data: { userId: uid, displayName: `H1 ${tag}`, birthDate: new Date("1993-03-03"), gender: "WOMAN", country: "IE" } });
    return uid;
  };
  const activeRefs = (uid: string) =>
    db.faceReferenceRecord.count({ where: { userId: uid, status: { in: ["PROVIDER_CREATED", "LINKED"] } } });

  const minted: string[] = [];
  try {
    // ---- Layer 1: withdrawal invalidates an open session -----------------
    await check("open liveness session cannot be consumed AFTER withdrawal", async () => {
      const uid = await mint("wd", "1");
      minted.push(uid);
      env.FACE_INTERNAL_USER_ALLOWLIST = uid;
      env.FACE_INTERNAL_ALLOWLIST_COUNTRY_OVERRIDE = "1";
      await enqueueProfilePhotoVerification(uid, "identity_verified", { consent: true });
      const created = await createBoundLivenessSession(uid);
      assert.ok(!("error" in created), "session opened");
      const flow = (created as { flowId: string }).flowId;

      await withdrawFaceConsent(uid);

      const r = await consumeLivenessFlow(flow, uid);
      assert.equal(r.state, "denied", "post-withdrawal consume must be denied (session invalidated)");
      assert.equal(await activeRefs(uid), 0, "no reference enrolled after withdrawal");
      const job = await db.profilePhotoVerification.findUnique({ where: { userId: uid }, select: { referenceStatus: true, consentAt: true } });
      assert.equal(job?.referenceStatus, null, "no active reference on the job");
      assert.equal(job?.consentAt, null, "consent cleared");
    });

    // ---- Layer 2: consent guard denies even a non-invalidated session ----
    await check("consumeLivenessFlow denies enrollment when job consent is absent (guard)", async () => {
      const uid = await mint("gd", "2");
      minted.push(uid);
      env.FACE_INTERNAL_USER_ALLOWLIST = uid;
      await enqueueProfilePhotoVerification(uid, "identity_verified", { consent: true });
      const created = await createBoundLivenessSession(uid);
      assert.ok(!("error" in created));
      const flow = (created as { flowId: string }).flowId;

      // Clear ONLY the job consent, leave the session valid/open (isolates the
      // guard from the invalidation path).
      await db.profilePhotoVerification.update({ where: { userId: uid }, data: { consentAt: null, consentVersion: null } });

      const r = await consumeLivenessFlow(flow, uid);
      assert.equal(r.state, "denied", "no current consent -> enrollment denied");
      assert.equal(await activeRefs(uid), 0, "no reference minted without consent");
    });

    // ---- Control: WITH consent, the same flow enrolls normally -----------
    await check("control: with active consent the flow still enrolls", async () => {
      const uid = await mint("ok", "3");
      minted.push(uid);
      env.FACE_INTERNAL_USER_ALLOWLIST = uid;
      await enqueueProfilePhotoVerification(uid, "identity_verified", { consent: true });
      const created = await createBoundLivenessSession(uid);
      assert.ok(!("error" in created));
      const r = await consumeLivenessFlow((created as { flowId: string }).flowId, uid);
      assert.equal(r.state, "checking_profile_photos", "consent present -> enrollment proceeds");
      assert.equal(await activeRefs(uid), 1, "reference enrolled");
    });
  } finally {
    for (const [k, v] of [
      ["FACE_MATCH_PROVIDER", saved.p],
      ["FACE_LIVENESS_ENABLED", saved.l],
      ["FACE_INTERNAL_USER_ALLOWLIST", saved.a],
      ["FACE_INTERNAL_ALLOWLIST_COUNTRY_OVERRIDE", saved.c],
    ] as const) {
      if (v === undefined) delete env[k];
      else env[k] = v;
    }
    for (const uid of minted) {
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
