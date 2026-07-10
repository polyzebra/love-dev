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
  phoneVerificationProviderKind,
  phoneLoginEnabled,
  PhoneOtpNotConfiguredError,
  PhoneProviderRejectedError,
  type PhoneVerificationProvider,
} from "@/lib/auth/phone";
import { resendCooldown, checkOtpVerifyBlocked } from "@/lib/auth/rate-limit";
import { getSupportedPhoneCountrySet } from "@/lib/auth/phone-countries";
import { ipHashFrom, recordAuthEvent } from "@/lib/auth/audit";

/**
 * The phone-verification flow itself, lifted out of the API routes so the
 * ordering guarantees live in ONE place and are directly testable with an
 * injected provider (no Twilio, no HTTP).
 *
 * INVARIANTS (the one-phone-one-account defense):
 *  1. Normalize to E.164 FIRST. Invalid or region-less input is rejected
 *     before any rate-limit read, any audit write, any provider call.
 *  2. The ownership check runs BEFORE the provider and BEFORE rate-limit
 *     consumption. A number held by ANOTHER account never reaches the
 *     provider, never mutates auth.users, never creates pending state -
 *     the only trace of the attempt is one audit event.
 *  3. `User.phoneE164` is written in exactly one place: the final-success
 *     transaction below, together with `phoneVerifiedAt`. Nothing writes
 *     it pre-verification (verified across the codebase - the only other
 *     writers are teardown/releasePhone, which NULL it). That makes the
 *     plain @unique on phoneE164 equivalent to a partial
 *     "unique-when-verified" index, so the schema stays untouched.
 *  4. The final transaction re-checks the holder and relies on the unique
 *     index for the race: of two concurrent verifies for the same number,
 *     exactly one commits - the loser gets `duplicate_phone`.
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
  if (user.bannedAt || user.status === "SUSPENDED") {
    await recordAuthEvent({ type: "phone_otp_send_blocked", phoneE164, userId: user.id, req });
    return { kind: "account_blocked" };
  }

  // (2) OWNERSHIP BEFORE EVERYTHING ELSE. phoneE164 is only ever set by a
  // completed verification, so any other holder means the number belongs
  // to another account - even one under admin-forced re-verification
  // (phoneVerifiedAt cleared, claim kept). Rejecting here guarantees the
  // rival attempt creates/mutates NOTHING: no provider call, no
  // auth.users write, no cooldown consumption - one audit row only.
  const holder = await db.user.findUnique({ where: { phoneE164 } });
  if (holder && holder.id !== user.id) {
    await recordAuthEvent({ type: "phone_otp_send_conflict", phoneE164, userId: user.id, req });
    return { kind: "duplicate_phone", holderId: holder.id };
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
// auth.users.phone backfill (the exit ramp from the phone-login bridge)
// ---------------------------------------------------------------------------

/** Structural subset of supabase.auth the backfill needs - injectable in tests. */
export type AuthPhoneSyncClient = {
  updateUser(attributes: {
    phone: string;
  }): Promise<{ error: { code?: string; message: string } | null }>;
};

/**
 * Best-effort sync of a JUST-VERIFIED number into auth.users.phone via
 * supabase.auth.updateUser({ phone }) on the caller's live session. This
 * is the honest fix for existing owners: their number lives only in app
 * columns (User.phoneE164), so native phone LOGIN would hit the
 * IDENTITY_CONFLICT bridge; once auth.users.phone is populated, the
 * uid-match branch signs them straight into their canonical account.
 *
 * Guards (never fail the app-side claim because of the sync):
 *  - PHONE_LOGIN_ENABLED must be "true". With the Supabase phone provider
 *    OFF, GoTrue rejects any phone write outright - proven live
 *    2026-07-09: POST /auth/v1/otp {phone} -> 400 phone_provider_disabled
 *    - so attempting it would only add noise. The flag asserts the
 *    dashboard is configured (provider on + Twilio-in-Supabase).
 *  - provider kind must be "twilio". Under kind "supabase" the
 *    phone_change flow ITSELF wrote auth.users.phone (verifyOtp type
 *    "phone_change"), and updateUser({ phone }) is that flow's SEND - it
 *    would text a fresh code.
 *  - errors are audited (phone_auth_sync_failed) and swallowed. NOTE:
 *    when Supabase's "confirm phone change" is on, updateUser sends its
 *    own confirmation SMS instead of writing the column directly - keep
 *    phone-change confirmations OFF in the dashboard for a silent sync.
 *
 * Returns the disposition purely for tests/telemetry.
 */
export async function syncPhoneToSupabaseAuth(opts: {
  userId: string;
  phoneE164: string;
  client?: AuthPhoneSyncClient;
  req?: Request;
}): Promise<"skipped" | "synced" | "failed"> {
  if (!phoneLoginEnabled() || phoneVerificationProviderKind() !== "twilio") return "skipped";
  const { userId, phoneE164, req } = opts;
  try {
    const client =
      opts.client ?? (await (await import("@/lib/supabase/server")).supabaseServer()).auth;
    const { error } = await client.updateUser({ phone: phoneE164 });
    if (error) {
      await recordAuthEvent({
        type: "phone_auth_sync_failed",
        phoneE164,
        userId,
        req,
        metadata: { code: error.code ?? error.message },
      });
      return "failed";
    }
    await recordAuthEvent({ type: "phone_auth_sync", phoneE164, userId, req });
    return "synced";
  } catch (error) {
    console.warn(`[auth:phone] auth.users.phone sync failed: ${String(error).slice(0, 120)}`);
    await recordAuthEvent({
      type: "phone_auth_sync_failed",
      phoneE164,
      userId,
      req,
      metadata: { code: "exception" },
    });
    return "failed";
  }
}

export async function confirmPhoneVerification(opts: {
  user: { id: string };
  phone: string;
  code: string;
  countryIso?: string;
  provider?: PhoneVerificationProvider;
  /** Overrides the SSR supabase client for the auth.users.phone sync (tests). */
  authSync?: AuthPhoneSyncClient;
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

  // Idempotent success: this exact number is already verified on THIS
  // account - don't burn a provider check on it.
  const self = await db.user.findUnique({ where: { id: user.id } });
  if (self && self.phoneE164 === phoneE164 && self.phoneVerifiedAt) {
    return { kind: "already_verified", user: self };
  }

  // Ownership BEFORE the provider - a number held by another account is
  // rejected without consuming the code or touching provider state.
  const holder = await db.user.findUnique({ where: { phoneE164 } });
  if (holder && holder.id !== user.id) {
    await recordAuthEvent({ type: "phone_otp_verify_conflict", phoneE164, userId: user.id, req });
    return { kind: "duplicate_phone", holderId: holder.id };
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
          authCompleted: true,
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

  // BACKFILL (guarded, best-effort, AFTER the claim committed): mirror the
  // verified number into auth.users.phone so native phone LOGIN can key
  // this member by uid instead of hitting the identity-conflict bridge.
  await syncPhoneToSupabaseAuth({ userId: user.id, phoneE164, client: opts.authSync, req });

  return { kind: "verified", user: updated };
}
