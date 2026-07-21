/**
 * L8.3.1 / L8.3.3 - the ONE canonical verification UX resolver. Proves the
 * resolver returns the exact { status, headline, description, cta, blockingReason,
 * progress } contract, the EXACT approved copy per state, a REAL action on every
 * CTA, never a generic/consequence message, and that a reference user is NEVER
 * asked for another liveness. Pure; no DB. Run:
 *   npx tsx tests/face-action-resolver.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  resolveFaceVerificationAction,
  type FaceActionFacts,
} from "../src/lib/verification-presentation";

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ok - ${name}`);
}

/** A fully-live layer for a verified, enrolled, settled user. Override per test. */
function facts(over: Partial<FaceActionFacts> = {}): FaceActionFacts {
  return {
    eligible: true,
    badgeSuspended: false,
    hasReference: true,
    consentWithdrawn: false,
    faceLayerConfigured: true,
    legalGateOpen: true,
    emergencyDisabled: false,
    routeWired: true,
    photoOutcome: "NONE",
    ...over,
  };
}

function main() {
  // ---- Contract shape -------------------------------------------------------
  check("every result has the canonical { status, headline, description, cta, progress } shape", () => {
    const a = resolveFaceVerificationAction(facts());
    for (const k of ["status", "headline", "description", "cta", "blockingReason", "progress"]) {
      assert.ok(k in a, `missing ${k}`);
    }
    assert.equal(typeof a.progress.spinner, "boolean");
  });

  // ---- First-time enrolment (exact copy) ------------------------------------
  check("no reference -> FIRST_TIME with the exact approved copy + real CTA", () => {
    const a = resolveFaceVerificationAction(facts({ hasReference: false }));
    assert.equal(a.status, "FIRST_TIME");
    assert.equal(a.headline, "Complete Face Verification");
    assert.equal(
      a.description,
      "Complete a quick one-time face verification before you can start dating. This usually takes about 10 seconds. No ID document is required.",
    );
    assert.deepEqual(a.cta, { label: "Start Face Verification", action: "START_LIVENESS" });
    assert.equal(a.progress.spinner, false);
  });

  // THE core invariant: a gallery change never re-triggers liveness.
  check("INVARIANT: hasReference=true NEVER yields FIRST_TIME (any outcome/flags)", () => {
    const outcomes: FaceActionFacts["photoOutcome"][] = [
      "NONE",
      "PROCESSING",
      "MATCH_FAILED",
      "NO_FACE",
      "MULTIPLE_FACES",
      "MANUAL_REVIEW",
    ];
    for (const photoOutcome of outcomes) {
      for (const badgeSuspended of [true, false]) {
        const a = resolveFaceVerificationAction(facts({ photoOutcome, badgeSuspended }));
        assert.notEqual(a.status, "FIRST_TIME", `${photoOutcome}/${badgeSuspended}`);
      }
    }
  });

  // ---- Photo processing (spinner, no CTA) -----------------------------------
  check("reference + PROCESSING -> spinner, no CTA, exact copy", () => {
    const a = resolveFaceVerificationAction(facts({ photoOutcome: "PROCESSING" }));
    assert.equal(a.status, "PROCESSING");
    assert.equal(a.headline, "Checking your new photo");
    assert.equal(
      a.description,
      "We're comparing your new photo with your verified face. No additional face verification is required.",
    );
    assert.equal(a.cta, null);
    assert.equal(a.progress.spinner, true);
  });

  check("a badge-suspended photo with no reported outcome still reads as PROCESSING", () => {
    const a = resolveFaceVerificationAction(facts({ badgeSuspended: true, photoOutcome: "NONE" }));
    assert.equal(a.status, "PROCESSING");
  });

  // ---- Failure states (exact copy + real CTA) -------------------------------
  check("MATCH_FAILED -> 'This photo couldn't be verified' + Replace Photo", () => {
    const a = resolveFaceVerificationAction(facts({ photoOutcome: "MATCH_FAILED" }));
    assert.equal(a.status, "MATCH_FAILED");
    assert.equal(a.headline, "This photo couldn't be verified");
    assert.equal(a.description, "Choose another photo showing your face clearly.");
    assert.deepEqual(a.cta, { label: "Replace Photo", action: "REPLACE_PHOTO" });
  });

  check("NO_FACE -> 'No face detected' + Choose Another Photo", () => {
    const a = resolveFaceVerificationAction(facts({ photoOutcome: "NO_FACE" }));
    assert.equal(a.status, "NO_FACE");
    assert.equal(a.headline, "No face detected");
    assert.equal(a.description, "Your cover photo must clearly show your face.");
    assert.deepEqual(a.cta, { label: "Choose Another Photo", action: "REPLACE_PHOTO" });
  });

  check("MULTIPLE_FACES -> 'Multiple faces detected' + Replace Photo", () => {
    const a = resolveFaceVerificationAction(facts({ photoOutcome: "MULTIPLE_FACES" }));
    assert.equal(a.status, "MULTIPLE_FACES");
    assert.equal(a.headline, "Multiple faces detected");
    assert.equal(a.description, "Use a photo that only shows you.");
    assert.deepEqual(a.cta, { label: "Replace Photo", action: "REPLACE_PHOTO" });
  });

  check("MANUAL_REVIEW -> 'Photo under review', no CTA", () => {
    const a = resolveFaceVerificationAction(facts({ photoOutcome: "MANUAL_REVIEW" }));
    assert.equal(a.status, "MANUAL_REVIEW");
    assert.equal(a.headline, "Photo under review");
    assert.equal(a.description, "We'll notify you when the review is complete.");
    assert.equal(a.cta, null);
  });

  check("reference + settled -> VERIFIED, nothing required", () => {
    const a = resolveFaceVerificationAction(facts());
    assert.equal(a.status, "VERIFIED");
    assert.equal(a.cta, null);
    assert.equal(a.progress.spinner, false);
  });

  // ---- Unavailable (exact copy + Retry) -------------------------------------
  check("provider dormant -> UNAVAILABLE with the exact copy + Retry", () => {
    const a = resolveFaceVerificationAction(facts({ faceLayerConfigured: false }));
    assert.equal(a.status, "UNAVAILABLE");
    assert.equal(a.headline, "Verification temporarily unavailable");
    assert.equal(a.description, "Please try again later.");
    assert.deepEqual(a.cta, { label: "Retry", action: "RETRY" });
    assert.equal(a.blockingReason, "AWS_UNAVAILABLE");
  });

  check("each gate maps to UNAVAILABLE with its exact blockingReason", () => {
    const cases: [Partial<FaceActionFacts>, string][] = [
      [{ emergencyDisabled: true }, "EMERGENCY_DISABLED"],
      [{ faceLayerConfigured: false }, "AWS_UNAVAILABLE"],
      [{ legalGateOpen: false }, "LEGAL_GATE_CLOSED"],
      [{ routeWired: false }, "ROUTE_NOT_WIRED"],
    ];
    for (const [over, reason] of cases) {
      const a = resolveFaceVerificationAction(facts(over));
      assert.equal(a.status, "UNAVAILABLE");
      assert.equal(a.blockingReason, reason);
      assert.deepEqual(a.cta, { label: "Retry", action: "RETRY" });
    }
  });

  // ---- L9.1.2: AWS liveness is OPTIONAL and Stripe-independent ---------------
  check("registered user, no reference -> FIRST_TIME (AWS CTA) regardless of Stripe", () => {
    // The resolver no longer takes Stripe/identity as an input at all: a
    // registered, eligible user with no reference gets the optional AWS CTA.
    const a = resolveFaceVerificationAction(facts({ eligible: true, hasReference: false }));
    assert.equal(a.status, "FIRST_TIME");
    assert.deepEqual(a.cta, { label: "Start Face Verification", action: "START_LIVENESS" });
  });

  check("not eligible (registration incomplete) -> IDENTITY_FIRST, no CTA", () => {
    const a = resolveFaceVerificationAction(facts({ eligible: false, hasReference: false }));
    assert.equal(a.status, "IDENTITY_FIRST");
    assert.equal(a.cta, null);
  });

  check("consent withdrawn -> CONSENT_WITHDRAWN (before any gate)", () => {
    const a = resolveFaceVerificationAction(
      facts({ consentWithdrawn: true, faceLayerConfigured: false }),
    );
    assert.equal(a.status, "CONSENT_WITHDRAWN");
  });

  // ---- GOVERNANCE -----------------------------------------------------------
  const ALL: FaceActionFacts[] = [
    facts({ hasReference: false }),
    facts({ photoOutcome: "PROCESSING" }),
    facts({ photoOutcome: "MATCH_FAILED" }),
    facts({ photoOutcome: "NO_FACE" }),
    facts({ photoOutcome: "MULTIPLE_FACES" }),
    facts({ photoOutcome: "MANUAL_REVIEW" }),
    facts(),
    facts({ consentWithdrawn: true }),
    facts({ eligible: false }),
    facts({ faceLayerConfigured: false }),
  ];

  check("no state emits a generic/consequence message ('Verify Photos'/'Verified badge removed')", () => {
    for (const f of ALL) {
      const a = resolveFaceVerificationAction(f);
      const text = `${a.headline} ${a.description} ${a.cta?.label ?? ""}`;
      assert.doesNotMatch(text, /Verify Photos/, a.status);
      assert.doesNotMatch(text, /Verified badge removed/, a.status);
      assert.ok(a.headline.length > 0 && a.description.length > 0);
    }
  });

  check("every CTA performs a REAL action (never a bare/dead label)", () => {
    const REAL = new Set(["START_LIVENESS", "VERIFY_PHOTO", "REPLACE_PHOTO", "RETRY"]);
    for (const f of ALL) {
      const a = resolveFaceVerificationAction(f);
      if (a.cta) assert.ok(REAL.has(a.cta.action), `${a.status} cta.action ${a.cta.action}`);
    }
  });

  check("spinner is visible ONLY while a check is in flight (PROCESSING)", () => {
    for (const f of ALL) {
      const a = resolveFaceVerificationAction(f);
      assert.equal(a.progress.spinner, a.status === "PROCESSING", a.status);
    }
  });

  const read = (p: string) => readFileSync(p, "utf8");
  check("Account and Profile consume the ONE resolver via getFaceVerificationAction", () => {
    const account = read("src/app/(app)/settings/account/page.tsx");
    const profile = read("src/app/(app)/profile/page.tsx");
    assert.match(account, /getFaceVerificationAction\(/, "Account must call the shared resolver");
    assert.match(profile, /getFaceVerificationAction\(/, "Profile must call the shared resolver");
  });

  check("getFaceVerificationAction is the ONLY server entry (single definition)", () => {
    const svc = read("src/lib/services/face-action.ts");
    const defs = (svc.match(/export function getFaceVerificationAction\b/g) ?? []).length;
    assert.equal(defs, 1);
    assert.match(svc, /resolveFaceVerificationAction\(/, "must delegate to the pure resolver");
  });

  check("the shared row mapper no longer emits the banned generic strings (code, not comments)", () => {
    // Strip comment lines/inline comments so we match EXECUTABLE copy only.
    const code = read("src/components/shared/verification-status-row.tsx")
      .split("\n")
      .filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l))
      .map((l) => l.replace(/\/\/.*$/, ""))
      .join("\n");
    assert.doesNotMatch(code, /"Verify Photos"/, "no 'Verify Photos' CTA");
    assert.doesNotMatch(code, /"Verified badge removed"/, "no 'Verified badge removed' label");
  });

  console.log(`\n${passed} checks passed`);
}

main();
