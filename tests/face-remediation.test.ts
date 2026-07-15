/**
 * Blocker-remediation proof suite (C-1, C-2, C-3, H-1, H-2, H-3, M-1, M-3):
 *   npx tsx tests/face-remediation.test.ts
 *
 * Unit + provider-contract layers against the mock and the REAL AWS
 * adapter's control flow (fake transport). Staging integration (M-2) is a
 * separate authorized plan; not run here.
 */
import "dotenv/config";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const RUN = Date.now().toString(36);
let passed = 0;
async function check(name: string, fn: () => void | Promise<void>): Promise<void> {
  await fn();
  passed += 1;
  console.log(`  ok - ${name}`);
}
const src = (...p: string[]) => readFileSync(path.join(process.cwd(), "src", ...p), "utf8");
const stripped = (r: string) => r.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

async function main() {
  process.env.VERIFICATION_PROVIDER = "mock";
  process.env.FACE_MATCH_PROVIDER = "mock";
  process.env.FACE_LIVENESS_ENABLED = "1";
  delete process.env.FACE_VERIFICATION_PERCENT;
  delete process.env.FACE_VERIFICATION_COUNTRY_ALLOWLIST;
  delete process.env.FACE_EMERGENCY_DISABLE;

  const { db } = await import("../src/lib/db");
  const { createBoundLivenessSession, consumeLivenessFlow, invalidateOpenLivenessSessions } =
    await import("../src/lib/services/face-liveness");
  const {
    enqueueProfilePhotoVerification,
    runProfilePhotoVerification,
    deleteFaceVerificationData,
    setFaceImageLoader,
  } = await import("../src/lib/services/face-verification");
  const { admitToFaceVerification, userInPercentCohort, faceEnvironment } =
    await import("../src/lib/services/face-rollout");
  const { enrollReferenceSaga, deleteAllUserReferences, referenceIdempotencyKey } =
    await import("../src/lib/services/face-reference-registry");
  const { setMockLivenessStatus, setRekognitionTransport, awsRekognitionProvider } =
    await import("../src/lib/services/face-match-providers").then(async (m) => ({
      ...m,
      ...(await import("../src/lib/services/aws-rekognition")),
    }));
  const { assertRegionConsistency } = await import("../src/lib/services/aws-rekognition");

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const minted: string[] = [];
  const mkUser = async (tag: string, tail: string, country = "IE") => {
    const email = `e2e-rem-${tag}-${RUN}@example.com`;
    const uid = (
      await admin.auth.admin.createUser({ email, password: `rm-${RUN}-Aa1!`, email_confirm: true })
    ).data.user!.id;
    const now = new Date();
    await db.user.create({
      data: {
        id: uid,
        email,
        name: `REM ${tag}`,
        emailVerified: now,
        phone: `+3538795${tail}`,
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
        displayName: `REM ${tag}`,
        birthDate: new Date("1993-03-03"),
        gender: "WOMAN",
        country,
      },
    });
    minted.push(uid);
    return uid;
  };
  const mkPhoto = (uid: string, id: string, isCover: boolean, position: number) =>
    db.photo.create({
      data: {
        id: `rm${RUN}${id}`,
        userId: uid,
        url: `/api/media/rm${RUN}${id}/card`,
        position,
        isCover,
        status: "ACTIVE",
        moderation: "APPROVED",
        storagePath: `users/${uid}/photos/rm${RUN}${id}`,
      },
    });

  setFaceImageLoader(async () => Buffer.from("face:owner"));

  try {
    // ---------------------------------------------------------------- C-1
    console.log("C-1 session ownership binding");
    const alice = await mkUser("alice", "01");
    const bob = await mkUser("bob", "02");
    await mkPhoto(alice, "ac", true, 0);
    await mkPhoto(bob, "bc", true, 0);
    await enqueueProfilePhotoVerification(alice, "identity_verified", { consent: true });
    await enqueueProfilePhotoVerification(bob, "identity_verified", { consent: true });

    let aliceFlow = "";
    await check("session persisted + bound before client sees only an opaque flowId", async () => {
      const created = await createBoundLivenessSession(alice);
      assert.ok(!("error" in created));
      aliceFlow = (created as { flowId: string }).flowId;
      const sess = await db.livenessSession.findUniqueOrThrow({ where: { flowId: aliceFlow } });
      assert.equal(sess.userId, alice);
      assert.equal(sess.environment, faceEnvironment());
      assert.notEqual(sess.sessionId, aliceFlow, "provider sessionId != flowId (never exposed)");
      assert.ok(sess.expiresAt > new Date());
    });

    await check("user B cannot read/consume user A's flow (ownership enforced by DB)", async () => {
      const r = await consumeLivenessFlow(aliceFlow, bob);
      assert.equal(r.state, "denied", "foreign flow denied - not another's data");
    });
    await check("unknown flow denied", async () => {
      assert.equal((await consumeLivenessFlow("00000000-unknown", alice)).state, "denied");
    });
    await check("invalidated flow denied", async () => {
      const created = await createBoundLivenessSession(bob);
      const flow = (created as { flowId: string }).flowId;
      await invalidateOpenLivenessSessions(bob);
      assert.equal((await consumeLivenessFlow(flow, bob)).state, "denied");
    });
    await check("expired flow denied", async () => {
      const created = await createBoundLivenessSession(alice);
      const flow = (created as { flowId: string }).flowId;
      await db.livenessSession.update({
        where: { flowId: flow },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      assert.equal((await consumeLivenessFlow(flow, alice)).state, "denied");
    });
    await check("owner consumes -> reference enrolled; replay is idempotent", async () => {
      const created = await createBoundLivenessSession(alice);
      const flow = (created as { flowId: string }).flowId;
      const first = await consumeLivenessFlow(flow, alice);
      assert.equal(first.state, "checking_profile_photos");
      const job = await db.profilePhotoVerification.findUniqueOrThrow({ where: { userId: alice } });
      assert.ok(job.referenceId, "reference linked");
      assert.equal(job.referenceStatus, "ACTIVE");
      const replay = await consumeLivenessFlow(flow, alice);
      assert.equal(
        replay.state,
        "checking_profile_photos",
        "consumed session replays idempotently",
      );
      const sess = await db.livenessSession.findUniqueOrThrow({ where: { flowId: flow } });
      assert.equal(sess.status, "CONSUMED");
    });
    await check("staging session cannot be used in production (environment binding)", async () => {
      const created = await createBoundLivenessSession(bob);
      const flow = (created as { flowId: string }).flowId;
      // current env resolves to "staging"; a session from a DIFFERENT
      // environment ("production") must be denied - no cross-env use.
      await db.livenessSession.update({
        where: { flowId: flow },
        data: { environment: "production" },
      });
      assert.equal((await consumeLivenessFlow(flow, bob)).state, "denied");
    });
    await check("capture handle (Amplify sessionId) released ONLY to the owner", async () => {
      const { getLivenessCaptureHandle } = await import("../src/lib/services/face-liveness");
      const created = await createBoundLivenessSession(alice);
      const flow = (created as { flowId: string }).flowId;
      const mine = await getLivenessCaptureHandle(flow, alice);
      assert.ok(mine?.sessionId, "owner gets the capture handle");
      assert.equal(mine!.region, "eu-west-1");
      const foreign = await getLivenessCaptureHandle(flow, bob);
      assert.equal(foreign, null, "foreign user cannot get another's sessionId");
      await invalidateOpenLivenessSessions(alice);
      assert.equal(await getLivenessCaptureHandle(flow, alice), null, "invalidated flow yields no handle");
    });
    await check("no sessionId/flow id in client URLs, hash, storage (source pin)", () => {
      const card = stripped(src("components", "profile", "liveness-capture.tsx"));
      assert.ok(!/location\.hash/.test(card), "no URL hash writes");
      assert.ok(!/localStorage|sessionStorage/.test(card), "no browser storage");
      assert.ok(!/sessionId/.test(card), "no provider sessionId client-side");
    });

    // ---------------------------------------------------------------- C-2
    console.log("C-2 enrollment/rotation state flow");
    await check(
      "identity webhook enqueue lands in LIVENESS_REQUIRED (no immediate AWS mint)",
      async () => {
        const carol = await mkUser("carol", "03");
        await mkPhoto(carol, "cc", true, 0);
        await enqueueProfilePhotoVerification(carol, "identity_verified", { consent: true });
        const job = await db.profilePhotoVerification.findUniqueOrThrow({
          where: { userId: carol },
        });
        assert.equal(
          job.status,
          "LIVENESS_REQUIRED",
          "waits for liveness, never QUEUED without a reference",
        );
        // run must STOP safely, not dead-letter, not call generic createReference
        const dec = await runProfilePhotoVerification(carol);
        assert.equal(dec, null);
        const after = await db.profilePhotoVerification.findUniqueOrThrow({
          where: { userId: carol },
        });
        assert.equal(after.status, "LIVENESS_REQUIRED", "stays actionable, not dead-lettered");
      },
    );
    await check("run never calls generic createReference for AWS (contract pin)", () => {
      const runCode = stripped(src("lib", "services", "face-verification.ts"));
      assert.ok(
        !/provider\.createReference\(/.test(runCode),
        "run path calls no generic createReference",
      );
      const awsCode = stripped(src("lib", "services", "aws-rekognition.ts"));
      assert.ok(
        /createReference\(\): Promise/.test(awsCode) && /FaceMatchNotConfiguredError/.test(awsCode),
        "AWS createReference refuses",
      );
    });
    await check("rotation returns user to LIVENESS_REQUIRED (all reasons)", async () => {
      const { rotateReference } = await import("../src/lib/services/face-reference");
      const dave = await mkUser("dave", "04");
      await mkPhoto(dave, "dc", true, 0);
      await enqueueProfilePhotoVerification(dave, "identity_verified", { consent: true });
      // enroll then rotate
      const created = await createBoundLivenessSession(dave);
      await consumeLivenessFlow((created as { flowId: string }).flowId, dave);
      await rotateReference(dave, "reference_expiry");
      const job = await db.profilePhotoVerification.findUniqueOrThrow({ where: { userId: dave } });
      assert.equal(job.status, "LIVENESS_REQUIRED");
      assert.equal(job.referenceId, null);
    });

    // ---------------------------------------------------------------- C-3
    console.log("C-3 canonical rollout gate");
    await check("percent cohort deterministic + stable", () => {
      assert.equal(userInPercentCohort("x", 100), true);
      assert.equal(userInPercentCohort("x", 0), false);
      assert.equal(userInPercentCohort("x", 50), userInPercentCohort("x", 50));
    });
    await check("webhook enqueue respects percent (0% excludes)", async () => {
      process.env.FACE_VERIFICATION_PERCENT = "0";
      try {
        const eve = await mkUser("eve", "05");
        const ok = await enqueueProfilePhotoVerification(eve, "identity_verified", {
          consent: true,
        });
        assert.equal(ok, false, "0% cohort refused at the enqueue gate");
        const job = await db.profilePhotoVerification.findUnique({ where: { userId: eve } });
        assert.equal(job, null, "no job created");
      } finally {
        delete process.env.FACE_VERIFICATION_PERCENT;
      }
    });
    await check("webhook enqueue respects country allowlist", async () => {
      process.env.FACE_VERIFICATION_COUNTRY_ALLOWLIST = "GB";
      try {
        const frank = await mkUser("frank", "06", "IE");
        const d = await admitToFaceVerification(frank, { country: "IE" });
        assert.equal(d.admit, false, "IE not in GB allowlist");
        const d2 = await admitToFaceVerification(frank, { country: "GB" });
        assert.equal(d2.admit, true);
      } finally {
        delete process.env.FACE_VERIFICATION_COUNTRY_ALLOWLIST;
      }
    });
    await check("emergency disable blocks new work; recovery still gated by provider", async () => {
      process.env.FACE_EMERGENCY_DISABLE = "1";
      try {
        assert.equal((await admitToFaceVerification(alice, { isRecovery: false })).admit, false);
        assert.equal((await admitToFaceVerification(alice, { isRecovery: true })).admit, false);
      } finally {
        delete process.env.FACE_EMERGENCY_DISABLE;
      }
    });
    await check("photo-change path and webhook path agree on admission", async () => {
      // both route through admitToFaceVerification inside enqueue
      const code = stripped(src("lib", "services", "face-verification.ts"));
      assert.ok(/admitToFaceVerification/.test(code), "enqueue admits");
      const webhook = stripped(src("app", "api", "webhooks", "verification", "route.ts"));
      assert.ok(
        !/after\(\(\) => runProfilePhotoVerification/.test(webhook),
        "webhook does not force a run",
      );
    });

    // ---------------------------------------------------------------- H-1
    console.log("H-1 idempotency + deletion completeness");
    // Direct saga calls below use literal session ids - mark them passed
    // (createBoundLivenessSession does this automatically in the full flow).
    for (const sid of ["sess-a", "sess-b", "s1", "s2", "s", "live-judy"])
      setMockLivenessStatus(sid, "passed");
    await check("idempotency key is deterministic per (env,user,version), keyed hash", () => {
      const k1 = referenceIdempotencyKey("production", alice, 3);
      const k2 = referenceIdempotencyKey("production", alice, 3);
      const k3 = referenceIdempotencyKey("production", alice, 4);
      assert.equal(k1, k2);
      assert.notEqual(k1, k3, "different version -> different key");
      assert.ok(!k1.includes(alice), "no raw user id in the key");
      assert.match(k1, /^[0-9a-f]+$/);
    });
    await check(
      "repeated enrollment for one version reuses ONE record (no duplicates)",
      async () => {
        const grace = await mkUser("grace", "07");
        await enqueueProfilePhotoVerification(grace, "identity_verified", { consent: true });
        const job = await db.profilePhotoVerification.findUniqueOrThrow({
          where: { userId: grace },
        });
        const s1 = await enrollReferenceSaga({
          userId: grace,
          verificationId: job.id,
          referenceVersion: 1,
          livenessSessionId: "sess-a",
        });
        const s2 = await enrollReferenceSaga({
          userId: grace,
          verificationId: job.id,
          referenceVersion: 1,
          livenessSessionId: "sess-b",
        });
        assert.ok(s1.ok && s2.ok);
        assert.equal(
          (s1 as { referenceId: string }).referenceId,
          (s2 as { referenceId: string }).referenceId,
          "same FaceId",
        );
        const recs = await db.faceReferenceRecord.count({
          where: { userId: grace, referenceVersion: 1 },
        });
        assert.equal(recs, 1, "exactly one registry record per version");
      },
    );
    await check(
      "deletion removes EVERY FaceId in the registry, not just the active pointer",
      async () => {
        const heidi = await mkUser("heidi", "08");
        await enqueueProfilePhotoVerification(heidi, "identity_verified", { consent: true });
        const job = await db.profilePhotoVerification.findUniqueOrThrow({
          where: { userId: heidi },
        });
        // two reference versions -> two FaceIds in the registry
        await enrollReferenceSaga({
          userId: heidi,
          verificationId: job.id,
          referenceVersion: 1,
          livenessSessionId: "s1",
        });
        await enrollReferenceSaga({
          userId: heidi,
          verificationId: job.id,
          referenceVersion: 2,
          livenessSessionId: "s2",
        });
        const before = await db.faceReferenceRecord.count({
          where: { userId: heidi, status: "LINKED" },
        });
        assert.equal(before, 2, "two live references");
        const del = await deleteAllUserReferences(heidi, "test");
        assert.equal(del.deleted, 2, "both FaceIds deleted");
        const remaining = await db.faceReferenceRecord.count({
          where: { userId: heidi, status: { not: "DELETED" } },
        });
        assert.equal(remaining, 0);
      },
    );
    await check("deletion is idempotent + audited", async () => {
      const ivan = await mkUser("ivan", "09");
      await enqueueProfilePhotoVerification(ivan, "identity_verified", { consent: true });
      const job = await db.profilePhotoVerification.findUniqueOrThrow({ where: { userId: ivan } });
      await enrollReferenceSaga({
        userId: ivan,
        verificationId: job.id,
        referenceVersion: 1,
        livenessSessionId: "s",
      });
      await deleteAllUserReferences(ivan, "first");
      const second = await deleteAllUserReferences(ivan, "second");
      assert.equal(second.deleted, 0, "nothing left to delete - idempotent");
      const audit = await db.verificationAuditEvent.findFirst({
        where: { userId: ivan, eventType: "face_references_deleted" },
      });
      assert.ok(audit);
    });

    // ---------------------------------------------------------------- H-3
    console.log("H-3 post-mint compensation (no orphans)");
    await check("minted FaceId is persisted BEFORE linking (source ordering pin)", () => {
      const saga = stripped(src("lib", "services", "face-reference-registry.ts"));
      const mintIdx = saga.indexOf("PROVIDER_CREATED");
      const linkIdx = saga.indexOf('status: "LINKED"');
      assert.ok(
        mintIdx > 0 && linkIdx > mintIdx,
        "FaceId -> PROVIDER_CREATED written before LINKED",
      );
      assert.ok(
        /never re-index/i.test(src("lib", "services", "face-reference-registry.ts")) ||
          /NEVER re-index/.test(src("lib", "services", "face-liveness.ts")),
        "documented no-reindex on failure",
      );
    });
    await check(
      "compensation: a LINK_FAILED FaceId is reclaimed by deletion (no orphan escapes)",
      async () => {
        const judy = await mkUser("judy", "10");
        await enqueueProfilePhotoVerification(judy, "identity_verified", { consent: true });
        const job = await db.profilePhotoVerification.findUniqueOrThrow({
          where: { userId: judy },
        });
        // Simulate a mint-succeeded-but-link-failed record (FaceId retained).
        await db.faceReferenceRecord.create({
          data: {
            userId: judy,
            verificationId: job.id,
            referenceVersion: 1,
            provider: "mock",
            environment: faceEnvironment(),
            idempotencyKey: `orphan-${RUN}`,
            externalImageId: "x",
            externalFaceId: "mockface_orphan",
            status: "LINK_FAILED",
          },
        });
        const { reconcileReferences } = await import("../src/lib/services/face-reference-registry");
        await reconcileReferences(50);
        const rec = await db.faceReferenceRecord.findFirst({
          where: { userId: judy, idempotencyKey: `orphan-${RUN}` },
        });
        assert.equal(rec?.status, "DELETED", "reconciler deletes the orphaned FaceId");
      },
    );

    // ---------------------------------------------------------------- H-2
    console.log("H-2 queue mutual exclusion");
    await check("two concurrent claimers -> only ONE provider run", async () => {
      const ken = await mkUser("ken", "11");
      await mkPhoto(ken, "kc", true, 0);
      await enqueueProfilePhotoVerification(ken, "identity_verified", { consent: true });
      const created = await createBoundLivenessSession(ken);
      await consumeLivenessFlow((created as { flowId: string }).flowId, ken);
      // job is QUEUED with an ACTIVE reference; two direct runs race
      let runs = 0;
      const counting = {
        ...(await import("../src/lib/services/face-match-providers")).mockFaceMatchProvider,
        compareReferenceToPhoto: async (
          ref: string,
          input: { image: Buffer; photoId: string; photoVersion: number },
        ) => {
          runs += 1;
          return (
            await import("../src/lib/services/face-match-providers")
          ).mockFaceMatchProvider.compareReferenceToPhoto(ref, input);
        },
      };
      const [a, b] = await Promise.all([
        runProfilePhotoVerification(ken, { provider: counting }),
        runProfilePhotoVerification(ken, { provider: counting }),
      ]);
      const wins = [a, b].filter(Boolean).length;
      assert.equal(wins, 1, "exactly one run wins the lease");
      assert.ok(runs >= 1, "the winner compared photos");
    });
    await check("QUEUED->CLAIMED is a real state transition (not QUEUED->QUEUED)", () => {
      const code = stripped(src("lib", "services", "face-verification.ts"));
      assert.ok(/status: "CLAIMED"/.test(code), "claim transitions to CLAIMED");
      assert.ok(/leaseToken/.test(code), "lease token used");
    });

    // ---------------------------------------------------------------- M-3
    console.log("M-3 region consistency");
    await check("region guard fails closed on drift / disallowed / missing", () => {
      const saved = {
        r: process.env.AWS_REKOGNITION_REGION,
        g: process.env.AWS_REGION,
        a: process.env.AWS_ALLOWED_REGIONS,
      };
      try {
        process.env.AWS_ALLOWED_REGIONS = "eu-west-1";
        process.env.AWS_REKOGNITION_REGION = "eu-west-1";
        process.env.AWS_REGION = "eu-west-1";
        assert.equal(assertRegionConsistency(), "eu-west-1");
        process.env.AWS_REGION = "us-east-1";
        assert.throws(() => assertRegionConsistency(), /disagree|!=/i);
        process.env.AWS_REGION = "eu-west-1";
        process.env.AWS_REKOGNITION_REGION = "us-east-1";
        assert.throws(() => assertRegionConsistency(), /not in|disagree/i);
      } finally {
        process.env.AWS_REKOGNITION_REGION = saved.r;
        process.env.AWS_REGION = saved.g;
        process.env.AWS_ALLOWED_REGIONS = saved.a;
      }
    });

    // ------------------------------------------------ AWS contract (fake transport)
    console.log("provider contract: real AWS adapter control flow (fake transport)");
    await check(
      "createReferenceFromLiveness uses the supplied ExternalImageId + returns FaceId",
      async () => {
        process.env.AWS_ACCESS_KEY_ID = "AKIATEST";
        process.env.AWS_SECRET_ACCESS_KEY = "s";
        process.env.FACE_COLLECTION_ID = "c";
        const calls: Array<{ t: string; ext?: string }> = [];
        setRekognitionTransport(async (t, p: Record<string, unknown>) => {
          calls.push({ t, ext: p.ExternalImageId as string });
          if (t === "GetFaceLivenessSessionResults")
            return { Status: "SUCCEEDED", ReferenceImage: { Bytes: "abc" } };
          if (t === "IndexFaces") return { FaceRecords: [{ Face: { FaceId: "face-xyz" } }] };
          return {};
        });
        try {
          const r = await awsRekognitionProvider.createReferenceFromLiveness!({
            userId: "u",
            livenessSessionId: "sess",
            externalImageId: "ENV:U:3",
          });
          assert.equal(r.referenceId, "face-xyz");
          const idx = calls.find((c) => c.t === "IndexFaces");
          assert.equal(idx?.ext, "ENV:U:3", "exact ExternalImageId sent (no global epoch)");
          assert.ok(!calls.some((c) => c.t === "ListFaces"), "no MaxResults=1 ListFaces dedup");
        } finally {
          setRekognitionTransport(null);
        }
      },
    );

    // ---------------------------------------------------------------- M-1
    console.log("M-1 consent accuracy");
    await check("consent copy no longer claims 'never store face data'", () => {
      const card = src("components", "profile", "liveness-capture.tsx");
      assert.ok(!/never store your face data/.test(card), "false claim removed");
      assert.ok(
        /face reference is created and stored/.test(card),
        "accurate: a reference is stored",
      );
      assert.ok(/withdraw consent/.test(card));
    });

    // account deletion completeness end-to-end
    await check(
      "account deletion destroys all references + audits (deleteFaceVerificationData)",
      async () => {
        const laura = await mkUser("laura", "12");
        await enqueueProfilePhotoVerification(laura, "identity_verified", { consent: true });
        const job = await db.profilePhotoVerification.findUniqueOrThrow({
          where: { userId: laura },
        });
        await enrollReferenceSaga({
          userId: laura,
          verificationId: job.id,
          referenceVersion: 1,
          livenessSessionId: "s",
        });
        await deleteFaceVerificationData(laura);
        const live = await db.faceReferenceRecord.count({
          where: { userId: laura, status: { notIn: ["DELETED"] } },
        });
        assert.equal(live, 0, "no live references remain after account deletion");
      },
    );
  } finally {
    setFaceImageLoader(null);
    for (const uid of minted) {
      await db.user.delete({ where: { id: uid } }).catch(() => {});
      await admin.auth.admin.deleteUser(uid).catch(() => {});
    }
    await db.$disconnect();
  }

  console.log(`\n${passed} checks passed`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
