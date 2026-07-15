import { db } from "@/lib/db";
import { Prisma, type User } from "@/generated/prisma/client";
import { PLACEHOLDER_EMAIL_SUFFIX } from "@/lib/auth/gate";
import { isDisposableEmail } from "@/lib/auth/disposable-domains";
import { isAuthUserAlive, isIdentityBlocked, teardownAccount } from "@/lib/auth/identity";
import {
  resendCooldown,
  checkEmailAttachSendIpLimit,
  checkEmailAttachVerifyBlocked,
} from "@/lib/auth/rate-limit";
import { ipHashFrom, recordAuthEvent } from "@/lib/auth/audit";

/**
 * AUTHENTICATED email attach - the mirror of the phone-change flow
 * (phone-flow.ts) for the email channel, and a SEPARATE flow from
 * anonymous email LOGIN (/api/auth/email/*). This one attaches+verifies
 * a real address on the CURRENT session's account (replacing a
 * phone-first account's placeholder email); that one signs users in.
 *
 * MECHANISM - Tirvea OWNS the OTP email end to end so it can never
 * regress to Supabase's default "confirm your new email" LINK template:
 *   send   = admin.generateLink({ type: "email_change_new" }) mints a
 *            6-digit code for the move to the NEW address but sends NO
 *            Supabase email; we then deliver a BRANDED code through
 *            Tirvea's own Resend pipeline (email.ts).
 *   verify = supabase.auth.verifyOtp({ email, token, type: "email_change" })
 *            proves the caller holds the code, then admin.updateUserById
 *            ({ email, email_confirm }) FORCE-COMMITS the address onto
 *            auth.users - independent of dashboard settings, no email.
 * This deliberately keeps Supabase's email TEMPLATES out of the loop for
 * this flow: the previous branded 6-digit experience lived in a Supabase
 * template that silently reverted to the default link, so delivery now
 * runs through the Resend infrastructure the app already owns.
 * Because the commit is an admin write, the flow no longer depends on the
 * "Secure email change" dashboard toggle (which, when ON, would otherwise
 * leave a phone-first account's unroutable placeholder blocking the
 * change); if the commit does not stick we fail closed (not_committed).
 *
 * INVARIANTS (one-email-one-account, no merges, no transfers):
 *  1. Normalize + reject junk (invalid shape, disposable, our own
 *     placeholder/tombstone domains, blocklisted identities) BEFORE any
 *     rate-limit read, provider call or state write.
 *  2. CASE 2 - the address is already verified on THIS account: success
 *     with no OTP. Nobody re-verifies what is already verified.
 *  3. CASE 3 - the address belongs to ANOTHER live app User: explicit
 *     EMAIL_IN_USE rejection, no OTP, no state, owner untouched. This
 *     deliberately differs from the anonymous flows' neutrality: the
 *     caller here is authenticated (they proved a phone), the message
 *     names no account details, and honest recovery copy ("sign in with
 *     Email/Google/Apple instead") beats a dead-end fake send.
 *  4. App User.email is rewritten in exactly one place: the final
 *     verify transaction, together with emailVerified. The transaction
 *     re-checks the holder and the unique index on email settles any
 *     race - the loser gets email_in_use, never a merge.
 */

export const EMAIL_IN_USE_MESSAGE =
  "This email is already associated with another Tirvea account. " +
  "Please sign in using Email, Google or Apple to access that account.";

// ---------------------------------------------------------------------------
// Injectable auth client - the structural subset of supabase.auth the flow
// needs. Routes pass the SSR client's .auth (the session lives in cookies);
// tests inject a spy so no real email and no live GoTrue call ever happens.
// ---------------------------------------------------------------------------

type AuthClientError = { code?: string; message: string; status?: number } | null;

export interface EmailAttachAuthClient {
  /**
   * Mint a 6-digit email_change OTP for the CURRENT auth user's move to
   * `newEmail`, WITHOUT sending any Supabase email (admin.generateLink
   * returns the token; delivery is Tirvea's own, via sendOtpEmail). A null
   * code (with error) signals failure - `error.code === "email_exists"`
   * means a GoTrue-only holder owns the address.
   */
  generateEmailChangeOtp(params: { userId: string; newEmail: string }): Promise<{
    code: string | null;
    error: AuthClientError;
  }>;
  /**
   * Deliver the branded 6-digit code to the new address through Tirvea's
   * OWN email pipeline (Resend) - never Supabase's default template. The
   * code MUST NOT be logged.
   */
  sendOtpEmail(params: { to: string; code: string }): Promise<{ error: AuthClientError }>;
  /** Prove the caller possesses the code (GoTrue verifyOtp, email_change). */
  verifyOtp(params: { email: string; token: string; type: "email_change" }): Promise<{
    data: { user: { id: string; email?: string | null } | null; session: object | null };
    error: AuthClientError;
  }>;
  /**
   * Force-commit the new address onto auth.users (admin updateUserById +
   * email_confirm) - independent of the "Secure email change" setting and
   * emitting no Supabase email. Returns the address auth.users now holds
   * so the caller can confirm the commit stuck before touching the app row.
   */
  commitEmailChange(params: { userId: string; email: string }): Promise<{
    committedEmail: string | null;
    error: AuthClientError;
  }>;
}

// ---------------------------------------------------------------------------
// Shared guards
// ---------------------------------------------------------------------------

/** The session user subset the flow needs (requireSession provides it). */
export type EmailAttachUser = { id: string; bannedAt: Date | null; status: string };

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
/** Our own synthetic domains - never attachable as a "real" address. */
const SYNTHETIC_SUFFIXES = [PLACEHOLDER_EMAIL_SUFFIX, "@tombstone.tirvea.app"];

function normalizeEmail(raw: string): string | null {
  const email = raw.trim().toLowerCase();
  if (!EMAIL_SHAPE.test(email)) return null;
  if (SYNTHETIC_SUFFIXES.some((suffix) => email.endsWith(suffix))) return null;
  return email;
}

/**
 * Resolve who holds this email at the app level. DELETED shells and
 * orphans (auth user gone) are torn down on the spot - exactly the
 * ensureAppUser rules - so a freed address never blocks an attach.
 * Returns the LIVE holder or null.
 */
async function liveEmailHolder(email: string): Promise<User | null> {
  const holder = await db.user.findUnique({ where: { email } });
  if (!holder) return null;
  if (holder.status === "DELETED") {
    await teardownAccount(holder.id, "email freed for attach");
    return null;
  }
  if (!(await isAuthUserAlive(holder.id))) {
    await teardownAccount(holder.id, "orphaned by auth-user deletion");
    return null;
  }
  return holder;
}

// ---------------------------------------------------------------------------
// Send
// ---------------------------------------------------------------------------

export type EmailAttachSendOutcome =
  | { kind: "invalid_email" }
  /** Disposable OR blocklisted - one neutral rejection, the audit knows why. */
  | { kind: "not_allowed" }
  | { kind: "account_blocked" }
  /** CASE 2: this address is already verified on THIS account - no OTP. */
  | { kind: "already_verified"; user: User }
  /** CASE 3: a LIVE other account owns it. `holderId` is diagnostics only, never UI. */
  | { kind: "email_in_use"; holderId: string }
  /** Sent OR rate-limited - deliberately indistinguishable (neutral contract). */
  | { kind: "sent"; retryAfter: number; limited: boolean }
  | { kind: "send_failed" };

export async function sendEmailAttach(opts: {
  user: EmailAttachUser;
  email: string;
  client: EmailAttachAuthClient;
  req?: Request;
}): Promise<EmailAttachSendOutcome> {
  const { user, req } = opts;

  // (1) Normalize FIRST - junk never consumes a rate limit, never reaches
  // GoTrue, never writes state.
  const email = normalizeEmail(opts.email);
  if (!email) return { kind: "invalid_email" };

  // Banned accounts don't get to burn sends.
  if (user.bannedAt || user.status === "SUSPENDED") {
    await recordAuthEvent({
      type: "email_attach_send_blocked",
      email,
      userId: user.id,
      req,
      metadata: { reason: "account_blocked" },
    });
    return { kind: "account_blocked" };
  }

  // Disposable + identity blocklist: ONE neutral rejection so neither
  // list is enumerable; the audit records the real reason.
  if (isDisposableEmail(email)) {
    await recordAuthEvent({
      type: "email_attach_send_blocked",
      email,
      userId: user.id,
      req,
      metadata: { reason: "disposable" },
    });
    return { kind: "not_allowed" };
  }
  if (await isIdentityBlocked(email)) {
    await recordAuthEvent({
      type: "email_attach_send_blocked",
      email,
      userId: user.id,
      req,
      metadata: { reason: "identity_blocked" },
    });
    return { kind: "not_allowed" };
  }

  // (2) OWNERSHIP BEFORE EVERYTHING ELSE.
  // CASE 2 - already verified on THIS account: success, no OTP.
  const self = await db.user.findUnique({ where: { id: user.id } });
  if (self && self.email === email && self.emailVerified) {
    return { kind: "already_verified", user: self };
  }
  // CASE 3 - a live other account owns the address: explicit rejection,
  // no OTP, no state, owner untouched.
  const holder = await liveEmailHolder(email);
  if (holder && holder.id !== user.id) {
    await recordAuthEvent({
      type: "email_attach_conflict",
      email,
      userId: user.id,
      req,
      metadata: { stage: "send", holderId: holder.id },
    });
    return { kind: "email_in_use", holderId: holder.id };
  }

  // (3) Escalating resend cooldown (30s -> 60s -> 120s, max 5/hour per
  // address; 10/hour per IP). Limited sends get the SAME neutral outcome
  // as real ones - retryAfter is all the caller learns either way.
  const cooldown = await resendCooldown("email_attach", email);
  const ipLimit = await checkEmailAttachSendIpLimit(req ? ipHashFrom(req) : null);
  if (!cooldown.allowed || !ipLimit.ok) {
    await recordAuthEvent({
      type: "email_attach_send_limited",
      email,
      userId: user.id,
      req,
      metadata: {
        reason: cooldown.allowed ? (ipLimit.reason ?? "ip_hourly") : "resend_cooldown",
        retryAfter: cooldown.retryAfter,
      },
    });
    return { kind: "sent", retryAfter: cooldown.retryAfter, limited: true };
  }

  // (4) Only now may the provider run. Mint the code via GoTrue WITHOUT
  // triggering a Supabase email (generateLink returns the token), then
  // deliver a BRANDED 6-digit code through Tirvea's own Resend pipeline.
  // This is why the new address gets a code and never Supabase's default
  // "confirm your new email" link - the Supabase template is out of the
  // loop for this flow entirely.
  const gen = await opts.client.generateEmailChangeOtp({ userId: user.id, newEmail: email });
  if (gen.error || !gen.code) {
    // GoTrue-level holder (an auth.users row we have no app row for,
    // e.g. a pending sign-up): same explicit conflict as CASE 3.
    if (gen.error?.code === "email_exists") {
      await recordAuthEvent({
        type: "email_attach_conflict",
        email,
        userId: user.id,
        req,
        metadata: { stage: "send", holderId: "auth_users_only" },
      });
      return { kind: "email_in_use", holderId: "auth_users_only" };
    }
    console.error(
      `[auth:email-attach/send] generateLink failed: ${gen.error?.message ?? "no code returned"}`,
    );
    await recordAuthEvent({
      type: "email_attach_send_error",
      email,
      userId: user.id,
      req,
      metadata: { code: gen.error?.code ?? gen.error?.message ?? "no_code" },
    });
    return { kind: "send_failed" };
  }

  // Deliver via Tirvea's Resend pipeline. NEVER log the code - only the
  // transport error ever surfaces in logs or the audit trail.
  const delivery = await opts.client.sendOtpEmail({ to: email, code: gen.code });
  if (delivery.error) {
    console.error(
      `[auth:email-attach/send] branded OTP email delivery failed: ${delivery.error.message}`,
    );
    await recordAuthEvent({
      type: "email_attach_send_error",
      email,
      userId: user.id,
      req,
      metadata: { code: delivery.error.code ?? "delivery_failed" },
    });
    return { kind: "send_failed" };
  }

  await recordAuthEvent({ type: "email_attach_send", email, userId: user.id, req });
  return { kind: "sent", retryAfter: cooldown.retryAfter, limited: false };
}

// ---------------------------------------------------------------------------
// Verify
// ---------------------------------------------------------------------------

export type EmailAttachVerifyOutcome =
  | { kind: "invalid_email" }
  | { kind: "not_allowed" }
  | { kind: "account_blocked" }
  | { kind: "already_verified"; user: User }
  | { kind: "locked" }
  | { kind: "invalid_code" }
  | { kind: "expired_code" }
  | { kind: "email_in_use"; holderId: string }
  // GoTrue accepted the OTP but did NOT stamp the new address onto
  // auth.users (happens when "Secure email change" is ON - it needs BOTH
  // the old AND new addresses confirmed). We refuse to rewrite the app
  // row before Auth actually holds the address, so the two never drift.
  | { kind: "not_committed" }
  | { kind: "attached"; user: User };

/** Prisma unique-constraint violation (the race loser's signature). */
function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

export async function verifyEmailAttach(opts: {
  user: EmailAttachUser;
  email: string;
  code: string;
  client: EmailAttachAuthClient;
  req?: Request;
}): Promise<EmailAttachVerifyOutcome> {
  const { user, req } = opts;

  // Same normalize + allowlist gate as send (defense in depth - a code
  // for a junk/blocked address can never complete an attach).
  const email = normalizeEmail(opts.email);
  if (!email) return { kind: "invalid_email" };
  if (user.bannedAt || user.status === "SUSPENDED") return { kind: "account_blocked" };
  if (isDisposableEmail(email) || (await isIdentityBlocked(email))) {
    return { kind: "not_allowed" };
  }

  // Idempotent success: this exact address is already verified on THIS
  // account - don't burn a provider check on it.
  const self = await db.user.findUnique({ where: { id: user.id } });
  if (self && self.email === email && self.emailVerified) {
    return { kind: "already_verified", user: self };
  }

  // Ownership BEFORE the provider - an address held by another live
  // account is rejected without consuming the code (owner untouched).
  const holder = await liveEmailHolder(email);
  if (holder && holder.id !== user.id) {
    await recordAuthEvent({
      type: "email_attach_conflict",
      email,
      userId: user.id,
      req,
      metadata: { stage: "verify", holderId: holder.id },
    });
    return { kind: "email_in_use", holderId: holder.id };
  }

  // Failure lock: 5 invalid attempts within 15 minutes (per address or
  // per IP) -> locked for 15 minutes. Audited as its own type so locked
  // requests never extend the lock.
  const blocked = await checkEmailAttachVerifyBlocked({
    email,
    ipHash: req ? ipHashFrom(req) : null,
  });
  if (!blocked.ok) {
    await recordAuthEvent({
      type: "email_attach_verify_locked",
      email,
      userId: user.id,
      req,
      metadata: { reason: blocked.reason ?? "locked" },
    });
    return { kind: "locked" };
  }

  // The email_change confirmation - GoTrue stamps auth.users.email +
  // email_confirmed_at for the CURRENT auth user on success.
  const { data, error } = await opts.client.verifyOtp({
    email,
    token: opts.code,
    type: "email_change",
  });
  if (error || !data.user) {
    await recordAuthEvent({
      type: "email_attach_verify_fail",
      email,
      userId: user.id,
      req,
      metadata: { code: error?.code ?? "no_user" },
    });
    return { kind: error?.code === "otp_expired" ? "expired_code" : "invalid_code" };
  }
  if (data.user.id !== user.id) {
    // Should be impossible for an email_change verify on this session -
    // never adopt a foreign uid's result.
    await recordAuthEvent({
      type: "email_attach_verify_fail",
      email,
      userId: user.id,
      req,
      metadata: { code: "uid_mismatch", authUid: data.user.id },
    });
    return { kind: "invalid_code" };
  }

  // Auth-commit: verifyOtp proved the caller holds the code; now stamp the
  // NEW address onto auth.users via the admin client (email_confirm). This
  // lands the change regardless of the "Secure email change" dashboard
  // setting and sends no Supabase email. The change is only real once
  // auth.users holds the address - never advance the app row before then,
  // and fail closed (not_committed) if the commit does not stick.
  const commit = await opts.client.commitEmailChange({ userId: user.id, email });
  const committedEmail = commit.committedEmail?.trim().toLowerCase() ?? null;
  if (commit.error || committedEmail !== email) {
    await recordAuthEvent({
      type: "email_attach_verify_fail",
      email,
      userId: user.id,
      req,
      metadata: { code: commit.error?.code ?? "auth_email_not_committed" },
    });
    return { kind: "not_committed" };
  }

  // FINAL-SUCCESS TRANSACTION - the single place the attach rewrites
  // User.email, atomically with emailVerified (replacing the placeholder).
  // Re-check the holder inside the transaction; the unique index on email
  // settles any true concurrent race - the loser lands in the P2002
  // branch and gets email_in_use. No merge, no transfer, owner untouched.
  const now = new Date();
  let updated: User | null;
  try {
    updated = await db.$transaction(async (tx) => {
      const rival = await tx.user.findUnique({ where: { email } });
      if (rival && rival.id !== user.id) return null;
      return tx.user.update({
        where: { id: user.id },
        data: { email, emailVerified: now },
      });
    });
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    updated = null;
  }
  if (!updated) {
    await recordAuthEvent({
      type: "email_attach_conflict",
      email,
      userId: user.id,
      req,
      metadata: { stage: "verify_commit" },
    });
    // Race loser - refetch the winner purely for the diagnostic outcome.
    const winner = await db.user.findUnique({ where: { email }, select: { id: true } });
    return { kind: "email_in_use", holderId: winner?.id ?? "unknown" };
  }

  await recordAuthEvent({ type: "email_attach_verified", email, userId: user.id, req });
  return { kind: "attached", user: updated };
}
