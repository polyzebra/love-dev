/**
 * F3 regression: a cached per-photo verdict may be reused ONLY in the SAME
 * cover role it was scored under. Cover and gallery use different decision
 * tables, so a role change (promote/demote) must force a FRESH comparison -
 * even though the bytes (mediaVersion) are unchanged. Provider, threshold
 * version and mediaVersion must also still invalidate the cache; an
 * otherwise-unchanged photo must still hit the cache.
 *
 * We measure reuse-vs-fresh directly by COUNTING provider comparisons via an
 * injected counting provider (no AWS). Live lane (real DB). Run with:
 *   FACE_LIVENESS_ENABLED=1 npx tsx tests/face-cache-cover-role.test.ts
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
  const { enqueueProfilePhotoVerification, runProfilePhotoVerification, setFaceImageLoader } =
    await import("../src/lib/services/face-verification");
  const { getFaceMatchProvider } = await import("../src/lib/services/face-match-providers");
  const { createBoundLivenessSession, consumeLivenessFlow } = await import(
    "../src/lib/services/face-liveness"
  );

  const saved = { p: env.FACE_MATCH_PROVIDER, l: env.FACE_LIVENESS_ENABLED, a: env.FACE_INTERNAL_USER_ALLOWLIST, c: env.FACE_INTERNAL_ALLOWLIST_COUNTRY_OVERRIDE, cal: env.FACE_CALIBRATION_VERSION };
  env.FACE_MATCH_PROVIDER = "mock";
  env.FACE_LIVENESS_ENABLED = "1";
  delete env.FACE_CALIBRATION_VERSION; // -> "v0"

  const markers = new Map<string, string>();
  setFaceImageLoader(async (sp) => Buffer.from(markers.get(sp ?? "") ?? "face:owner"));

  // Counting provider: wraps the mock and tallies every real comparison.
  const mock = getFaceMatchProvider();
  let compares = 0;
  const provider = (name: string) => ({
    ...mock,
    name,
    compareReferenceToPhoto: async (refId: string, input: { image: Buffer; photoId: string; photoVersion: number }) => {
      compares += 1;
      return mock.compareReferenceToPhoto(refId, input);
    },
  });
  const MOCK = provider("mock");
  const MOCK2 = provider("mock2");

  let uid = "";
  const pathA = `users/__f3__/photos/a${RUN}`;
  const pathB = `users/__f3__/photos/b${RUN}`;

  // Re-queue then run; return the number of FRESH comparisons in that run.
  const runDelta = async (p: typeof MOCK) => {
    await enqueueProfilePhotoVerification(uid, "f3_recheck", { consent: true });
    const before = compares;
    await runProfilePhotoVerification(uid, { provider: p });
    return compares - before;
  };

  try {
    const email = `e2e-f3-${RUN}@example.com`;
    uid = (await admin.auth.admin.createUser({ email, password: `f3-${RUN}-Aa1!`, email_confirm: true })).data.user!.id;
    env.FACE_INTERNAL_USER_ALLOWLIST = uid;
    env.FACE_INTERNAL_ALLOWLIST_COUNTRY_OVERRIDE = "1";
    const now = new Date();
    await db.user.create({
      data: {
        id: uid, email, name: "F3", emailVerified: now,
        phone: `+3538793${String(RUN).padStart(4, "0").slice(0, 4)}`, phoneVerifiedAt: now,
        ageConfirmedAt: now, termsVersion: "2026-07", privacyVersion: "2026-07",
        communityVersion: "2026-07", onboardingDone: true, photoVerifiedAt: now,
      },
    });
    await db.profile.create({ data: { userId: uid, displayName: "F3", birthDate: new Date("1993-03-03"), gender: "WOMAN", country: "IE" } });
    const A = `f3a${RUN}`;
    const B = `f3b${RUN}`;
    await db.photo.create({ data: { id: A, userId: uid, url: `/m/${A}`, position: 0, isCover: true, status: "ACTIVE", moderation: "APPROVED", storagePath: pathA } });
    await db.photo.create({ data: { id: B, userId: uid, url: `/m/${B}`, position: 1, isCover: false, status: "ACTIVE", moderation: "APPROVED", storagePath: pathB } });
    markers.set(pathA, "face:owner");
    markers.set(pathB, "face:owner");

    // Enrol a reference (mock; no storage).
    await enqueueProfilePhotoVerification(uid, "identity_verified", { consent: true });
    const created = await createBoundLivenessSession(uid);
    assert.ok(!("error" in created));
    await consumeLivenessFlow((created as { flowId: string }).flowId, uid);

    await check("first run compares BOTH photos fresh (cover A + gallery B)", async () => {
      const d = await runDelta(MOCK);
      assert.equal(d, 2, "cold cache -> 2 fresh comparisons");
    });

    await check("unchanged cover + unchanged gallery REUSE the cache (0 fresh)", async () => {
      const d = await runDelta(MOCK);
      assert.equal(d, 0, "same photoId+version+provider+threshold+role -> full reuse");
    });

    await check("promote gallery->cover AND demote cover->gallery force fresh comparisons", async () => {
      // Swap roles WITHOUT changing bytes (mediaVersion unchanged).
      await db.photo.update({ where: { id: A }, data: { isCover: false, position: 1 } });
      await db.photo.update({ where: { id: B }, data: { isCover: true, position: 0 } });
      const d = await runDelta(MOCK);
      assert.equal(d, 2, "both photos changed cover role -> both re-compared (F3)");
    });

    await check("after the role swap, unchanged roles reuse again (0 fresh)", async () => {
      const d = await runDelta(MOCK);
      assert.equal(d, 0, "verdicts now stored under the new roles -> reuse");
    });

    await check("mediaVersion change forces a fresh comparison (that photo only)", async () => {
      await db.photo.update({ where: { id: A }, data: { mediaVersion: { increment: 1 } } });
      const d = await runDelta(MOCK);
      assert.equal(d, 1, "only the re-versioned photo is re-compared");
    });

    await check("provider change forces fresh comparisons", async () => {
      const d = await runDelta(MOCK2); // activeCalibration name changes
      assert.equal(d, 2, "different provider -> cache miss on both");
    });

    await check("threshold version change forces fresh comparisons", async () => {
      env.FACE_CALIBRATION_VERSION = `calX-${RUN}`;
      const d = await runDelta(MOCK2); // same provider, different threshold version
      assert.equal(d, 2, "different threshold version -> cache miss on both");
      delete env.FACE_CALIBRATION_VERSION;
    });
  } finally {
    setFaceImageLoader(null);
    for (const [k, v] of [
      ["FACE_MATCH_PROVIDER", saved.p],
      ["FACE_LIVENESS_ENABLED", saved.l],
      ["FACE_INTERNAL_USER_ALLOWLIST", saved.a],
      ["FACE_INTERNAL_ALLOWLIST_COUNTRY_OVERRIDE", saved.c],
      ["FACE_CALIBRATION_VERSION", saved.cal],
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
