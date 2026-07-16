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

/**
 * Canonical landing spot for restricted (suspended/banned) accounts.
 * Phase-2 status/appeal pages under /account/status* should pass
 * requireUser({ allow: RESTRICTED_ACCOUNT_ROUTE }) so the gate lets them
 * render for restricted sessions.
 */
export const RESTRICTED_ACCOUNT_ROUTE = "/account-blocked";

export function authNextStep(
  user: GateUser,
  phoneEnabled: boolean = isPhoneVerificationEnabled(),
): string {
  // Suspended/banned: the ONLY destination is the status area. Sessions for
  // these accounts survive (see auth()) so the user can read their status
  // and appeal; every API rejects them centrally (requireSession).
  if (user.bannedAt || user.status === "SUSPENDED" || user.status === "BANNED") {
    return RESTRICTED_ACCOUNT_ROUTE;
  }
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

/**
 * What the /login front door should show. This is the ONE place that maps
 * an (optional) session to a login view, keeping AUTHENTICATION state and
 * navigation INTENT separate: an explicit /login visit is a deliberate act,
 * so an authenticated-but-incompletely-onboarded account is offered a
 * RECOVERY screen (continue setup / use another account / sign out) instead
 * of being silently forced back into the setup ladder. Only a restricted
 * (suspended/banned) account is redirected - to its status area. Everyone
 * else (unauthenticated, or a fresh account still owing its FIRST verified
 * channel, where the gate answers "/login") gets the method chooser.
 *
 * Setup enforcement on PROTECTED app routes is unchanged and still lives in
 * requireUser()/authNextStep - this function governs ONLY the /login route,
 * which is never a protected route.
 */
export type LoginView =
  | { kind: "chooser" }
  | { kind: "recovery"; next: string; setupComplete: boolean }
  | { kind: "redirect"; to: string };

export function resolveLoginView(session: { user: GateUser } | null): LoginView {
  if (!session) return { kind: "chooser" };
  const next = authNextStep(session.user);
  // Restricted accounts have exactly one place to be.
  if (next === RESTRICTED_ACCOUNT_ROUTE) return { kind: "redirect", to: next };
  // A fresh account still owing its first channel belongs on the chooser
  // (the gate itself answers "/login"); rendering it here never loops.
  if (next === "/login") return { kind: "chooser" };
  // Authenticated + more setup owed OR fully complete: a recovery screen,
  // never a silent bounce. `setupComplete` picks the primary CTA copy.
  return { kind: "recovery", next, setupComplete: next === "/discover" };
}
