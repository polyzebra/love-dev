/**
 * Live tests for the trust & safety enforcement backbone. Run:
 *   npx tsx tests/trust-safety.test.ts
 *
 * Layers:
 *  A. Pure: photo decision-engine matrix, graduated-enforcement ladder,
 *     status-ladder predicates, trust-engine recommendation mapping,
 *     gate routing for suspended/banned, rbac safety permissions.
 *  B. Database (real DB from .env, throwaway rows, cleaned in finally):
 *     graduated enforcement end-to-end, duplicate-case dedupe, upload
 *     gate, photo pipeline with the mock moderation provider (incl.
 *     provider-failure -> needs_review), appeal lifecycle incl. reversal
 *     and double-appeal 409, verification webhook idempotency + bad
 *     signature, ban-evasion credential checks, photo-deleted-mid-review
 *     auto-resolution. Spy/mock providers only - zero real emails/SMS
 *     (EMAIL/SMS outbox rows are outbox work items; no send worker runs
 *     here).
 *  C. Route-level (fetch, skipped when no dev server on :3000):
 *     unauthenticated admin safety API -> 401; restricted-session API
 *     behavior is covered at the lib level (requireSession is the choke
 *     point).
 */
import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

process.env.AUTH_HASH_SALT = process.env.AUTH_HASH_SALT || "test-salt";
// Deterministic mock moderation for the pipeline tests.
process.env.MODERATION_PROVIDER = "mock";
process.env.VERIFICATION_PROVIDER = "mock";
process.env.VERIFICATION_WEBHOOK_SECRET = "test-verification-secret";

const BASE = process.env.TEST_BASE_URL ?? "http://localhost:3000";
const RUN = Date.now().toString(36);

let passed = 0;
let skipped = 0;
async function check(name: string, fn: () => void | Promise<void>): Promise<void> {
  await fn();
  passed += 1;
  console.log(`  ok - ${name}`);
}
function skip(name: string, why: string): void {
  skipped += 1;
  console.log(`  SKIP - ${name} (${why})`);
}

async function main() {
  const { db } = await import("../src/lib/db");
  const {
    decidePhotoSafety,
    setMockModerationConfig,
    moderatePhoto,
    NULL_SCORES,
  } = await import("../src/lib/services/moderation");
  const {
    graduatedActionFor,
    statusForAction,
    canEngage,
    isDiscoverableStatus,
    isRestrictedStatus,
    enforceGraduated,
    applyDirectAction,
    openModerationCase,
    reverseViolation,
    assertUploadAllowed,
    isCredentialBanned,
    recordBanCredentials,
    clearBanCredentials,
    flagDeviceBanEvasion,
    resolveCasesForDeletedPhoto,
    sweepExpiredRestrictions,
  } = await import("../src/lib/services/trust-safety");
  const { recommendedActionFor, computeTrustProfile } = await import(
    "../src/lib/services/trust-engine"
  );
  const { authNextStep } = await import("../src/lib/auth/gate");
  const { hasPermission } = await import("../src/lib/rbac");
  const {
    mockVerificationProvider,
    mockWebhookSignature,
    applyVerificationOutcome,
    deriveVerificationUxState,
  } = await import("../src/lib/services/photo-verification");
  const { submitAppeal, reviewAppeal, getAccountStatusView, AppealError } = await import(
    "../src/lib/services/appeals"
  );

  const verdict = (scores: Partial<typeof NULL_SCORES>, extra: object = {}) => ({
    decision: "safe" as const,
    aiScore: null,
    faceDetected: true,
    facesCount: 1,
    labels: [] as string[],
    scores: { ...NULL_SCORES, confidence: 0.9, ...scores },
    ...extra,
  });

  // ------------------------------------------------------------------ A
  console.log("A. pure engines");

  await check("decision engine: benign scores approve", () => {
    const d = decidePhotoSafety(verdict({ adultScore: 0.1 }));
    assert.deepEqual([d.severity, d.action, d.caseType], ["low", "approve", null]);
  });

  await check("decision engine: medium adult -> approve + needs_review case", () => {
    const d = decidePhotoSafety(verdict({ adultScore: 0.7 }));
    assert.deepEqual([d.severity, d.action, d.caseType], [
      "medium",
      "needs_review",
      "EXPLICIT_CONTENT",
    ]);
  });

  await check("decision engine: high adult -> hide", () => {
    const d = decidePhotoSafety(verdict({ adultScore: 0.9 }));
    assert.deepEqual([d.severity, d.action], ["high", "hide"]);
    assert.equal(d.policyCritical, false);
  });

  await check("decision engine: minor risk -> critical block, policy-critical", () => {
    const d = decidePhotoSafety(verdict({ minorRiskScore: 0.7 }));
    assert.deepEqual([d.severity, d.action, d.caseType, d.policyCritical], [
      "critical",
      "block",
      "MINOR_SAFETY",
      true,
    ]);
  });

  await check("decision engine: minors label + adult content -> critical", () => {
    const d = decidePhotoSafety({ ...verdict({ adultScore: 0.5 }), labels: ["minors"] });
    assert.equal(d.severity, "critical");
  });

  await check("decision engine: stolen images (reverse image) -> hide", () => {
    const d = decidePhotoSafety(verdict({ reverseImageRisk: 0.9 }));
    assert.deepEqual([d.action, d.caseType], ["hide", "STOLEN_IMAGES"]);
  });

  await check("decision engine: ai-generated medium -> impersonation review", () => {
    const d = decidePhotoSafety(verdict({ aiGeneratedScore: 0.7 }));
    assert.deepEqual([d.action, d.caseType], ["needs_review", "IMPERSONATION"]);
  });

  await check("decision engine: provider 'rejected' escalates to high even without scores", () => {
    const d = decidePhotoSafety({ ...verdict({}), decision: "rejected" as const });
    assert.equal(d.action, "hide");
  });

  await check("graduated ladder: 1st photo offense removes photo, no ban ever", () => {
    assert.equal(
      graduatedActionFor({ priorCount: 0, policyCritical: false, confidence: 0.9, hasPhotoContext: true }),
      "PHOTO_REMOVED",
    );
    assert.equal(
      graduatedActionFor({ priorCount: 1, policyCritical: false, confidence: 0.9, hasPhotoContext: true }),
      "UPLOAD_BLOCKED",
    );
    assert.equal(
      graduatedActionFor({ priorCount: 2, policyCritical: false, confidence: 0.9, hasPhotoContext: true }),
      "LIMITED",
    );
    for (let n = 3; n < 10; n++) {
      const action = graduatedActionFor({
        priorCount: n,
        policyCritical: false,
        confidence: 0.9,
        hasPhotoContext: true,
      });
      assert.equal(action, "SUSPENDED", `prior=${n} must cap at SUSPENDED`);
      assert.notEqual(action, "BANNED");
    }
  });

  await check("graduated ladder: policy-critical + high confidence -> SUSPENDED (not banned)", () => {
    assert.equal(
      graduatedActionFor({ priorCount: 0, policyCritical: true, confidence: 0.95, hasPhotoContext: true }),
      "SUSPENDED",
    );
    // Low confidence policy-critical falls back to the normal ladder.
    assert.equal(
      graduatedActionFor({ priorCount: 0, policyCritical: true, confidence: 0.4, hasPhotoContext: true }),
      "PHOTO_REMOVED",
    );
  });

  await check("status ladder predicates", () => {
    assert.equal(statusForAction("WARNING"), null);
    assert.equal(statusForAction("LIMITED"), "LIMITED");
    assert.equal(statusForAction("BANNED"), "BANNED");
    assert.ok(canEngage("ACTIVE") && canEngage("PHOTO_REVIEW_REQUIRED"));
    assert.ok(!canEngage("LIMITED") && !canEngage("SUSPENDED") && !canEngage("BANNED"));
    assert.ok(isDiscoverableStatus("LIMITED") && isDiscoverableStatus("ACTIVE"));
    assert.ok(!isDiscoverableStatus("SUSPENDED") && !isDiscoverableStatus("SHADOW_BANNED"));
    assert.ok(isRestrictedStatus("BANNED") && !isRestrictedStatus("LIMITED"));
  });

  await check("trust engine recommendation mapping is monotone and bounded", () => {
    assert.equal(recommendedActionFor(0, []), "NO_ACTION");
    assert.equal(recommendedActionFor(20, []), "SHOW_WARNING");
    assert.equal(recommendedActionFor(35, ["photo_rejected_x2"]), "REQUIRE_PHOTO_VERIFICATION");
    assert.equal(recommendedActionFor(50, ["reported_x3"]), "LIMIT_MESSAGING");
    assert.equal(recommendedActionFor(50, []), "HIDE_PROFILE");
    assert.equal(recommendedActionFor(60, []), "SEND_TO_MANUAL_REVIEW");
    assert.equal(recommendedActionFor(75, []), "SUSPEND_ACCOUNT");
    assert.equal(recommendedActionFor(90, []), "BAN_ACCOUNT");
  });

  const gateBase = {
    email: "x@example.com",
    emailVerified: new Date(),
    phoneVerifiedAt: new Date(),
    ageConfirmedAt: new Date(),
    termsVersion: "v",
    privacyVersion: "v",
    communityVersion: "v",
    onboardingDone: true,
  };
  await check("gate: suspended/banned route to /account-blocked, limited stays in app", () => {
    assert.equal(authNextStep({ ...gateBase, status: "SUSPENDED", bannedAt: null }), "/account-blocked");
    assert.equal(authNextStep({ ...gateBase, status: "BANNED", bannedAt: new Date() }), "/account-blocked");
    assert.equal(authNextStep({ ...gateBase, status: "ACTIVE", bannedAt: new Date() }), "/account-blocked");
    assert.notEqual(authNextStep({ ...gateBase, status: "LIMITED", bannedAt: null }), "/account-blocked");
    assert.notEqual(
      authNextStep({ ...gateBase, status: "PHOTO_REVIEW_REQUIRED", bannedAt: null }),
      "/account-blocked",
    );
  });

  await check("rbac: safety permissions tiering", () => {
    assert.equal(hasPermission("USER", "safety:read"), false);
    assert.equal(hasPermission("USER", "safety:manage"), false);
    assert.equal(hasPermission("MODERATOR", "safety:read"), true);
    assert.equal(hasPermission("MODERATOR", "safety:manage"), false);
    assert.equal(hasPermission("ADMIN", "safety:manage"), true);
    assert.equal(hasPermission("SUPER_ADMIN", "safety:manage"), true);
  });

  await check("verification UX state derivation", () => {
    assert.equal(deriveVerificationUxState({ photoVerifiedAt: new Date(), verification: null }), "verified");
    assert.equal(deriveVerificationUxState({ photoVerifiedAt: null, verification: null }), "not_verified");
    assert.equal(
      deriveVerificationUxState({
        photoVerifiedAt: null,
        verification: { status: "PENDING", providerSessionId: "s", reviewNote: null },
      }),
      "pending",
    );
    assert.equal(
      deriveVerificationUxState({
        photoVerifiedAt: null,
        verification: { status: "IN_REVIEW", providerSessionId: "s", reviewNote: null },
      }),
      "manual_review",
    );
    assert.equal(
      deriveVerificationUxState({
        photoVerifiedAt: null,
        verification: { status: "REJECTED", providerSessionId: "s", reviewNote: null },
      }),
      "retry_available",
    );
  });

  // ------------------------------------------------------------------ B
  console.log("B. live database");

  const email = (tag: string) => `trust-safety-${tag}-${RUN}@example.test`;
  const userIds: string[] = [];
  const makeUser = async (tag: string, data: Record<string, unknown> = {}) => {
    const u = await db.user.create({
      data: { email: email(tag), emailVerified: new Date(), onboardingDone: true, ...data },
    });
    userIds.push(u.id);
    return u;
  };

  try {
    // --- graduated enforcement end-to-end -------------------------------
    const ladder = await makeUser("ladder");
    const casesForLadder = await openModerationCase({
      userId: ladder.id,
      caseType: "EXPLICIT_CONTENT",
      severity: "HIGH",
      source: "AUTOMATED",
      summary: "test case",
      photoId: "test-photo-1",
    });

    await check("duplicate case dedupe: second open case for user+type merges", async () => {
      const second = await openModerationCase({
        userId: ladder.id,
        caseType: "EXPLICIT_CONTENT",
        severity: "CRITICAL",
        source: "AUTOMATED",
        summary: "second signal",
        photoId: "test-photo-2",
      });
      assert.equal(second.deduped, true);
      assert.equal(second.caseId, casesForLadder.caseId);
      const row = await db.moderationCase.findUniqueOrThrow({ where: { id: second.caseId } });
      assert.equal(row.severity, "CRITICAL", "severity must only escalate");
      assert.ok(Array.isArray(row.evidence) && (row.evidence as unknown[]).length === 2);
      const open = await db.moderationCase.count({
        where: { userId: ladder.id, caseType: "EXPLICIT_CONTENT", status: { in: ["OPEN", "UNDER_REVIEW"] } },
      });
      assert.equal(open, 1);
    });

    await check("enforcement 1st offense: photo removed, account stays ACTIVE", async () => {
      const o = await enforceGraduated({
        userId: ladder.id,
        violationType: "EXPLICIT_CONTENT",
        photoId: "test-photo-1",
        moderationCaseId: casesForLadder.caseId,
        internalReason: "test offense 1",
        confidence: 0.9,
      });
      assert.equal(o.actionTaken, "PHOTO_REMOVED");
      assert.equal(o.accountStatus, "ACTIVE");
    });

    await check("enforcement 2nd offense: upload blocked + upload gate refuses", async () => {
      const o = await enforceGraduated({
        userId: ladder.id,
        violationType: "EXPLICIT_CONTENT",
        photoId: "test-photo-2",
        internalReason: "test offense 2",
        confidence: 0.9,
      });
      assert.equal(o.actionTaken, "UPLOAD_BLOCKED");
      const gate = await assertUploadAllowed(ladder.id);
      assert.equal(gate.ok, false);
      assert.equal((gate as { code: string }).code, "upload_blocked");
    });

    await check("enforcement 3rd offense: LIMITED status", async () => {
      const o = await enforceGraduated({
        userId: ladder.id,
        violationType: "SPAM",
        internalReason: "test offense 3",
      });
      assert.equal(o.actionTaken, "LIMITED");
      assert.equal(o.accountStatus, "LIMITED");
    });

    await check("enforcement 4th offense: SUSPENDED, never auto-BANNED", async () => {
      const o = await enforceGraduated({
        userId: ladder.id,
        violationType: "SPAM",
        internalReason: "test offense 4",
      });
      assert.equal(o.actionTaken, "SUSPENDED");
      assert.equal(o.accountStatus, "SUSPENDED");
      const banned = await db.accountViolation.count({
        where: { userId: ladder.id, actionTaken: "BANNED" },
      });
      assert.equal(banned, 0);
    });

    await check("safety notices went through the outbox (in-app rows, no fake sends)", async () => {
      const notices = await db.notification.count({
        where: { userId: ladder.id, type: "SAFETY" },
      });
      assert.ok(notices >= 4, `expected >=4 SAFETY notices, got ${notices}`);
      const sent = await db.notificationDelivery.count({
        where: {
          notification: { userId: ladder.id, type: "SAFETY" },
          channel: "EMAIL",
          status: "SENT",
        },
      });
      assert.equal(sent, 0, "no EMAIL delivery may ever be marked SENT without a provider send");
    });

    // --- policy-critical automation caps at SUSPENDED -------------------
    await check("policy-critical first offense: suspended pending review (human confirms)", async () => {
      const pc = await makeUser("policycritical");
      const o = await enforceGraduated({
        userId: pc.id,
        violationType: "MINOR_SAFETY",
        policyCritical: true,
        confidence: 0.95,
        internalReason: "critical signal",
      });
      assert.equal(o.actionTaken, "SUSPENDED");
      const u = await db.user.findUniqueOrThrow({ where: { id: pc.id } });
      assert.equal(u.status, "SUSPENDED");
      assert.equal(u.bannedAt, null);
    });

    // --- photo pipeline with the mock provider --------------------------
    const uploader = await makeUser("uploader");
    const makePhoto = async () => {
      const id = randomUUID();
      return db.photo.create({
        data: {
          id,
          userId: uploader.id,
          url: `/api/media/${id}/card`,
          status: "ACTIVE",
          position: 0,
        },
      });
    };

    await check("pipeline: benign photo approved + result row persisted", async () => {
      const photo = await makePhoto();
      setMockModerationConfig({ adultScore: 0.05 }, uploader.id);
      const outcome = await moderatePhoto(photo.id);
      assert.equal(outcome.action, "approve");
      const row = await db.photo.findUniqueOrThrow({ where: { id: photo.id } });
      assert.equal(row.moderation, "APPROVED");
      assert.equal(row.status, "ACTIVE");
      const result = await db.photoModerationResult.findFirstOrThrow({
        where: { photoId: photo.id },
      });
      assert.equal(result.provider, "mock");
      assert.equal(result.resultStatus, "APPROVED");
      assert.equal(result.adultScore, 0.05);
    });

    await check("pipeline: medium risk stays visible, flagged + case", async () => {
      const photo = await makePhoto();
      setMockModerationConfig({ adultScore: 0.7 }, uploader.id);
      const outcome = await moderatePhoto(photo.id);
      assert.equal(outcome.action, "needs_review");
      assert.ok(outcome.caseId);
      assert.equal(outcome.violationId, null, "medium must NOT create a violation");
      const row = await db.photo.findUniqueOrThrow({ where: { id: photo.id } });
      assert.equal(row.moderation, "PENDING");
      assert.equal(row.status, "ACTIVE");
    });

    let hiddenPhotoId: string;
    let hideViolationId: string;
    await check("pipeline: high risk hides photo + graduated violation", async () => {
      const photo = await makePhoto();
      hiddenPhotoId = photo.id;
      setMockModerationConfig({ adultScore: 0.9 }, uploader.id);
      const outcome = await moderatePhoto(photo.id);
      assert.equal(outcome.action, "hide");
      assert.ok(outcome.violationId, "hide must create a violation");
      hideViolationId = outcome.violationId!;
      const row = await db.photo.findUniqueOrThrow({ where: { id: photo.id } });
      assert.equal(row.moderation, "REJECTED");
      assert.equal(row.status, "REJECTED");
      const violation = await db.accountViolation.findUniqueOrThrow({
        where: { id: outcome.violationId! },
      });
      assert.equal(violation.actionTaken, "PHOTO_REMOVED"); // first offense
      const u = await db.user.findUniqueOrThrow({ where: { id: uploader.id } });
      assert.equal(u.status, "ACTIVE", "first offense never restricts the account");
    });

    await check("false-positive reversal restores photo + status + case", async () => {
      const reversal = await reverseViolation(hideViolationId);
      assert.equal(reversal.restoredStatus, "ACTIVE");
      assert.deepEqual(reversal.restoredPhotoIds, [hiddenPhotoId]);
      const row = await db.photo.findUniqueOrThrow({ where: { id: hiddenPhotoId } });
      assert.equal(row.status, "ACTIVE");
      assert.equal(row.moderation, "APPROVED");
      const v = await db.accountViolation.findUniqueOrThrow({ where: { id: hideViolationId } });
      assert.ok(v.reversedAt);
      if (v.moderationCaseId) {
        const c = await db.moderationCase.findUniqueOrThrow({ where: { id: v.moderationCaseId } });
        assert.equal(c.status, "REVERSED");
      }
    });

    await check("pipeline: critical (minor safety) blocks + suspends + urgent case", async () => {
      const minorUser = await makeUser("minorcase");
      const id = randomUUID();
      const photo = await db.photo.create({
        data: { id, userId: minorUser.id, url: `/api/media/${id}/card`, status: "ACTIVE" },
      });
      setMockModerationConfig({ minorRiskScore: 0.9, confidence: 0.95 }, minorUser.id);
      const outcome = await moderatePhoto(photo.id);
      assert.equal(outcome.action, "block");
      assert.equal(outcome.severity, "critical");
      const u = await db.user.findUniqueOrThrow({ where: { id: minorUser.id } });
      assert.equal(u.status, "SUSPENDED", "critical suspends pending human review");
      assert.equal(u.bannedAt, null, "automation must never ban");
      const c = await db.moderationCase.findFirstOrThrow({
        where: { userId: minorUser.id, caseType: "MINOR_SAFETY" },
      });
      assert.equal(c.severity, "CRITICAL");
    });

    await check("pipeline: provider failure -> needs_review (FAILED result), never approve", async () => {
      // Force the external provider with an unreachable endpoint; the photo
      // has no storagePath so the download fails before any network call.
      process.env.MODERATION_PROVIDER = "";
      process.env.MODERATION_API_URL = "http://127.0.0.1:9/unreachable";
      process.env.MODERATION_API_KEY = "test";
      try {
        const failUser = await makeUser("providerfail");
        const id = randomUUID();
        const photo = await db.photo.create({
          data: { id, userId: failUser.id, url: `/api/media/${id}/card`, status: "ACTIVE" },
        });
        const outcome = await moderatePhoto(photo.id);
        assert.equal(outcome.action, "provider_failed");
        const row = await db.photo.findUniqueOrThrow({ where: { id: photo.id } });
        assert.equal(row.moderation, "PENDING", "failure lands in the review queue");
        assert.equal(row.status, "ACTIVE");
        const result = await db.photoModerationResult.findFirstOrThrow({
          where: { photoId: photo.id },
        });
        assert.equal(result.resultStatus, "FAILED");
      } finally {
        process.env.MODERATION_PROVIDER = "mock";
        delete process.env.MODERATION_API_URL;
        delete process.env.MODERATION_API_KEY;
      }
    });

    await check("photo deleted mid-review auto-resolves its open case", async () => {
      const delUser = await makeUser("photodelete");
      const opened = await openModerationCase({
        userId: delUser.id,
        caseType: "STOLEN_IMAGES",
        severity: "MEDIUM",
        source: "AUTOMATED",
        summary: "flagged",
        photoId: "deleted-photo-xyz",
      });
      const resolved = await resolveCasesForDeletedPhoto("deleted-photo-xyz");
      assert.equal(resolved, 1);
      const c = await db.moderationCase.findUniqueOrThrow({ where: { id: opened.caseId } });
      assert.equal(c.status, "DISMISSED");
    });

    // --- appeal lifecycle ------------------------------------------------
    const admin = await makeUser("admin", { role: "ADMIN" });
    const banned = await makeUser("banned", {
      phoneE164: `+35389${String(Date.now()).slice(-7)}`,
      phoneVerifiedAt: new Date(),
      lastDeviceHash: `testdevicehash-${RUN}`,
    });

    let banViolationId: string;
    await check("human ban: violation + BANNED status + credential snapshot", async () => {
      const outcome = await applyDirectAction({
        userId: banned.id,
        violationType: "SCAM",
        action: "BANNED",
        internalReason: "test ban",
        userVisibleReason: "Activity that goes against our guidelines.",
      });
      banViolationId = outcome.violationId;
      const u = await db.user.findUniqueOrThrow({ where: { id: banned.id } });
      assert.equal(u.status, "BANNED");
      assert.ok(u.bannedAt);
      assert.equal(await isCredentialBanned("PHONE", banned.phoneE164!), true);
      assert.equal(await isCredentialBanned("DEVICE", `testdevicehash-${RUN}`), true);
    });

    await check("ban evasion: device flag opens a SYSTEM case for another account", async () => {
      const evader = await makeUser("evader");
      const flagged = await flagDeviceBanEvasion(evader.id, `testdevicehash-${RUN}`);
      assert.equal(flagged, true);
      const c = await db.moderationCase.findFirstOrThrow({
        where: { userId: evader.id, source: "SYSTEM" },
      });
      assert.equal(c.severity, "HIGH");
      // An unknown hash does not flag.
      assert.equal(await flagDeviceBanEvasion(evader.id, "never-banned-hash"), false);
    });

    await check("appeal after ban allowed: submit succeeds while BANNED", async () => {
      const res = await submitAppeal({
        userId: banned.id,
        violationId: banViolationId,
        appealText: "I believe this was a mistake, please take another look.",
      });
      assert.equal(res.status, "SUBMITTED");
      const c = await db.appeal.findUniqueOrThrow({ where: { id: res.appealId } });
      assert.equal(c.userId, banned.id);
    });

    await check("double appeal while open -> 409 appeal_already_open", async () => {
      await assert.rejects(
        submitAppeal({
          userId: banned.id,
          violationId: banViolationId,
          appealText: "Second appeal attempt for the same violation.",
        }),
        (e: unknown) => e instanceof AppealError && e.code === "appeal_already_open" && e.httpStatus === 409,
      );
    });

    await check("status read model: banned card + appealed tab, user-visible only", async () => {
      const view = await getAccountStatusView(banned.id);
      assert.ok(view);
      assert.equal(view!.status, "BANNED");
      const v = view!.violations.find((x) => x.id === banViolationId)!;
      assert.equal(v.tab, "appealed");
      assert.equal(v.canAppeal, false);
      assert.equal(v.appeal?.status, "SUBMITTED");
      assert.ok(!("internalReason" in v), "read model must not leak internal fields");
      assert.ok(!("confidence" in v));
    });

    await check("appeal approval reverses everything (reactivation)", async () => {
      const appeal = await db.appeal.findFirstOrThrow({
        where: { violationId: banViolationId },
      });
      const result = await reviewAppeal({
        actorId: admin.id,
        appealId: appeal.id,
        decision: "approve",
        adminNotes: "Confirmed false positive.",
      });
      assert.equal(result.status, "APPROVED");
      assert.equal(result.restoredStatus, "ACTIVE");
      const u = await db.user.findUniqueOrThrow({ where: { id: banned.id } });
      assert.equal(u.status, "ACTIVE");
      assert.equal(u.bannedAt, null);
      assert.equal(await isCredentialBanned("PHONE", banned.phoneE164!), false);
      assert.equal(await isCredentialBanned("DEVICE", `testdevicehash-${RUN}`), false);
      const log = await db.adminLog.findFirst({
        where: { actorId: admin.id, action: "appeal.approve", targetId: appeal.id },
      });
      assert.ok(log, "appeal decision must be audited");
    });

    await check("deciding an already-decided appeal -> 409", async () => {
      const appeal = await db.appeal.findFirstOrThrow({ where: { violationId: banViolationId } });
      await assert.rejects(
        reviewAppeal({ actorId: admin.id, appealId: appeal.id, decision: "reject" }),
        (e: unknown) => e instanceof AppealError && e.code === "appeal_not_pending",
      );
    });

    await check("rejected appeal is final: re-submitting -> 409 already_decided", async () => {
      const suspect = await makeUser("rejectpath");
      const o = await applyDirectAction({
        userId: suspect.id,
        violationType: "SPAM",
        action: "SUSPENDED",
        internalReason: "test suspension",
      });
      const sub = await submitAppeal({
        userId: suspect.id,
        violationId: o.violationId,
        appealText: "Please review this suspension decision.",
      });
      const rej = await reviewAppeal({
        actorId: admin.id,
        appealId: sub.appealId,
        decision: "reject",
        adminNotes: "Reviewed - decision stands.",
      });
      assert.equal(rej.status, "REJECTED");
      const u = await db.user.findUniqueOrThrow({ where: { id: suspect.id } });
      assert.equal(u.status, "SUSPENDED", "rejection leaves the action in force");
      await assert.rejects(
        submitAppeal({
          userId: suspect.id,
          violationId: o.violationId,
          appealText: "Trying to appeal one more time after rejection.",
        }),
        (e: unknown) =>
          e instanceof AppealError && e.code === "appeal_already_decided" && e.httpStatus === 409,
      );
    });

    // --- verification webhook idempotency --------------------------------
    await check("verification webhook: signed, applied once, idempotent on retry", async () => {
      const verifyUser = await makeUser("verify");
      const session = await mockVerificationProvider.createSession(verifyUser.id);
      await db.verification.create({
        data: {
          userId: verifyUser.id,
          type: "PHOTO",
          status: "PENDING",
          provider: "mock",
          providerSessionId: session.sessionId,
        },
      });

      const rawBody = JSON.stringify({ sessionId: session.sessionId, status: "approved" });
      const signature = mockWebhookSignature(rawBody, "test-verification-secret");
      const event = await mockVerificationProvider.handleWebhook({ rawBody, signature });
      assert.equal(event.status, "approved");

      const first = await applyVerificationOutcome("mock", session.sessionId, event.status);
      assert.deepEqual(
        { applied: first.applied, userId: first.applied ? first.userId : null },
        { applied: true, userId: verifyUser.id },
      );
      const u = await db.user.findUniqueOrThrow({ where: { id: verifyUser.id } });
      assert.ok(u.photoVerifiedAt, "approval stamps the canonical verdict");

      // Retry (same delivery again) - must be a no-op.
      const second = await applyVerificationOutcome("mock", session.sessionId, event.status);
      assert.equal(second.applied, false);
      assert.equal((second as { reason: string }).reason, "already_applied");

      // Bad signature never parses.
      await assert.rejects(
        mockVerificationProvider.handleWebhook({ rawBody, signature: "deadbeef" }),
        (e: unknown) => (e as { code?: string }).code === "bad_signature",
      );
    });

    // --- trust engine -----------------------------------------------------
    await check("trust engine: signals accumulate and persist staff-side", async () => {
      const risky = await makeUser("risky");
      const reporter1 = await makeUser("rep1");
      const reporter2 = await makeUser("rep2");
      await db.report.createMany({
        data: [
          { reporterId: reporter1.id, reportedId: risky.id, reason: "SCAM" },
          { reporterId: reporter2.id, reportedId: risky.id, reason: "SPAM" },
        ],
      });
      await applyDirectAction({
        userId: risky.id,
        violationType: "SPAM",
        action: "WARNING",
        internalReason: "test warning",
      });
      const profile = await computeTrustProfile(risky.id);
      assert.ok(profile);
      assert.ok(profile!.riskScore >= 35, `expected >=35, got ${profile!.riskScore}`);
      assert.ok(profile!.reasons.some((r) => r.startsWith("reported_x2")));
      assert.ok(profile!.reasons.some((r) => r.startsWith("violation_x1")));
      const u = await db.user.findUniqueOrThrow({ where: { id: risky.id } });
      assert.equal(u.safetyRiskScore, profile!.riskScore);
      assert.ok(u.safetyRecommendedAction);
    });

    // --- expiring restrictions -------------------------------------------
    await check("expired LIMITED restriction lifts lazily", async () => {
      const limited = await makeUser("expiry", { status: "LIMITED" });
      await db.accountViolation.create({
        data: {
          userId: limited.id,
          violationType: "SPAM",
          actionTaken: "LIMITED",
          description: "test",
          userVisibleReason: "test",
          expiresAt: new Date(Date.now() - 1000), // already lapsed
        },
      });
      const status = await sweepExpiredRestrictions(limited.id);
      assert.equal(status, "ACTIVE");
      const u = await db.user.findUniqueOrThrow({ where: { id: limited.id } });
      assert.equal(u.status, "ACTIVE");
    });

    // --- upload gate for photo_review_required ---------------------------
    await check("upload gate: PHOTO_REVIEW_REQUIRED blocks uploads", async () => {
      const prr = await makeUser("prr", { status: "PHOTO_REVIEW_REQUIRED" });
      const gate = await assertUploadAllowed(prr.id);
      assert.equal(gate.ok, false);
      assert.equal((gate as { code: string }).code, "photo_review_required");
    });

    // --- ban credential expiry -------------------------------------------
    await check("ban credentials: record/check/clear round-trip", async () => {
      const cred = await makeUser("cred", {
        phoneE164: `+35388${String(Date.now()).slice(-7)}`,
      });
      await recordBanCredentials(cred.id, "test");
      assert.equal(await isCredentialBanned("PHONE", cred.phoneE164!), true);
      await clearBanCredentials(cred.id);
      assert.equal(await isCredentialBanned("PHONE", cred.phoneE164!), false);
    });

    // ------------------------------------------------------------------ C
    console.log("C. route-level (dev server optional)");
    let serverUp = false;
    try {
      const res = await fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(2500) });
      serverUp = res.ok || res.status < 500;
    } catch {
      serverUp = false;
    }
    if (!serverUp) {
      skip("admin safety routes unauth 401 / non-admin 403", `no server at ${BASE}`);
      skip("appeal route unauth 401", `no server at ${BASE}`);
    } else {
      await check("unauthenticated admin safety APIs answer 401", async () => {
        for (const path of [
          "/api/admin/safety/cases",
          "/api/admin/safety/appeals",
        ]) {
          const res = await fetch(`${BASE}${path}`);
          assert.equal(res.status, 401, `${path} -> ${res.status}`);
        }
        const post = await fetch(`${BASE}/api/admin/safety/users/x/recompute`, { method: "POST" });
        assert.equal(post.status, 401);
      });
      await check("unauthenticated appeal/status routes answer 401", async () => {
        const status = await fetch(`${BASE}/api/account/status`);
        assert.equal(status.status, 401);
        const appeal = await fetch(`${BASE}/api/appeals`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ violationId: "x", appealText: "aaaaaaaaaaaa" }),
        });
        assert.equal(appeal.status, 401);
      });
    }
  } finally {
    // Cleanup: users cascade to violations/appeals/cases/photos/etc.
    for (const id of userIds) {
      await db.bannedCredential.deleteMany({ where: { sourceUserId: id } }).catch(() => {});
      await db.user.delete({ where: { id } }).catch(() => {});
    }
    await db.$disconnect();
  }

  console.log(`\n${passed} passed, ${skipped} skipped`);
}

main().catch((error) => {
  console.error("\nFAILED:", error);
  process.exit(1);
});
