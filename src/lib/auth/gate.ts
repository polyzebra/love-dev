import { needsAgeConfirmation, needsConsent } from "@/lib/auth/consent";
import { phoneVerificationEnabled } from "@/lib/auth/phone";

/**
 * The auth progression gate - ONE pure function deciding where a user
 * belongs next. Every guard (requireUser, OTP verify responses, login
 * redirects) asks this instead of re-implementing the ladder.
 *
 * Ladder: blocked -> first channel -> phone -> email attach -> 18+
 * confirmation -> legal consent -> onboarding -> app.
 *
 * MILESTONE INVARIANT: every COMPLETED account holds BOTH a verified
 * phone (when the feature is launched) AND a verified email. Nobody
 * re-verifies a channel that is already verified, and accounts are
 * never merged or transferred to satisfy a rung.
 *
 * Phone-unavailable semantics (two DIFFERENT states, do not merge):
 *  - No SMS provider configured (no TWILIO_* envs, SUPABASE_PHONE_ENABLED
 *    off): the feature is NOT LAUNCHED. The gate hides the step entirely
 *    (phoneEnabled=false skips /auth/phone) - we never demand a phone
 *    number the product cannot verify yet.
 *  - A provider IS configured but errors at
 *    runtime: the step is REQUIRED and NOT skippable. The gate still
 *    routes to /auth/phone; the page shows "Phone verification is
 *    temporarily unavailable." and blocks (no continue path) until the
 *    provider recovers. Outages must never become a verification
 *    bypass.
 */

export type GateUser = {
  status: string;
  bannedAt: Date | null;
  /** Always set on the app row - phone-first accounts carry a placeholder until they attach one. */
  email: string;
  emailVerified: Date | null;
  phoneVerifiedAt: Date | null;
  ageConfirmedAt: Date | null;
  termsVersion: string | null;
  privacyVersion: string | null;
  communityVersion: string | null;
  onboardingDone: boolean;
};

/**
 * Phone verification is only enforceable when an SMS provider is wired up.
 * Thin alias of phone.ts's phoneVerificationEnabled() (Twilio Verify OR
 * Supabase phone) kept for the gate's callers.
 */
export function isPhoneVerificationEnabled(): boolean {
  return phoneVerificationEnabled();
}

/** Domain of the synthetic email a phone-LOGIN account is born with. */
export const PLACEHOLDER_EMAIL_SUFFIX = "@placeholder.tirvea.app";

/**
 * Does this account still owe a REAL, verified email address? True for a
 * phone-first account living on its placeholder email AND for any account
 * whose email was never verified (e.g. admin-released). Email-first and
 * OAuth users verified their address at sign-in, so the rung is invisible
 * to them - nobody re-verifies what is already verified.
 */
export function needsEmailAttach(user: Pick<GateUser, "email" | "emailVerified">): boolean {
  return user.email.endsWith(PLACEHOLDER_EMAIL_SUFFIX) || !user.emailVerified;
}

export function authNextStep(
  user: GateUser,
  phoneEnabled: boolean = isPhoneVerificationEnabled(),
): string {
  if (user.bannedAt || user.status === "SUSPENDED") return "/account-blocked";
  // First rung = ONE verified sign-in channel. Email/OAuth identities
  // verify email here as always (the /login entry leads into
  // /login/email); a phone-LOGIN account (verified phone, placeholder
  // email) already proved its channel and must not be sent to email
  // capture. No existing account weakens: the legacy funnel never
  // stamps phoneVerifiedAt before emailVerified.
  if (!user.emailVerified && !user.phoneVerifiedAt) return "/login";
  if (phoneEnabled && !user.phoneVerifiedAt) return "/auth/phone";
  // Second channel = a REAL verified email on every account. Phone-first
  // accounts (placeholder email) attach one right after their phone rung;
  // email-first users already verified theirs, so this rung never shows.
  if (needsEmailAttach(user)) return "/auth/email";
  if (needsAgeConfirmation(user)) return "/auth/age";
  if (needsConsent(user)) return "/auth/legal";
  if (!user.onboardingDone) return "/onboarding";
  return "/discover";
}
