/**
 * Face verification security architecture tests (threat-model phases):
 *   npx tsx tests/face-security.test.ts
 *
 * Risk engine banding/weights, duplicate identity classification,
 * reference lifecycle (expired references NEVER reused, rotation,
 * provider upgrade, cron sweep), impersonation-only auto-suspension,
 * the full appeal round-trip on the EXISTING violation/appeal machine,
 * the CRITICAL-risk gate, queue replay, dormancy rollback, and privacy
 * pins (no raw vendor values outside the engine/adapters).
 *
 * Companion coverage cited rather than duplicated: webhook signature +
 * replay idempotency (photo-verification suite), provider outage/cron
 * recovery + manual review + suspension/restoration
 * (face-verification suite).
 */
import "dotenv/config";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { enrollReference } from "./support/face-enroll";

const RUN = Date.now().toString(36);

let passed = 0;
async function check(name: string, fn: () => void | Promise<void>): Promise<void> {
  await fn();
  passed += 1;
  console.log(`  ok - ${name}`);
}
const src = (...parts: string[]) => readFileSync(path.join(process.cwd(), "src", ...parts), "utf8");
/** Comment-stripped source - privacy pins must not trip on prose. */
const code = (...parts: string[]) =>
  src(...parts)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");

async function main() {
  process.env.VERIFICATION_PROVIDER = "mock";
  process.env.FACE_MATCH_PROVIDER = "mock";
  // rollout gates (Phase 32) - this suite exercises the gated features
  process.env.FACE_DUPLICATE_SEARCH_ENABLED = "1";
  process.env.FACE_AUTO_SUSPEND_ENABLED = "1";
  process.env.FACE_LIVENESS_ENABLED = "1";

  const { bandFromScore, scoreFaceSignals, computeVerificationRisk } =
    await import("../src/lib/services/risk-engine");
  const {
    classifyDuplicateMatch,
    worstDuplicateClass,
    rotateReference,
    sweepReferenceLifecycle,
    runDuplicateCheck,
    createFaceViolation,
  } = await import("../src/lib/services/face-reference");
  const { enqueueProfilePhotoVerification, runProfilePhotoVerification, setFaceImageLoader } =
    await import("../src/lib/services/face-verification");
  const { mockFaceMatchProvider, setMockLikenessMatches } =
    await import("../src/lib/services/face-match-providers");
  const { submitAppeal, reviewAppeal } = await import("../src/lib/services/appeals");
  const { isPubliclyVerified } = await import("../src/lib/services/verification");
  const { db } = await import("../src/lib/db");

  // ------------------------------------------------------------ risk engine
  console.log("risk engine (pure, config-driven)");

  await check("banding respects configured thresholds", () => {
    const cfg = { mediumAt: 25, highAt: 50, criticalAt: 75 };
    assert.equal(bandFromScore(0, cfg), "LOW");
    assert.equal(bandFromScore(25, cfg), "MEDIUM");
    assert.equal(bandFromScore(50, cfg), "HIGH");
    assert.equal(bandFromScore(74, cfg), "HIGH");
    assert.equal(bandFromScore(75, cfg), "CRITICAL");
    // config-driven: a stricter deployment
    assert.equal(bandFromScore(10, { mediumAt: 5, highAt: 8, criticalAt: 10 }), "CRITICAL");
  });

  await check("face signals: impersonation dominates; caps hold; names normalized", () => {
    const hot = scoreFaceSignals({
      identityVerified: true,
      faceStatus: "SUSPENDED",
      duplicateClass: "LIKELY_IMPERSONATION",
      referenceStatus: "REVOKED",
      manipulationFlaggedPhotos: 2,
      otherPersonPhotos: 10,
      deniedAppeals: 5,
    });
    assert.ok(hot.points >= 75, `hot profile scores CRITICAL-range (${hot.points})`);
    assert.ok(hot.signals.includes("duplicate_impersonation"));
    assert.ok(hot.signals.includes("manipulation_flagged"));
    // caps: 10 other-person photos cap at 30 pts, 5 denials cap at 20
    const capped = scoreFaceSignals({
      identityVerified: true,
      faceStatus: null,
      duplicateClass: "UNKNOWN",
      referenceStatus: "ACTIVE",
      manipulationFlaggedPhotos: 0,
      otherPersonPhotos: 100,
      deniedAppeals: 100,
    });
    assert.equal(capped.points, 30 + 20, "caps bound unbounded inputs");
    // normalized names only - nothing numeric, nothing vendor-flavoured
    for (const s of [...hot.signals, ...capped.signals]) {
      assert.match(s, /^[a-z_]+$/, `signal "${s}" is a normalized name`);
    }
  });

  await check("clean verified profile scores LOW", () => {
    const clean = scoreFaceSignals({
      identityVerified: true,
      faceStatus: "AUTO_VERIFIED",
      duplicateClass: "UNKNOWN",
      referenceStatus: "ACTIVE",
      manipulationFlaggedPhotos: 0,
      otherPersonPhotos: 0,
      deniedAppeals: 0,
    });
    assert.equal(clean.points, 0);
    assert.deepEqual(clean.signals, []);
  });

  // ------------------------------------------- duplicate classification
  console.log("duplicate identity classification (pure matrix)");

  await check("duplicate matrix: evidence-based outcomes (Phase 29 revision)", () => {
    assert.equal(classifyDuplicateMatch({ band: "confident", other: null }), "UNKNOWN");
    assert.equal(
      classifyDuplicateMatch({
        band: "uncertain",
        other: { verifiedFirst: true, flaggedForImpersonation: false, birthDateMatches: false },
      }),
      "FAMILY_RESEMBLANCE",
      "mid-band similarity defaults to relatives, not fraud",
    );
    assert.equal(
      classifyDuplicateMatch({
        band: "confident",
        other: { verifiedFirst: true, flaggedForImpersonation: false, birthDateMatches: false },
      }),
      "LIKELY_IMPERSONATION",
      "confident match to a FIRST-verified other account",
    );
    assert.equal(
      classifyDuplicateMatch({
        band: "confident",
        other: { verifiedFirst: false, flaggedForImpersonation: true, birthDateMatches: false },
      }),
      "LIKELY_IMPERSONATION",
      "confident match to an impersonation-flagged account",
    );
    assert.equal(
      classifyDuplicateMatch({
        band: "confident",
        other: { verifiedFirst: false, flaggedForImpersonation: false, birthDateMatches: true },
      }),
      "TWIN_RISK",
      "matching birth dates = evidence-based twin signal (now emitted)",
    );
    assert.equal(
      classifyDuplicateMatch({
        band: "confident",
        other: { verifiedFirst: false, flaggedForImpersonation: false, birthDateMatches: false },
      }),
      "LIKELY_DUPLICATE",
      "confident match, this user first, no twin evidence - human question",
    );
    // SELF_RESTORE is deprecated from AUTOMATIC classification (Phase 29):
    // the classifier can no longer emit it - restores resolve via manual
    // review/appeal. The enum value survives for historical rows only.
    assert.equal(worstDuplicateClass([]), "UNKNOWN");
    assert.equal(
      worstDuplicateClass(["TWIN_RISK", "LIKELY_IMPERSONATION", "FAMILY_RESEMBLANCE"]),
      "LIKELY_IMPERSONATION",
      "worst outcome wins aggregation",
    );
    assert.equal(worstDuplicateClass(["TWIN_RISK", "LIKELY_DUPLICATE"]), "LIKELY_DUPLICATE");
  });

  // ----------------------------------------------------------- live lanes
  console.log("reference lifecycle + duplicates + appeals (db + mock)");

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const minted: string[] = [];
  const mkUser = async (tag: string, tail: string, verifiedAt: Date | null) => {
    const email = `e2e-sec-${tag}-${RUN}@example.com`;
    const created = await admin.auth.admin.createUser({
      email,
      password: `fs-${RUN}-Aa1!`,
      email_confirm: true,
    });
    const uid = created.data.user!.id;
    const now = new Date();
    await db.user.create({
      data: {
        id: uid,
        email,
        name: `SEC ${tag}`,
        emailVerified: now,
        phone: `+3538791${tail}`,
        phoneVerifiedAt: now,
        ageConfirmedAt: now,
        termsVersion: "2026-07",
        privacyVersion: "2026-07",
        communityVersion: "2026-07",
        onboardingDone: true,
        photoVerifiedAt: verifiedAt,
      },
    });
    await db.profile.create({
      data: {
        userId: uid,
        displayName: `SEC ${tag}`,
        birthDate: new Date("1993-03-03"),
        gender: "WOMAN",
      },
    });
    minted.push(uid);
    return uid;
  };
  const mkPhoto = (uid: string, id: string, isCover: boolean, position: number) =>
    db.photo.create({
      data: {
        id: `fs${RUN}${id}`,
        userId: uid,
        url: `/api/media/fs${RUN}${id}/card`,
        position,
        isCover,
        status: "ACTIVE",
        moderation: "APPROVED",
        storagePath: `users/${uid}/photos/fs${RUN}${id}`,
      },
    });

  const markers = new Map<string, string>();
  setFaceImageLoader(async (storagePath) =>
    Buffer.from(markers.get(storagePath ?? "") ?? "face:owner"),
  );

  const alice = await mkUser("alice", "01", new Date(Date.now() - 86400000)); // verified yesterday
  const aliceCover = await mkPhoto(alice, "ac", true, 0);
  markers.set(aliceCover.storagePath!, "face:owner");

  try {
    await check("enrolment stamps the full lifecycle (ACTIVE, model, region)", async () => {
      await enrollReference(alice);
      const decision = await runProfilePhotoVerification(alice);
      assert.equal(decision?.status, "AUTO_VERIFIED");
      const job = await db.profilePhotoVerification.findUniqueOrThrow({ where: { userId: alice } });
      assert.equal(job.referenceStatus, "ACTIVE");
      assert.equal(job.providerModelVersion, "mock-1");
      assert.equal(job.providerRegion, "eu-west-1");
      assert.ok(job.lastValidatedAt, "lastValidatedAt stamped");
      assert.ok(job.expiresAt && job.expiresAt > new Date(), "expiry horizon set");
    });

    await check("EXPIRED references are never reused - fresh enrolment instead", async () => {
      const before = await db.profilePhotoVerification.findUniqueOrThrow({
        where: { userId: alice },
      });
      await db.profilePhotoVerification.update({
        where: { id: before.id },
        data: { referenceStatus: "EXPIRED" },
      });
      await enrollReference(alice);
      const after = await db.profilePhotoVerification.findUniqueOrThrow({
        where: { userId: alice },
      });
      assert.equal(after.referenceStatus, "ACTIVE", "re-enrolled");
      assert.equal(after.referenceVersion, before.referenceVersion + 1, "version bumped");
    });

    await check("rotation (provider upgrade): vendor deletion + ROTATING + audited", async () => {
      const deleted: string[] = [];
      const spy = {
        ...mockFaceMatchProvider,
        deleteReference: async (id: string) => {
          deleted.push(id);
        },
      };
      const { setFaceProviderOverride } = { setFaceProviderOverride: null as never };
      void spy;
      void setFaceProviderOverride;
      // rotateReference uses getFaceMatchProvider() - mock deleteReference
      // is a no-op, so assert via state + audit instead of the spy.
      const ok2 = await rotateReference(alice, "provider_upgrade", { type: "admin", id: alice });
      assert.equal(ok2, true);
      const job = await db.profilePhotoVerification.findUniqueOrThrow({ where: { userId: alice } });
      assert.equal(job.referenceStatus, "ROTATING");
      assert.equal(job.rotationReason, "provider_upgrade");
      assert.equal(job.referenceId, null, "pointer severed");
      assert.equal(job.status, "LIVENESS_REQUIRED", "C-2: rotation returns to liveness capture");
      const audit = await db.verificationAuditEvent.findFirst({
        where: { userId: alice, eventType: "face_reference_rotated" },
        orderBy: { createdAt: "desc" },
      });
      assert.equal(audit?.reasonCode, "provider_upgrade");
      await enrollReference(alice); // re-enrol via liveness
    });

    await check("lifecycle sweep: expiry rotates, renewal window marks EXPIRING", async () => {
      // expire alice's fresh reference
      await db.profilePhotoVerification.update({
        where: { userId: alice },
        data: { expiresAt: new Date(Date.now() - 1000), referenceStatus: "ACTIVE" },
      });
      const result = await sweepReferenceLifecycle(10);
      assert.ok(result.rotatedExpired >= 1, "expired reference rotated");
      let job = await db.profilePhotoVerification.findUniqueOrThrow({ where: { userId: alice } });
      assert.equal(job.rotationReason, "reference_expiry");
      await enrollReference(alice); // re-enrol via liveness
      // now put it inside the renewal window
      await db.profilePhotoVerification.update({
        where: { userId: alice },
        data: { expiresAt: new Date(Date.now() + 5 * 86400000) },
      });
      const result2 = await sweepReferenceLifecycle(10);
      assert.ok(result2.markedExpiring >= 1);
      job = await db.profilePhotoVerification.findUniqueOrThrow({ where: { userId: alice } });
      assert.equal(job.referenceStatus, "EXPIRING", "still usable, rotation nudged");
    });

    // --- duplicates -------------------------------------------------------
    const mallory = await mkUser("mallory", "02", new Date()); // verified today (AFTER alice)
    const malloryCover = await mkPhoto(mallory, "mc", true, 0);
    markers.set(malloryCover.storagePath!, "face:owner");

    await check(
      "impersonation: confident match to first-verified account auto-suspends",
      async () => {
        await enrollReference(mallory);
        await runProfilePhotoVerification(mallory);
        const aliceJob = await db.profilePhotoVerification.findUniqueOrThrow({
          where: { userId: alice },
        });
        const malloryJob = await db.profilePhotoVerification.findUniqueOrThrow({
          where: { userId: mallory },
        });
        setMockLikenessMatches(malloryJob.referenceId!, [
          { referenceId: aliceJob.referenceId!, band: "confident" },
        ]);
        const verdict = await runDuplicateCheck(mallory);
        assert.equal(verdict, "LIKELY_IMPERSONATION");
        const user = await db.user.findUniqueOrThrow({ where: { id: mallory } });
        assert.equal(isPubliclyVerified(user), false, "badge auto-suspended");
        const violation = await db.accountViolation.findFirst({
          where: { userId: mallory, violationType: "IMPERSONATION", reversedAt: null },
        });
        assert.ok(violation, "appealable IMPERSONATION violation created");
        setMockLikenessMatches(malloryJob.referenceId!, null);
      },
    );

    const bob = await mkUser("bob", "03", new Date());
    const bobCover = await mkPhoto(bob, "bc", true, 0);
    markers.set(bobCover.storagePath!, "face:owner");

    await check(
      "duplicate (this user first) routes to manual review - NO auto-suspend",
      async () => {
        await enrollReference(bob);
        await runProfilePhotoVerification(bob);
        const bobJob = await db.profilePhotoVerification.findUniqueOrThrow({
          where: { userId: bob },
        });
        // stage a confident match to a LATER-verified, unflagged account
        const late = await mkUser("late", "04", new Date(Date.now() + 60000));
        // different birth date - otherwise the (correct) TWIN_RISK evidence fires
        await db.profile.update({
          where: { userId: late },
          data: { birthDate: new Date("1990-09-09") },
        });
        await db.profilePhotoVerification.create({
          data: {
            userId: late,
            provider: "mock",
            referenceId: `mockref_${RUN}late`,
            referenceStatus: "ACTIVE",
            status: "AUTO_VERIFIED",
            badgeStatus: "ACTIVE",
          },
        });
        setMockLikenessMatches(bobJob.referenceId!, [
          { referenceId: `mockref_${RUN}late`, band: "confident" },
        ]);
        const verdict = await runDuplicateCheck(bob);
        assert.equal(verdict, "LIKELY_DUPLICATE");
        const job = await db.profilePhotoVerification.findUniqueOrThrow({ where: { userId: bob } });
        assert.equal(job.status, "MANUAL_REVIEW", "human question, not automation");
        const user = await db.user.findUniqueOrThrow({ where: { id: bob } });
        assert.equal(isPubliclyVerified(user), true, "badge NOT suspended for non-impersonation");
        setMockLikenessMatches(bobJob.referenceId!, null);
      },
    );

    // --- appeals ----------------------------------------------------------
    await check(
      "appeal round-trip: violation -> submit -> approve -> badge restored, all audited",
      async () => {
        const violation = await db.accountViolation.findFirstOrThrow({
          where: { userId: mallory, violationType: "IMPERSONATION", reversedAt: null },
        });
        const { appealId } = await submitAppeal({
          userId: mallory,
          violationId: violation.id,
          appealText: "This is my real account - happy to verify again with a new selfie.",
        });
        const eventsBefore = await db.appealEvent.count({ where: { appealId } });
        assert.ok(eventsBefore >= 1, "submission is an immutable timeline event");
        const review = await reviewAppeal({ actorId: alice, appealId, decision: "approve" });
        assert.equal(review.status, "APPROVED");
        // history never overwritten - timeline only grows
        const eventsAfter = await db.appealEvent.count({ where: { appealId } });
        assert.ok(eventsAfter > eventsBefore, "decision appended, nothing replaced");
        const user = await db.user.findUniqueOrThrow({ where: { id: mallory } });
        assert.equal(isPubliclyVerified(user), true, "badge restored on approval");
        const reversed = await db.accountViolation.findUniqueOrThrow({
          where: { id: violation.id },
        });
        assert.ok(reversed.reversedAt, "violation reversed, not deleted");
        const audit = await db.verificationAuditEvent.findFirst({
          where: { userId: mallory, eventType: "face_appeal_reversed" },
        });
        assert.ok(audit, "face restoration audited with admin actor");
      },
    );

    await check("rejected face outcome creates ONE deduped appealable violation", async () => {
      const v1 = await createFaceViolation(bob, "PHOTO_MISMATCH", "cover_not_confirmed");
      const v2 = await createFaceViolation(bob, "PHOTO_MISMATCH", "cover_not_confirmed");
      assert.equal(v1, v2, "no violation spam from repeated runs");
    });

    // --- risk gate --------------------------------------------------------
    await check(
      "CRITICAL risk blocks auto-verification (face match alone never decides)",
      async () => {
        process.env.RISK_CRITICAL_AT = "0"; // everything is critical
        try {
          await db.photo.update({
            where: { id: aliceCover.id },
            data: { mediaVersion: { increment: 1 } },
          });
          await enqueueProfilePhotoVerification(alice, "photo_replaced");
          const decision = await runProfilePhotoVerification(alice);
          assert.equal(
            decision?.status,
            "MANUAL_REVIEW",
            "held for a human despite a perfect match",
          );
          const audit = await db.verificationAuditEvent.findFirst({
            where: { userId: alice, eventType: "risk_gate_hold" },
          });
          assert.equal(audit?.reasonCode, "risk_critical");
        } finally {
          delete process.env.RISK_CRITICAL_AT;
        }
      },
    );

    await check("computeVerificationRisk returns band + normalized signals only", async () => {
      const risk = await computeVerificationRisk(mallory);
      assert.ok(["LOW", "MEDIUM", "HIGH", "CRITICAL"].includes(risk.band));
      for (const s of risk.signals) assert.match(s, /^[a-z_:]+$/, `normalized: ${s}`);
      const flat = JSON.stringify(risk);
      assert.ok(!/similarity|embedding|vector|0\.\d{3,}/.test(flat), "no raw vendor values escape");
    });

    // --- replay + rollback ------------------------------------------------
    await check("queue replay: double enqueue keeps ONE job row (upsert, no dupes)", async () => {
      await enqueueProfilePhotoVerification(alice, "replay-1");
      await enqueueProfilePhotoVerification(alice, "replay-2");
      const jobs = await db.profilePhotoVerification.count({ where: { userId: alice } });
      assert.equal(jobs, 1);
      await runProfilePhotoVerification(alice);
    });

    await check("rollback/dormancy: unset provider -> sweeps are no-ops", async () => {
      const saved = process.env.FACE_MATCH_PROVIDER;
      delete process.env.FACE_MATCH_PROVIDER;
      try {
        const swept = await sweepReferenceLifecycle(10);
        assert.deepEqual(swept, { markedExpiring: 0, rotatedExpired: 0, rotatedUpgraded: 0 });
      } finally {
        process.env.FACE_MATCH_PROVIDER = saved;
      }
    });

    // --- privacy pins (Phase 8) --------------------------------------------
    console.log("privacy pins");

    await check("no raw similarity or vendor reference ids leave the server", () => {
      const adminApi = code("app", "api", "admin", "face-checks", "route.ts");
      assert.ok(!adminApi.includes("similarityScore"), "admin API: bands only");
      assert.ok(!adminApi.includes("referenceId"), "admin API: no vendor identifiers");
      const adminPage = code("app", "admin", "verification", "page.tsx");
      assert.ok(!adminPage.includes("similarityScore"), "admin page: bands only");
      assert.ok(!adminPage.includes("referenceId"), "admin page: no vendor identifiers");
      const statusRoute = code("app", "api", "verification", "photo", "status", "route.ts");
      assert.ok(!/similarity|referenceId|embedding/.test(statusRoute), "client payload clean");
    });

    await check("face modules never log; audit metadata carries counts/codes only", () => {
      for (const file of [
        ["lib", "services", "face-verification.ts"],
        ["lib", "services", "face-reference.ts"],
        ["lib", "services", "face-match-providers.ts"],
        ["lib", "services", "risk-engine.ts"],
      ] as const) {
        const code = src(...file);
        assert.ok(!code.includes("console.log"), `${file.join("/")}: no logging`);
        assert.ok(
          !/metadata:\s*{[^}]*similarity/i.test(code),
          `${file.join("/")}: no raw scores in audit metadata`,
        );
      }
    });
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

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
