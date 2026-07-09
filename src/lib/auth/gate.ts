import { needsAgeConfirmation, needsConsent } from "@/lib/auth/consent";

/**
 * The auth progression gate - ONE pure function deciding where a user
 * belongs next. Every guard (requireUser, OTP verify responses, login
 * redirects) asks this instead of re-implementing the ladder.
 *
 * Ladder: blocked -> email -> phone -> 18+ confirmation -> legal
 * consent -> onboarding -> app.
 *
 * Phone-unavailable semantics (two DIFFERENT states, do not merge):
 *  - SUPABASE_PHONE_ENABLED off: the feature is NOT LAUNCHED. The gate
 *    hides the step entirely (phoneEnabled=false skips /auth/phone) -
 *    we never demand a phone number the product cannot verify yet.
 *  - SUPABASE_PHONE_ENABLED === "true" but the provider errors at
 *    runtime: the step is REQUIRED and NOT skippable. The gate still
 *    routes to /auth/phone; the page shows "Phone verification is
 *    temporarily unavailable." and blocks (no continue path) until the
 *    provider recovers. Outages must never become a verification
 *    bypass.
 */

export type GateUser = {
  status: string;
  bannedAt: Date | null;
  emailVerified: Date | null;
  phoneVerifiedAt: Date | null;
  ageConfirmedAt: Date | null;
  termsVersion: string | null;
  privacyVersion: string | null;
  communityVersion: string | null;
  onboardingDone: boolean;
};

/** Phone verification is only enforceable when an SMS provider is wired up. */
export function isPhoneVerificationEnabled(): boolean {
  return process.env.SUPABASE_PHONE_ENABLED === "true";
}

export function authNextStep(
  user: GateUser,
  phoneEnabled: boolean = isPhoneVerificationEnabled(),
): string {
  if (user.bannedAt || user.status === "SUSPENDED") return "/account-blocked";
  if (!user.emailVerified) return "/auth";
  if (phoneEnabled && !user.phoneVerifiedAt) return "/auth/phone";
  if (needsAgeConfirmation(user)) return "/auth/age";
  if (needsConsent(user)) return "/auth/legal";
  if (!user.onboardingDone) return "/onboarding";
  return "/discover";
}
