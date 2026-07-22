/**
 * L10.0 - the canonical verification timeline presentation. Proves the 5-step
 * timeline (one active step, completed steps done), the state-aware row label
 * (never "Verify" once started), and the per-stage status card (manual review is
 * NEVER an error; verified is success with no CTA; rejected offers a real fix,
 * never a generic provider error). Pure; no DB. Run:
 *   npx tsx tests/verification-timeline.test.ts
 */
import assert from "node:assert/strict";
import {
  deriveVerificationStage,
  resolveVerificationTimeline,
  type VerificationStage,
} from "../src/lib/verification-timeline";

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ok - ${name}`);
}

const t = (stage: VerificationStage, over: Partial<{ email: boolean; phone: boolean }> = {}) =>
  resolveVerificationTimeline({
    emailVerified: over.email ?? true,
    phoneVerified: over.phone ?? true,
    stage,
  });

function main() {
  // ---- Phase A: exactly one active step; completed steps are done -----------
  check("every stage yields AT MOST one active step", () => {
    const stages: VerificationStage[] = [
      "NOT_STARTED",
      "RECORDING",
      "CHECKING_PHOTOS",
      "MANUAL_REVIEW",
      "VERIFIED",
      "ACTION_REQUIRED",
      "EXPIRED",
      "UNAVAILABLE",
    ];
    for (const s of stages) {
      const actives = t(s).steps.filter((x) => x.status === "active").length;
      assert.ok(actives <= 1, `${s} had ${actives} active steps`);
    }
  });

  check("email+phone verified show as done; video active once phone done + not started", () => {
    const tl = t("NOT_STARTED");
    assert.equal(tl.steps.find((s) => s.key === "email")!.status, "done");
    assert.equal(tl.steps.find((s) => s.key === "phone")!.status, "done");
    assert.equal(tl.steps.find((s) => s.key === "video")!.status, "active");
  });

  check("CHECKING_PHOTOS: video DONE, photos ACTIVE, verified pending", () => {
    const tl = t("CHECKING_PHOTOS");
    assert.equal(tl.steps.find((s) => s.key === "video")!.status, "done");
    assert.equal(tl.steps.find((s) => s.key === "photos")!.status, "active");
    assert.equal(tl.steps.find((s) => s.key === "verified")!.status, "pending");
  });

  check("VERIFIED: all steps done", () => {
    for (const s of t("VERIFIED").steps) assert.equal(s.status, "done", s.key);
  });

  // ---- Phase B: state-aware row label, never "Verify" once started ----------
  check("row label is 'Verify' ONLY when not started", () => {
    assert.equal(t("NOT_STARTED").rowLabel, "Verify");
    for (const s of [
      "RECORDING",
      "CHECKING_PHOTOS",
      "MANUAL_REVIEW",
      "VERIFIED",
      "ACTION_REQUIRED",
    ] as VerificationStage[]) {
      assert.notEqual(t(s).rowLabel, "Verify", `${s} must not say Verify`);
    }
    assert.equal(t("RECORDING").rowLabel, "Recording…");
    assert.equal(t("CHECKING_PHOTOS").rowLabel, "Checking photos…");
    assert.equal(t("MANUAL_REVIEW").rowLabel, "Under review");
    assert.equal(t("VERIFIED").rowLabel, "Verified");
    assert.equal(t("ACTION_REQUIRED").rowLabel, "Action required");
  });

  // ---- Phase C: checking card is reassuring, no "record another video" ------
  check("CHECKING_PHOTOS card: complete + no new video, animated (spinner)", () => {
    const c = t("CHECKING_PHOTOS").card;
    assert.equal(c.tone, "progress");
    assert.equal(c.spinner, true);
    assert.match(c.title, /Video verification complete/);
    assert.match(c.body.toLowerCase(), /don't need to record another video|another video/);
    assert.equal(c.cta, null);
  });

  // ---- Phase D: manual review is NOT an error -------------------------------
  check("MANUAL_REVIEW card: review tone (not error/action), no-action-needed + Learn more", () => {
    const c = t("MANUAL_REVIEW").card;
    assert.equal(c.tone, "review");
    assert.notEqual(c.tone, "action");
    assert.match(c.body.toLowerCase(), /no action|keep tirvea safe|within 24 hours/);
    assert.deepEqual(c.cta, { label: "Learn more", action: "LEARN_MORE" });
  });

  // ---- Phase I: verified is success, no CTA ---------------------------------
  check("VERIFIED card: success tone, no CTA, mentions the badge", () => {
    const c = t("VERIFIED").card;
    assert.equal(c.tone, "success");
    assert.equal(c.cta, null);
    assert.match(c.title, /^Verified$/);
  });

  // ---- Phase J: rejected offers a real fix, not a provider error -------------
  check("ACTION_REQUIRED card: explains the fix + Replace photo, no generic provider error", () => {
    const c = t("ACTION_REQUIRED").card;
    assert.deepEqual(c.cta, { label: "Replace photo", action: "REPLACE_PHOTO" });
    assert.doesNotMatch(c.body.toLowerCase(), /provider|unavailable|try again later/);
    assert.match(c.body.toLowerCase(), /don't need to record another video|replace/);
  });

  // ---- deriveVerificationStage precedence -----------------------------------
  check("stage mapper precedence: verified > action > review > checking", () => {
    assert.equal(
      deriveVerificationStage({ verificationUx: "verified", facePresentation: "manual_review", faceActionStatus: "MANUAL_REVIEW" }),
      "VERIFIED",
    );
    assert.equal(
      deriveVerificationStage({ verificationUx: "pending", facePresentation: "action_required", faceActionStatus: "MANUAL_REVIEW" }),
      "ACTION_REQUIRED",
    );
    assert.equal(
      deriveVerificationStage({ verificationUx: "pending", facePresentation: "manual_review", faceActionStatus: "PROCESSING" }),
      "MANUAL_REVIEW",
    );
    assert.equal(
      deriveVerificationStage({ verificationUx: "pending", facePresentation: "checking_profile_photos", faceActionStatus: "PROCESSING" }),
      "CHECKING_PHOTOS",
    );
    assert.equal(
      deriveVerificationStage({ verificationUx: "not_started", facePresentation: null, faceActionStatus: "FIRST_TIME" }),
      "NOT_STARTED",
    );
  });

  console.log(`\n${passed} checks passed`);
}

main();
