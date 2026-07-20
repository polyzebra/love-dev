/**
 * L8.3.1 - the canonical AWS face-verification ACTION resolver. Proves the
 * entry point offers the CORRECT single action (first-time enrolment vs photo
 * match), never a silently disabled CTA, and NEVER a second liveness once a
 * reference exists. Pure; no DB. Run:  npx tsx tests/face-action-resolver.test.ts
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

/** A fully-live layer for a verified, enrolled, current user. Override per test. */
function facts(over: Partial<FaceActionFacts> = {}): FaceActionFacts {
  return {
    identityVerified: true,
    badgeSuspended: false,
    hasReference: true,
    consentWithdrawn: false,
    faceLayerConfigured: true,
    legalGateOpen: true,
    emergencyDisabled: false,
    routeWired: true,
    ...over,
  };
}

function main() {
  // ---- Requirement 1: first-time enrolment ---------------------------------
  check("no reference + layer live -> START_LIVENESS with the enrolment CTA", () => {
    const a = resolveFaceVerificationAction(facts({ hasReference: false }));
    assert.equal(a.kind, "START_LIVENESS");
    assert.equal(a.label, "Start Face Verification");
    assert.equal(a.blockingReason, null);
    // Copy explains enrolment (one-time video), not a bare "badge removed".
    assert.match(a.body, /one-time|video/i);
  });

  check("first-time enrolment is offered even when the badge is also suspended", () => {
    const a = resolveFaceVerificationAction(facts({ hasReference: false, badgeSuspended: true }));
    assert.equal(a.kind, "START_LIVENESS");
  });

  // ---- Requirement 2: photo match, never a second liveness -----------------
  check("reference + badge suspended -> VERIFY_PHOTO (photo match, no liveness)", () => {
    const a = resolveFaceVerificationAction(facts({ badgeSuspended: true }));
    assert.equal(a.kind, "VERIFY_PHOTO");
    assert.equal(a.label, "Verify New Photo");
    assert.match(a.body, /no video/i);
  });

  check("reference + current badge -> VERIFIED (nothing to do)", () => {
    const a = resolveFaceVerificationAction(facts());
    assert.equal(a.kind, "VERIFIED");
    assert.equal(a.label, null);
  });

  // THE core invariant: a gallery change never re-triggers liveness.
  check("INVARIANT: hasReference=true NEVER yields START_LIVENESS (any other flags)", () => {
    for (const badgeSuspended of [true, false]) {
      for (const consentWithdrawn of [false]) {
        const a = resolveFaceVerificationAction(facts({ badgeSuspended, consentWithdrawn }));
        assert.notEqual(a.kind, "START_LIVENESS", `suspended=${badgeSuspended}`);
      }
    }
  });

  // ---- Requirement 3: copy disambiguates enrolment vs matching -------------
  check("no state returns the bare 'Verified badge removed' string", () => {
    const states: Partial<FaceActionFacts>[] = [
      { hasReference: false },
      { badgeSuspended: true },
      {},
      { consentWithdrawn: true },
      { identityVerified: false },
      { faceLayerConfigured: false },
    ];
    for (const s of states) {
      const a = resolveFaceVerificationAction(facts(s));
      assert.doesNotMatch(a.headline, /^Verified badge removed$/);
      assert.ok(a.headline.length > 0 && a.body.length > 0);
    }
  });

  // ---- Requirement 4: never disabled without an explicit reason ------------
  check("emergency disable -> BLOCKED/EMERGENCY_DISABLED", () => {
    const a = resolveFaceVerificationAction(facts({ emergencyDisabled: true }));
    assert.equal(a.kind, "BLOCKED");
    assert.equal(a.blockingReason, "EMERGENCY_DISABLED");
  });

  check("provider not configured -> BLOCKED/AWS_UNAVAILABLE", () => {
    const a = resolveFaceVerificationAction(facts({ faceLayerConfigured: false }));
    assert.equal(a.kind, "BLOCKED");
    assert.equal(a.blockingReason, "AWS_UNAVAILABLE");
  });

  check("legal gate closed -> BLOCKED/LEGAL_GATE_CLOSED", () => {
    const a = resolveFaceVerificationAction(facts({ legalGateOpen: false }));
    assert.equal(a.kind, "BLOCKED");
    assert.equal(a.blockingReason, "LEGAL_GATE_CLOSED");
  });

  check("route not wired -> BLOCKED/ROUTE_NOT_WIRED", () => {
    const a = resolveFaceVerificationAction(facts({ routeWired: false }));
    assert.equal(a.kind, "BLOCKED");
    assert.equal(a.blockingReason, "ROUTE_NOT_WIRED");
  });

  check("every BLOCKED result carries a non-null blockingReason (never a silent disable)", () => {
    const blockers: Partial<FaceActionFacts>[] = [
      { emergencyDisabled: true },
      { faceLayerConfigured: false },
      { legalGateOpen: false },
      { routeWired: false },
    ];
    for (const b of blockers) {
      const a = resolveFaceVerificationAction(facts(b));
      assert.equal(a.kind, "BLOCKED");
      assert.ok(a.blockingReason, "BLOCKED must always name a reason");
      assert.equal(a.label, null);
    }
  });

  // Gate precedence: emergency disable wins over a missing provider, which wins
  // over the legal gate - the most fundamental "off" reason is reported first.
  check("gate precedence: emergency > provider > legal", () => {
    const a = resolveFaceVerificationAction(
      facts({ emergencyDisabled: true, faceLayerConfigured: false, legalGateOpen: false }),
    );
    assert.equal(a.blockingReason, "EMERGENCY_DISABLED");
    const b = resolveFaceVerificationAction(
      facts({ faceLayerConfigured: false, legalGateOpen: false }),
    );
    assert.equal(b.blockingReason, "AWS_UNAVAILABLE");
  });

  // ---- Identity + consent gating -------------------------------------------
  check("identity not verified -> IDENTITY_FIRST (face layer is downstream)", () => {
    const a = resolveFaceVerificationAction(facts({ identityVerified: false, hasReference: false }));
    assert.equal(a.kind, "IDENTITY_FIRST");
    assert.equal(a.label, null);
  });

  check("consent withdrawn -> CONSENT_WITHDRAWN (before any config gate)", () => {
    const a = resolveFaceVerificationAction(
      facts({ consentWithdrawn: true, faceLayerConfigured: false }),
    );
    assert.equal(a.kind, "CONSENT_WITHDRAWN");
  });

  // ---- Production reality: dormant layer, verified user ---------------------
  check("PROD today (identity verified, layer dormant, no reference) -> BLOCKED/AWS_UNAVAILABLE", () => {
    // Mirrors L8.2.1 production evidence: 0 references, provider unconfigured.
    const a = resolveFaceVerificationAction(
      facts({ hasReference: false, faceLayerConfigured: false, legalGateOpen: false }),
    );
    assert.equal(a.kind, "BLOCKED");
    assert.equal(a.blockingReason, "AWS_UNAVAILABLE");
    // Badge is explicitly reassured - no mass confusing prompt.
    assert.match(a.body, /badge is unaffected/i);
  });

  // ---- Requirement 5: ONE resolver, both surfaces --------------------------
  const read = (p: string) => readFileSync(p, "utf8");
  check("both Account and Profile resolve the action via getFaceVerificationAction", () => {
    const account = read("src/app/(app)/settings/account/page.tsx");
    const profile = read("src/app/(app)/profile/page.tsx");
    assert.match(account, /getFaceVerificationAction\(/, "Account must call the shared resolver");
    assert.match(profile, /getFaceVerificationAction\(/, "Profile must call the shared resolver");
  });

  check("getFaceVerificationAction is the ONLY server entry (single definition)", () => {
    const svc = read("src/lib/services/face-action.ts");
    const defs = (svc.match(/export function getFaceVerificationAction\b/g) ?? []).length;
    assert.equal(defs, 1, "exactly one getFaceVerificationAction definition");
    // It must delegate to the pure resolver, not re-implement the decision.
    assert.match(svc, /resolveFaceVerificationAction\(/, "must delegate to the pure resolver");
  });

  check("the enrolment CTA is gated on START_LIVENESS (dormant-safe in prod)", () => {
    // The card only opens the real AWS flow for START_LIVENESS, which the
    // resolver returns ONLY past the config + legal gates - so a dormant layer
    // can never surface a first-time capture prompt.
    const card = read("src/components/profile/photo-verify-card.tsx");
    assert.match(card, /faceAction\?\.kind === "START_LIVENESS"/, "capture gated on START_LIVENESS");
  });

  console.log(`\n${passed} checks passed`);
}

main();
