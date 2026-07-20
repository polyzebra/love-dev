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
  /**
   * The persisted "registration activated" signal (L7.3.8). Once stamped it is
   * authoritative for ACCESS: a completed account keeps access even if a NEW
   * rung is later added to the ladder (existing users are never retro-locked).
   * Optional so legacy callers that don't select it still type-check.
   */
  registrationCompletedAt?: Date | null;
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

// ---------------------------------------------------------------------------
// Registration state machine (L7.3.8). ONE canonical resolver: the persisted
// account is ACTIVE only once the WHOLE registration ladder completes. State
// and progress are DERIVED from authNextStep above, so routing and state can
// never disagree - there is exactly one ladder. `registrationCompletedAt` is
// the explicit, persisted completion signal (stamped by the single activator
// in identity.ts); completion is never inferred loosely.
// ---------------------------------------------------------------------------

export type RegistrationState =
  | "EMAIL_PENDING" // owes a first verified channel OR a real verified email
  | "PHONE_PENDING" // email done, phone verification owed
  | "LEGAL_PENDING" // age confirmation and/or legal consent owed
  | "ONBOARDING_PENDING" // profile onboarding owed
  | "ACTIVE" // registration fully complete
  | "CANCELLED" // deactivated / deleted registration
  | "BLOCKED"; // suspended / banned

/**
 * Is registration fully complete? The single predicate every access gate
 * asks (requireActiveAccount). Equivalent to "the ladder has nothing left":
 * authNextStep answers /discover.
 */
export function registrationComplete(
  user: GateUser,
  phoneEnabled: boolean = isPhoneVerificationEnabled(),
): boolean {
  // Persisted stamp is authoritative (never retro-lock a completed account);
  // otherwise the live ladder decides (belt-and-braces / self-heal).
  return !!user.registrationCompletedAt || registrationLadderComplete(user, phoneEnabled);
}

/**
 * The FIELD-derived completion predicate: the ladder has nothing left to do.
 * This is what the activator uses to DECIDE whether to stamp
 * registrationCompletedAt (it must not depend on the stamp it is about to set).
 */
export function registrationLadderComplete(
  user: GateUser,
  phoneEnabled: boolean = isPhoneVerificationEnabled(),
): boolean {
  return authNextStep(user, phoneEnabled) === "/discover";
}

/** Canonical registration state, derived from the one ladder (authNextStep). */
export function resolveRegistrationState(
  user: GateUser,
  phoneEnabled: boolean = isPhoneVerificationEnabled(),
): RegistrationState {
  if (user.status === "DELETED" || user.status === "DEACTIVATED") return "CANCELLED";
  if (user.bannedAt || user.status === "SUSPENDED" || user.status === "BANNED") return "BLOCKED";
  // A stamped account is ACTIVE for state purposes even if a newer rung exists.
  if (user.registrationCompletedAt) return "ACTIVE";
  switch (authNextStep(user, phoneEnabled)) {
    case RESTRICTED_ACCOUNT_ROUTE:
      return "BLOCKED";
    case "/login":
    case "/auth/email":
      return "EMAIL_PENDING";
    case "/auth/phone":
      return "PHONE_PENDING";
    case "/auth/age":
    case "/auth/legal":
      return "LEGAL_PENDING";
    case "/onboarding":
      return "ONBOARDING_PENDING";
    case "/discover":
      return "ACTIVE";
    default:
      return "EMAIL_PENDING";
  }
}

export type RegistrationProgress = {
  state: RegistrationState;
  /** Route of the next required step (or "/discover" when complete). */
  next: string;
  completed: boolean;
  /** 0-100 across the applicable rungs (phone counts only when enabled). */
  percentComplete: number;
  /** Machine-readable keys of the rungs still owed (empty when complete/blocked). */
  remaining: string[];
};

/**
 * The API-contract view of a registration: current state, next step,
 * completion %, and remaining required actions. Rungs mirror authNextStep's
 * order exactly; phone is applicable only when the SMS provider is wired.
 */
export function registrationProgress(
  user: GateUser,
  phoneEnabled: boolean = isPhoneVerificationEnabled(),
): RegistrationProgress {
  const rungs = [
    { key: "email_verified", applies: true, done: !needsEmailAttach(user) },
    { key: "phone_verified", applies: phoneEnabled, done: !!user.phoneVerifiedAt },
    { key: "age_confirmed", applies: true, done: !needsAgeConfirmation(user) },
    { key: "legal_accepted", applies: true, done: !needsConsent(user) },
    { key: "onboarding_completed", applies: true, done: user.onboardingDone },
  ].filter((r) => r.applies);

  const state = resolveRegistrationState(user, phoneEnabled);
  const inactive = state === "BLOCKED" || state === "CANCELLED";
  const doneCount = rungs.filter((r) => r.done).length;
  return {
    state,
    next: authNextStep(user, phoneEnabled),
    completed: state === "ACTIVE",
    percentComplete: inactive ? 0 : Math.round((doneCount / rungs.length) * 100),
    remaining: inactive ? [] : rungs.filter((r) => !r.done).map((r) => r.key),
  };
}
