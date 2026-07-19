/**
 * L7.3.8 - registration state machine (unit, no DB). Proves the ONE canonical
 * resolver: an account is ACTIVE only when the whole ladder completes, states
 * never skip, and progress (next/percent/remaining) is consistent with routing.
 *
 *   npx tsx tests/registration-state-machine.test.ts
 */
import assert from "node:assert/strict";
import {
  resolveRegistrationState,
  registrationComplete,
  registrationProgress,
  authNextStep,
  type GateUser,
} from "@/lib/auth/gate";
import { CURRENT_VERSIONS as V } from "@/lib/auth/consent";

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ok - ${name}`);
}

/** A fully-complete user; override fields to walk back up the ladder. */
function mk(o: Partial<GateUser> = {}): GateUser {
  return {
    status: "ACTIVE",
    bannedAt: null,
    email: "a@b.com",
    emailVerified: new Date(),
    phoneVerifiedAt: new Date(),
    ageConfirmedAt: new Date(),
    termsVersion: V.terms,
    privacyVersion: V.privacy,
    communityVersion: V.community,
    onboardingDone: true,
    ...o,
  };
}
const ON = true; // phone verification enabled

function main() {
  // Complete registration -> ACTIVE, 100%, nothing remaining.
  check("complete registration resolves ACTIVE and registrationComplete", () => {
    const u = mk();
    assert.equal(resolveRegistrationState(u, ON), "ACTIVE");
    assert.equal(registrationComplete(u, ON), true);
    const p = registrationProgress(u, ON);
    assert.equal(p.completed, true);
    assert.equal(p.percentComplete, 100);
    assert.deepEqual(p.remaining, []);
    assert.equal(p.next, "/discover");
  });

  // A PENDING account that has finished every rung still resolves ACTIVE
  // (state is derived from the ladder; the persisted status is orthogonal).
  check("finished ladder resolves ACTIVE even while status still PENDING", () => {
    assert.equal(resolveRegistrationState(mk({ status: "PENDING" }), ON), "ACTIVE");
    assert.equal(registrationComplete(mk({ status: "PENDING" }), ON), true);
  });

  // No retro-lock (L7.3.8 / Phase G): a grandfathered account with the
  // persisted stamp stays ACTIVE + complete even if a NEWER rung (phone) is
  // now owed by the live ladder - existing users never lose access.
  check("stamped account is never retro-locked by a newer ladder rung", () => {
    const grandfathered = mk({ phoneVerifiedAt: null, registrationCompletedAt: new Date() });
    assert.equal(resolveRegistrationState(grandfathered, ON), "ACTIVE");
    assert.equal(registrationComplete(grandfathered, ON), true);
    // but a stamped account that is later SUSPENDED is BLOCKED, not ACTIVE.
    assert.equal(
      resolveRegistrationState(mk({ status: "SUSPENDED", registrationCompletedAt: new Date() }), ON),
      "BLOCKED",
    );
  });

  // Email not verified (no channel) -> EMAIL_PENDING, incomplete.
  check("email verified only-missing -> EMAIL_PENDING (never ACTIVE)", () => {
    const u = mk({ emailVerified: null, phoneVerifiedAt: null });
    assert.equal(resolveRegistrationState(u, ON), "EMAIL_PENDING");
    assert.equal(registrationComplete(u, ON), false);
    assert.equal(authNextStep(u, ON), "/login");
  });

  // Phone-first placeholder email owes a real email -> EMAIL_PENDING.
  check("phone-first placeholder email -> EMAIL_PENDING", () => {
    const u = mk({ email: "phone+x@placeholder.tirvea.app", emailVerified: null });
    assert.equal(resolveRegistrationState(u, ON), "EMAIL_PENDING");
    assert.equal(authNextStep(u, ON), "/auth/email");
  });

  // Email done, phone owed -> PHONE_PENDING.
  check("phone verified only-missing -> PHONE_PENDING", () => {
    const u = mk({ phoneVerifiedAt: null });
    assert.equal(resolveRegistrationState(u, ON), "PHONE_PENDING");
    assert.equal(registrationComplete(u, ON), false);
    assert.equal(authNextStep(u, ON), "/auth/phone");
  });

  // Age unconfirmed -> LEGAL_PENDING.
  check("age unconfirmed -> LEGAL_PENDING", () => {
    const u = mk({ ageConfirmedAt: null });
    assert.equal(resolveRegistrationState(u, ON), "LEGAL_PENDING");
    assert.equal(authNextStep(u, ON), "/auth/age");
  });

  // Terms/consent missing -> LEGAL_PENDING (never ACTIVE).
  check("terms missing -> LEGAL_PENDING (never ACTIVE)", () => {
    const u = mk({ termsVersion: null });
    assert.equal(resolveRegistrationState(u, ON), "LEGAL_PENDING");
    assert.equal(registrationComplete(u, ON), false);
    assert.equal(authNextStep(u, ON), "/auth/legal");
  });

  // Onboarding incomplete -> ONBOARDING_PENDING (never ACTIVE).
  check("onboarding incomplete -> ONBOARDING_PENDING (never ACTIVE)", () => {
    const u = mk({ onboardingDone: false });
    assert.equal(resolveRegistrationState(u, ON), "ONBOARDING_PENDING");
    assert.equal(registrationComplete(u, ON), false);
    assert.equal(authNextStep(u, ON), "/onboarding");
  });

  // Restricted/cancelled overlays.
  check("suspended/banned -> BLOCKED; deleted/deactivated -> CANCELLED", () => {
    assert.equal(resolveRegistrationState(mk({ status: "SUSPENDED" }), ON), "BLOCKED");
    assert.equal(resolveRegistrationState(mk({ bannedAt: new Date() }), ON), "BLOCKED");
    assert.equal(resolveRegistrationState(mk({ status: "DELETED" }), ON), "CANCELLED");
    assert.equal(resolveRegistrationState(mk({ status: "DEACTIVATED" }), ON), "CANCELLED");
  });

  // NO SKIPPED TRANSITIONS: an account missing several rungs resolves to the
  // EARLIEST owed rung, not a later one.
  check("no skipped transitions - earliest owed rung wins", () => {
    const missingPhoneAndOnboarding = mk({ phoneVerifiedAt: null, onboardingDone: false });
    assert.equal(resolveRegistrationState(missingPhoneAndOnboarding, ON), "PHONE_PENDING");
    const missingAgeAndOnboarding = mk({ ageConfirmedAt: null, onboardingDone: false });
    assert.equal(resolveRegistrationState(missingAgeAndOnboarding, ON), "LEGAL_PENDING");
  });

  // Progress reflects how many rungs are owed, and lists the remaining keys.
  check("progress percent reflects rungs owed; remaining lists owed rungs", () => {
    const none = registrationProgress(
      mk({
        emailVerified: null,
        phoneVerifiedAt: null,
        ageConfirmedAt: null,
        termsVersion: null,
        onboardingDone: false,
      }),
      ON,
    );
    const oneOwed = registrationProgress(mk({ onboardingDone: false }), ON);
    const complete = registrationProgress(mk(), ON);
    assert.equal(none.percentComplete, 0, "nothing done -> 0%");
    assert.ok(none.percentComplete < oneOwed.percentComplete, "more owed -> lower percent");
    assert.ok(oneOwed.percentComplete < complete.percentComplete, "one owed -> below complete");
    assert.equal(complete.percentComplete, 100);
    assert.ok(oneOwed.remaining.includes("onboarding_completed"));
    assert.ok(
      registrationProgress(mk({ ageConfirmedAt: null }), ON).remaining.includes("age_confirmed"),
    );
    // Blocked/cancelled report 0% and no remaining actions.
    const blocked = registrationProgress(mk({ status: "SUSPENDED" }), ON);
    assert.equal(blocked.percentComplete, 0);
    assert.deepEqual(blocked.remaining, []);
  });

  // When phone verification is DISABLED, the phone rung drops out entirely
  // (never demands a channel the product cannot verify).
  check("phone-disabled: phone rung omitted from ladder and progress", () => {
    const u = mk({ phoneVerifiedAt: null });
    assert.equal(resolveRegistrationState(u, false), "ACTIVE");
    assert.equal(registrationComplete(u, false), true);
    assert.ok(!registrationProgress(u, false).remaining.includes("phone_verified"));
  });

  console.log(`\n${passed} checks passed`);
}

main();
