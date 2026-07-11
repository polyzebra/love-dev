// The "core" build with explicit metadata: the package's bundled builds
// (min/max) resolve their metadata through an ESM/CJS interop shim that
// breaks under tsx (tests) while working under Next - core + an explicit
// JSON import behaves identically everywhere.
import {
  parsePhoneNumberFromString,
  type CountryCode,
  type MetadataJson,
} from "libphonenumber-js/core";
import metadataJson from "libphonenumber-js/metadata.min.json";

const phoneMetadata = metadataJson as unknown as MetadataJson;
import { db } from "@/lib/db";
import { Prisma, type User } from "@/generated/prisma/client";
import {
  phoneVerificationProvider,
  PhoneOtpNotConfiguredError,
  PhoneProviderRejectedError,
  type PhoneVerificationProvider,
} from "@/lib/auth/phone";
import { resendCooldown, checkOtpVerifyBlocked } from "@/lib/auth/rate-limit";
import { getSupportedPhoneCountrySet } from "@/lib/auth/phone-countries";
import { ipHashFrom, recordAuthEvent } from "@/lib/auth/audit";
import { isReleasablePhoneHolder, teardownAccount } from "@/lib/auth/identity";
import { isCredentialBanned } from "@/lib/services/trust-safety";

/**
 * The phone-verification flow itself, lifted out of the API routes so the
 * ordering guarantees live in ONE place and are directly testable with an
 * injected provider (no Twilio, no HTTP).
 *
 * INVARIANTS (the one-phone-one-account defense):
 *  1. Normalize to E.164 FIRST. Invalid or region-less input is rejected
 *     before any rate-limit read, any audit write, any provider call.
 *  2. The ownership check runs BEFORE the provider and BEFORE rate-limit
 *     consumption. A number held by ANOTHER LIVE account never reaches
 *     the provider, never mutates auth.users, never creates pending
 *     state - the only trace of the attempt is one audit event. A DEAD
 *     holder (DELETED shell, or an app row whose auth.users identity was
 *     dashboard-deleted) is auto-released first - audited teardown, the
 *     phone twin of ensureAppUser's email-orphan takeover.
 *  3. `User.phoneE164` is written in exactly one place: the final-success
 *     transaction below, together with `phoneVerifiedAt`. Nothing writes
 *     it pre-verification (verified across the codebase - the only other
 *     writers are teardown/releasePhone/releaseDeletedUserPhone, which
 *     NULL it). That makes the
 *     plain @unique on phoneE164 equivalent to a partial
 *     "unique-when-verified" index, so the schema stays untouched.
 *  4. The final transaction re-checks the holder and relies on the unique
 *     index for the race: of two concurrent verifies for the same number,
 *     exactly one commits - the loser gets `duplicate_phone`.
 *  5. auth.users.phone is a maintained MIRROR of the app claim, written by
 *     the service-role admin client AFTER the app transaction commits. The
 *     app row carries a durable disposition (phoneSyncStatus PENDING ->
 *     SYNCED/FAILED + phoneSyncErrorCode): a failed or impossible sync
 *     (service key absent) never rolls back the Twilio-approved business
 *     verification - phoneVerifiedAt stays set, the FAILED state drives
 *     reconciliation (src/lib/services/phone-reconcile.ts) and admin
 *     re-sync. `authCompleted` is only finalized together with SYNCED.
 */

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

export type NormalizedPhone =
  | { ok: true; phoneE164: string; countryIso: string; dialCode: string }
  | { ok: false; reason: "invalid_phone" | "unsupported_country" };

/**
 * Canonical E.164 or a rejection - the single parse used by both send and
 * verify. `defaultCountry` is the UI's selected region (e.g. "IE"), which
 * lets national input ("0868672333") and bare country-code input
 * ("353868672333") normalize to the same +353868672333. A number whose
 * region libphonenumber cannot resolve is rejected as unsupported BEFORE
 * any provider sees it.
 */
export function normalizePhone(raw: string, defaultCountry?: string): NormalizedPhone {
  const phone = defaultCountry
    ? parsePhoneNumberFromString(raw, defaultCountry as CountryCode, phoneMetadata)
    : parsePhoneNumberFromString(raw, phoneMetadata);
  if (!phone || !phone.isValid()) return { ok: false, reason: "invalid_phone" };
  if (!phone.country) return { ok: false, reason: "unsupported_country" };
  return {
    ok: true,
    phoneE164: phone.number,
    countryIso: phone.country,
    dialCode: `+${phone.countryCallingCode}`,
  };
}

/**
 * Normalize + enforce THIS flow's supported-country list
 * (getSupportedPhoneCountries("change") - the /auth/phone onboarding
 * verification and the settings-driven change share this one flow, see
 * phone-countries.ts for the mapping). Used by BOTH send and verify, so
 * a number outside the supported list is rejected as unsupported_country
 * BEFORE any rate-limit read, DB lookup or provider call.
 */
function normalizeForChange(raw: string, defaultCountry?: string): NormalizedPhone {
  const normalized = normalizePhone(raw, defaultCountry);
  if (!normalized.ok) return normalized;
  if (!getSupportedPhoneCountrySet("change").has(normalized.countryIso)) {
    return { ok: false, reason: "unsupported_country" };
  }
  return normalized;
}

// ---------------------------------------------------------------------------
// Dead-holder auto-release (the phone twin of ensureAppUser's email-orphan
// takeover). A number can be stuck on an account that no longer lives: a
// DELETED shell (should not happen - teardown clears phones - but defended
// anyway) or an app row whose auth.users identity was deleted from the
// dashboard without the webhook. Such a holder is torn down (audited shell
// teardown, same as the email path) so the claim can proceed. A LIVE
// holder is NEVER touched - and isReleasablePhoneHolder fails safe.
// ---------------------------------------------------------------------------

async function tryAutoReleaseDeadHolder(opts: {
  holder: { id: string; status: string };
  claimantId: string;
  phoneE164: string;
  flow: "phone_change_send" | "phone_change_verify";
  req?: Request;
}): Promise<boolean> {
  if (!(await isReleasablePhoneHolder(opts.holder))) return false;
  await teardownAccount(opts.holder.id, "orphaned phone holder released for re-claim");
  await recordAuthEvent({
    type: "phone_holder_auto_released",
    phoneE164: opts.phoneE164,
    userId: opts.claimantId,
    req: opts.req,
    metadata: {
      holderId: opts.holder.id,
      holderStatus: opts.holder.status,
      flow: opts.flow,
    },
  });
  return true;
}

// ---------------------------------------------------------------------------
// Send
// ---------------------------------------------------------------------------

export type PhoneSendOutcome =
  | { kind: "invalid_phone" }
  | { kind: "unsupported_country" }
  | { kind: "account_blocked" }
  /** `holderId` = the OTHER account that owns the number (diagnostics only, never UI). */
  | { kind: "duplicate_phone"; holderId: string }
  | { kind: "already_verified"; user: User }
  /** Sent OR rate-limited - deliberately indistinguishable (neutral contract). */
  | { kind: "sent"; retryAfter: number; limited: boolean }
  | { kind: "provider_rejected"; message: string; httpStatus: number }
  | { kind: "unavailable" };

export async function sendPhoneVerification(opts: {
  user: { id: string; bannedAt: Date | null; status: string };
  phone: string;
  countryIso?: string;
  provider?: PhoneVerificationProvider;
  req?: Request;
}): Promise<PhoneSendOutcome> {
  const { user, req } = opts;

  // (1) Normalize + country allowlist FIRST - bad or out-of-allowlist
  // input never consumes a rate limit, never reaches a provider, never
  // writes state.
  const normalized = normalizeForChange(opts.phone, opts.countryIso);
  if (!normalized.ok) return { kind: normalized.reason };
  const { phoneE164 } = normalized;

  // Banned accounts don't get to burn SMS credits.
  if (user.bannedAt || user.status === "SUSPENDED" || user.status === "BANNED") {
    await recordAuthEvent({ type: "phone_otp_send_blocked", phoneE164, userId: user.id, req });
    return { kind: "account_blocked" };
  }

  // Ban evasion: a number snapshotted from a BANNED account can never be
  // claimed by any account (BannedCredential blocklist; lifted only when
  // the ban is reversed).
  if (await isCredentialBanned("PHONE", phoneE164)) {
    await recordAuthEvent({
      type: "phone_otp_send_blocked",
      phoneE164,
      userId: user.id,
      req,
      metadata: { reason: "banned_credential" },
    });
    return { kind: "account_blocked" };
  }

  // (2) OWNERSHIP BEFORE EVERYTHING ELSE. phoneE164 is only ever set by a
  // completed verification, so any other holder means the number belongs
  // to another account - even one under admin-forced re-verification
  // (phoneVerifiedAt cleared, claim kept). Rejecting here guarantees the
  // rival attempt creates/mutates NOTHING against a LIVE holder: no
  // provider call, no auth.users write, no cooldown consumption - one
  // audit row only. A DEAD holder (DELETED shell / auth user gone) is the
  // one exception: it is auto-released (audited teardown) and the claim
  // proceeds - see tryAutoReleaseDeadHolder.
  const holder = await db.user.findUnique({ where: { phoneE164 } });
  if (holder && holder.id !== user.id) {
    const released = await tryAutoReleaseDeadHolder({
      holder,
      claimantId: user.id,
      phoneE164,
      flow: "phone_change_send",
      req,
    });
    if (!released) {
      await recordAuthEvent({ type: "phone_otp_send_conflict", phoneE164, userId: user.id, req });
      return { kind: "duplicate_phone", holderId: holder.id };
    }
  }
  // Same number already verified on THIS account - success, no SMS.
  if (holder && holder.id === user.id && holder.phoneVerifiedAt) {
    return { kind: "already_verified", user: holder };
  }

  // (3) Escalating resend cooldown (30s -> 60s -> 120s) + 5 sends/hour per
  // number. Limited requests get the SAME neutral outcome as real sends.
  const cooldown = await resendCooldown("phone", phoneE164);
  if (!cooldown.allowed) {
    await recordAuthEvent({
      type: "phone_otp_send_limited",
      phoneE164,
      userId: user.id,
      req,
      metadata: { reason: "resend_cooldown", retryAfter: cooldown.retryAfter },
    });
    return { kind: "sent", retryAfter: cooldown.retryAfter, limited: true };
  }

  // (4) Only now may the provider run.
  try {
    await (opts.provider ?? phoneVerificationProvider()).sendCode(phoneE164);
  } catch (error) {
    // Vendor-side policy rejection (invalid number, Verify's own send
    // cap): OUR neutral copy to the caller, the real cause in the audit.
    if (error instanceof PhoneProviderRejectedError) {
      await recordAuthEvent({
        type: "phone_otp_send_rejected",
        phoneE164,
        userId: user.id,
        req,
        metadata: error.auditMetadata,
      });
      return {
        kind: "provider_rejected",
        message: error.neutralMessage,
        httpStatus: error.httpStatus,
      };
    }
    // Outage or feature off: blocked, never a verification bypass.
    if (!(error instanceof PhoneOtpNotConfiguredError)) {
      console.error(`[auth:phone/send] provider failed:`, error);
      await recordAuthEvent({ type: "phone_otp_send_error", phoneE164, userId: user.id, req });
    }
    return { kind: "unavailable" };
  }

  await recordAuthEvent({
    type: "phone_otp_send",
    phoneE164,
    userId: user.id,
    req,
    metadata: { countryIso: normalized.countryIso, dialCode: normalized.dialCode },
  });
  return { kind: "sent", retryAfter: cooldown.retryAfter, limited: false };
}

// ---------------------------------------------------------------------------
// Verify
// ---------------------------------------------------------------------------

export type PhoneVerifyOutcome =
  | { kind: "invalid_phone" }
  | { kind: "unsupported_country" }
  | { kind: "locked" }
  /** Ban-evasion blocklist hit (BannedCredential) - number may not verify. */
  | { kind: "account_blocked" }
  /** `holderId` = the OTHER account that owns the number (diagnostics only, never UI). */
  | { kind: "duplicate_phone"; holderId: string }
  | { kind: "already_verified"; user: User }
  | { kind: "expired" }
  | { kind: "incorrect" }
  | { kind: "provider_rejected"; message: string; httpStatus: number }
  | { kind: "unavailable" }
  | { kind: "verified"; user: User };

/** Prisma unique-constraint violation (the race loser's signature). */
function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

// ---------------------------------------------------------------------------
// auth.users.phone sync (service-role admin client). The app DB is the
// source of truth; auth.users.phone is a maintained mirror with a durable
// disposition on the User row. This REPLACES the old session-client
// backfill (supabase.auth.updateUser({ phone })), which was inert with the
// Supabase phone provider OFF (proven live 2026-07-09: 400
// phone_provider_disabled) - the admin API writes the column directly and
// does not depend on the provider toggle or the user's session.
// ---------------------------------------------------------------------------

/** Structural subset of supabase.auth.admin the sync needs - injectable in tests. */
export type AdminPhoneSyncClient = {
  updateUserById(
    uid: string,
    attributes: { phone: string; phone_confirm: boolean },
  ): Promise<{ error: { code?: string; message: string } | null }>;
};

/**
 * GoTrue stores auth.users.phone WITHOUT the leading '+' (its
 * formatPhoneNumber strips it before the E.164 digit check), so
 * "+353861234501" lives in the column as "353861234501". Every SQL
 * comparison against auth.users.phone must use this form; writes may pass
 * canonical E.164 - GoTrue normalizes on the way in.
 */
export function gotruePhone(phoneE164: string): string {
  return phoneE164.replace(/^\+/, "");
}

/** Is the server-side admin sync configured at all? (Named check so the
 *  FAILED/PENDING branch never even attempts the server-only import.) */
export function serviceRoleKeyPresent(): boolean {
  return Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY?.trim());
}

/**
 * The auth.users row currently holding this number (uid), or null. Read
 * straight from auth.users - the admin sync would otherwise collide with
 * an existing identity. Fails OPEN (null) on read errors: the sync itself
 * then fails closed with a durable FAILED state instead of silently
 * blocking verification on an audit read.
 */
export async function findAuthPhoneHolder(phoneE164: string): Promise<string | null> {
  try {
    const rows = await db.$queryRaw<{ id: string }[]>`
      SELECT id::text FROM auth.users WHERE phone = ${gotruePhone(phoneE164)} LIMIT 1`;
    return rows[0]?.id ?? null;
  } catch (error) {
    console.warn(
      `[auth:phone] auth.users holder lookup failed - proceeding: ${String(error).slice(0, 120)}`,
    );
    return null;
  }
}

export type PhoneSyncResult = { status: "SYNCED" | "FAILED"; errorCode: string | null };

async function resolveAdminSyncClient(
  injected?: AdminPhoneSyncClient,
): Promise<{ ok: true; client: AdminPhoneSyncClient } | { ok: false; errorCode: string }> {
  if (injected) return { ok: true, client: injected };
  if (!serviceRoleKeyPresent()) return { ok: false, errorCode: "service_key_missing" };
  try {
    // Lazy so this module stays importable outside Next (tsx tests): the
    // admin module carries a `server-only` build guard.
    const { supabaseAdmin } = await import("@/lib/supabase/admin");
    return { ok: true, client: supabaseAdmin().auth.admin };
  } catch (error) {
    console.warn(
      `[auth:phone] admin client unavailable: ${String(error).slice(0, 120)}`,
    );
    return { ok: false, errorCode: "admin_client_unavailable" };
  }
}

/**
 * Mirror an app-VERIFIED number into auth.users.phone and stamp the
 * durable disposition on the User row. Call ONLY after phoneE164 +
 * phoneVerifiedAt are committed app-side (the Twilio approval is the
 * business truth this mirrors - `phone_confirm: true` is legitimate
 * exactly because approval already happened).
 *
 * Never throws and never unwinds the app claim: no client / failed write
 * -> phoneSyncStatus FAILED with an error code, picked up by admin
 * re-sync and the reconciliation service. Success -> SYNCED, and
 * authCompleted is finalized in the SAME update (per the both-stores
 * contract, an account is only "complete" once identity and app agree).
 */
export async function syncVerifiedPhoneToAuth(opts: {
  userId: string;
  phoneE164: string;
  client?: AdminPhoneSyncClient;
  req?: Request;
}): Promise<PhoneSyncResult> {
  const { userId, phoneE164, req } = opts;

  async function stamp(result: PhoneSyncResult): Promise<PhoneSyncResult> {
    await db.user
      .update({
        where: { id: userId },
        data: {
          phoneSyncStatus: result.status,
          phoneSyncErrorCode: result.errorCode,
          phoneSyncUpdatedAt: new Date(),
          ...(result.status === "SYNCED" ? { authCompleted: true } : {}),
        },
      })
      .catch((error) => {
        console.error(`[auth:phone] failed to stamp phoneSyncStatus for ${userId}:`, error);
      });
    return result;
  }

  const resolved = await resolveAdminSyncClient(opts.client);
  if (!resolved.ok) {
    await recordAuthEvent({
      type: "phone_auth_sync_failed",
      phoneE164,
      userId,
      req,
      metadata: { code: resolved.errorCode },
    });
    return stamp({ status: "FAILED", errorCode: resolved.errorCode });
  }

  try {
    const { error } = await resolved.client.updateUserById(userId, {
      phone: phoneE164, // GoTrue strips the '+' itself (see gotruePhone)
      phone_confirm: true, // approval-gated: Twilio said yes before this runs
    });
    if (error) {
      const code = String(error.code ?? error.message).slice(0, 80);
      await recordAuthEvent({
        type: "phone_auth_sync_failed",
        phoneE164,
        userId,
        req,
        metadata: { code },
      });
      return stamp({ status: "FAILED", errorCode: code });
    }
  } catch (error) {
    console.warn(`[auth:phone] auth.users.phone sync failed: ${String(error).slice(0, 120)}`);
    await recordAuthEvent({
      type: "phone_auth_sync_failed",
      phoneE164,
      userId,
      req,
      metadata: { code: "exception" },
    });
    return stamp({ status: "FAILED", errorCode: "exception" });
  }

  await recordAuthEvent({ type: "phone_auth_sync", phoneE164, userId, req });
  return stamp({ status: "SYNCED", errorCode: null });
}

export async function confirmPhoneVerification(opts: {
  user: { id: string };
  phone: string;
  code: string;
  countryIso?: string;
  provider?: PhoneVerificationProvider;
  /** Overrides the service-role admin client for the auth.users.phone sync (tests). */
  adminSync?: AdminPhoneSyncClient;
  req?: Request;
}): Promise<PhoneVerifyOutcome> {
  const { user, req } = opts;

  // Same normalize + allowlist gate as send (defense in depth - a code
  // for an out-of-allowlist number can never complete a claim).
  const normalized = normalizeForChange(opts.phone, opts.countryIso);
  if (!normalized.ok) {
    return { kind: normalized.reason === "invalid_phone" ? "invalid_phone" : "unsupported_country" };
  }
  const { phoneE164 } = normalized;

  // Ban evasion (same check as the send stage - the blocklist may have
  // gained the number between send and verify).
  if (await isCredentialBanned("PHONE", phoneE164)) {
    await recordAuthEvent({
      type: "otp_verify_fail",
      phoneE164,
      userId: user.id,
      req,
      metadata: { reason: "banned_credential" },
    });
    return { kind: "account_blocked" };
  }

  // Idempotent success: this exact number is already verified on THIS
  // account - don't burn a provider check on it. Re-approval never
  // duplicates audits: a SYNCED row returns untouched; an outstanding
  // PENDING/FAILED mirror gets a retry-safe sync attempt (the helper
  // audits its own disposition, nothing else is written).
  const self = await db.user.findUnique({ where: { id: user.id } });
  if (self && self.phoneE164 === phoneE164 && self.phoneVerifiedAt) {
    if (self.phoneSyncStatus === "SYNCED") return { kind: "already_verified", user: self };
    await syncVerifiedPhoneToAuth({ userId: user.id, phoneE164, client: opts.adminSync, req });
    const fresh = await db.user.findUnique({ where: { id: user.id } });
    return { kind: "already_verified", user: fresh ?? self };
  }

  // Ownership BEFORE the provider - a number held by another LIVE account
  // is rejected without consuming the code or touching provider state. A
  // dead holder (DELETED shell / auth user gone) is auto-released so the
  // claim can complete (same policy as send).
  const holder = await db.user.findUnique({ where: { phoneE164 } });
  if (holder && holder.id !== user.id) {
    const released = await tryAutoReleaseDeadHolder({
      holder,
      claimantId: user.id,
      phoneE164,
      flow: "phone_change_verify",
      req,
    });
    if (!released) {
      await recordAuthEvent({ type: "phone_otp_verify_conflict", phoneE164, userId: user.id, req });
      return { kind: "duplicate_phone", holderId: holder.id };
    }
  }

  // Same conflict, auth-side: a number attached to a DIFFERENT auth.users
  // row (native phone login, an unreleased mirror) would make the admin
  // sync collide with an existing identity. Same neutral duplicate answer
  // as the app-level check, still pre-provider.
  const authHolder = await findAuthPhoneHolder(phoneE164);
  if (authHolder && authHolder !== user.id) {
    await recordAuthEvent({
      type: "phone_otp_verify_conflict",
      phoneE164,
      userId: user.id,
      req,
      metadata: { source: "auth_users" },
    });
    return { kind: "duplicate_phone", holderId: authHolder };
  }

  // Failure lock: 5 invalid attempts within 15 minutes (per number or per
  // IP) -> locked for 15 minutes. Audited as its own type so locked
  // requests never extend the lock.
  const blocked = await checkOtpVerifyBlocked({
    phoneE164,
    ipHash: req ? ipHashFrom(req) : null,
  });
  if (!blocked.ok) {
    await recordAuthEvent({
      type: "otp_verify_locked",
      phoneE164,
      userId: user.id,
      req,
      metadata: { reason: blocked.reason ?? "locked" },
    });
    return { kind: "locked" };
  }

  let checked: "approved" | "incorrect" | "expired";
  try {
    checked = await (opts.provider ?? phoneVerificationProvider()).verifyCode(
      phoneE164,
      opts.code,
    );
  } catch (error) {
    if (error instanceof PhoneOtpNotConfiguredError) return { kind: "unavailable" };
    // Vendor-side policy rejection (e.g. Twilio 60202 - Verify's own max
    // check attempts): OUR neutral copy, real cause in the audit trail.
    if (error instanceof PhoneProviderRejectedError) {
      await recordAuthEvent({
        type:
          error.auditMetadata.reason === "max_check_attempts"
            ? "otp_verify_locked"
            : "otp_verify_fail",
        phoneE164,
        userId: user.id,
        req,
        metadata: error.auditMetadata,
      });
      return {
        kind: "provider_rejected",
        message: error.neutralMessage,
        httpStatus: error.httpStatus,
      };
    }
    throw error;
  }
  if (checked !== "approved") {
    // A wrong or expired code claims NOTHING - the user row is untouched.
    await recordAuthEvent({
      type: "otp_verify_fail",
      phoneE164,
      userId: user.id,
      req,
      metadata: { reason: checked },
    });
    return { kind: checked };
  }

  // FINAL-SUCCESS TRANSACTION - the single place User.phoneE164 is
  // written, atomically with phoneVerifiedAt. Re-check the holder inside
  // the transaction; the unique index on phoneE164 (and legacy phone)
  // settles any true concurrent race - the loser lands in the P2002
  // branch and gets duplicate_phone.
  const now = new Date();
  let updated: User | null;
  try {
    updated = await db.$transaction(async (tx) => {
      const rival = await tx.user.findUnique({ where: { phoneE164 } });
      if (rival && rival.id !== user.id) return null;
      return tx.user.update({
        where: { id: user.id },
        data: {
          phoneE164,
          phoneCountryIso: normalized.countryIso,
          phoneDialCode: normalized.dialCode,
          phoneVerifiedAt: now,
          // Legacy mirror columns - kept in sync until fully retired
          phone: phoneE164,
          phoneVerified: now,
          // The auth.users mirror is owed from this moment; the admin sync
          // below settles it to SYNCED/FAILED. authCompleted is NOT set
          // here - it finalizes together with SYNCED (both stores agree).
          phoneSyncStatus: "PENDING",
          phoneSyncErrorCode: null,
          phoneSyncUpdatedAt: now,
        },
      });
    });
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    updated = null;
  }
  if (!updated) {
    await recordAuthEvent({ type: "phone_otp_verify_conflict", phoneE164, userId: user.id, req });
    // Race loser - refetch the winner purely for the diagnostic outcome.
    const winner = await db.user.findUnique({ where: { phoneE164 }, select: { id: true } });
    return { kind: "duplicate_phone", holderId: winner?.id ?? "unknown" };
  }

  await recordAuthEvent({ type: "phone_otp_verify", phoneE164, userId: user.id, req });

  // MIRROR (AFTER the claim committed): write auth.users.phone via the
  // service-role admin client and settle phoneSyncStatus. A failure here
  // never unwinds the Twilio-approved claim - the caller still gets
  // `verified` (business truth), while FAILED + errorCode drive admin
  // re-sync and the reconciliation service. On success authCompleted is
  // finalized in the same update as SYNCED.
  await syncVerifiedPhoneToAuth({ userId: user.id, phoneE164, client: opts.adminSync, req });
  const finalRow = await db.user.findUnique({ where: { id: user.id } });

  return { kind: "verified", user: finalRow ?? updated };
}
