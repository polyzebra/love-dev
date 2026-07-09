/**
 * The auth progression gate - ONE pure function deciding where a user
 * belongs next. Every guard (requireUser, OTP verify responses, login
 * redirects) asks this instead of re-implementing the ladder.
 *
 * Ladder: blocked -> email -> phone (only when an SMS provider exists;
 * we never demand a phone number we cannot verify) -> onboarding -> app.
 */

export type GateUser = {
  status: string;
  bannedAt: Date | null;
  emailVerified: Date | null;
  phoneVerifiedAt: Date | null;
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
  if (!user.onboardingDone) return "/onboarding";
  return "/discover";
}
