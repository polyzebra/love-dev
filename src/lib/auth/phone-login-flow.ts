import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { isCredentialBanned } from "@/lib/services/trust-safety";
import type { User } from "@/generated/prisma/client";
import { normalizePhone } from "@/lib/auth/phone-flow";
import { phoneLoginEnabled } from "@/lib/auth/phone";
import { getSupportedPhoneCountrySet } from "@/lib/auth/phone-countries";
import {
  isReleasablePhoneHolder,
  provisionPhoneLoginUser,
  teardownAccount,
} from "@/lib/auth/identity";
import {
  resendCooldown,
  checkPhoneLoginSendIpLimit,
  checkPhoneLoginVerifyBlocked,
} from "@/lib/auth/rate-limit";
import { ipHashFrom, recordAuthEvent } from "@/lib/auth/audit";

/**
 * Anonymous phone LOGIN via native Supabase phone auth - a SEPARATE flow
 * from the authenticated phone-change service (phone-flow.ts). Keep them
 * separate at route/service/audit level: this one signs users IN, that
 * one attaches a number to an already-signed-in account.
 *
 * ARCHITECTURE TRUTH (proven live 2026-07-09, see docs/AUTH-SETUP.md):
 * signInWithOtp({ phone }) + verifyOtp(type: "sms") key identity by
 * auth.users.phone. Every existing member verified their number through
 * OUR Twilio Verify backend, which writes ONLY app columns
 * (User.phoneE164) - auth.users.phone is empty for ALL users. So for an
 * existing owner, native phone OTP would mint a BRAND-NEW phone-keyed
 * auth user (uid != owner's uid): a duplicate canonical account, which
 * is forbidden. Without a service-role key we can neither backfill
 * auth.users.phone server-side nor fabricate sessions - so the flow
 * ships with the EXISTING-OWNER BRIDGE:
 *
 *  - send: if an app account owns the number but auth.users does not
 *    map that number to the SAME uid, the conflict is inevitable -
 *    answer IDENTITY_CONFLICT before any SMS is burned or a stray auth
 *    user is minted.
 *  - verify (defense in depth, the contractual check): after a
 *    successful OTP, if the session's uid differs from the app owner of
 *    the number, SIGN THE SESSION OUT, audit, answer 409
 *    IDENTITY_CONFLICT with recovery copy. Never a second app account;
 *    the owner's row is never touched.
 *  - uid matches the owner (post-backfill world): normal login into the
 *    canonical account.
 *  - nobody owns the number: a new account is provisioned only after
 *    the OTP approves, with the phone stamped in the same write
 *    (identity.ts provisionPhoneLoginUser).
 *
 * The exit from the bridge is the backfill in phone-flow.ts: once
 * PHONE_LOGIN_ENABLED is on, every successful authenticated phone-change
 * verify also syncs the number into auth.users via
 * supabase.auth.updateUser({ phone }), after which the uid-match branch
 * takes over for that member.
 */

// ---------------------------------------------------------------------------
// Injectable auth client - the structural subset of supabase.auth the flow
// needs. Routes pass the SSR client's .auth (cookies land on the response);
// tests inject a fake so no SMS and no live GoTrue call ever happens.
// ---------------------------------------------------------------------------

type AuthClientError = { code?: string; message: string; status?: number } | null;

export type PhoneLoginAuthUser = {
  id: string;
  email?: string | null;
  phone?: string | null;
};

export interface PhoneLoginAuthClient {
  signInWithOtp(credentials: {
    phone: string;
    options?: { shouldCreateUser?: boolean };
  }): Promise<{ error: AuthClientError }>;
  verifyOtp(params: {
    phone: string;
    token: string;
    type: "sms";
  }): Promise<{
    data: { user: PhoneLoginAuthUser | null; session: object | null };
    error: AuthClientError;
  }>;
  signOut(): Promise<{ error: AuthClientError }>;
}

// ---------------------------------------------------------------------------
// Failure classification + structured logging
//
// Every failure in this flow is classified into ONE of these classes for
// the server log (and, where the outcome carries it, for the route's HTTP
// status). The classes are for OPERATORS: user-facing copy stays neutral
// and never leaks registration status or vendor detail.
// ---------------------------------------------------------------------------

export type PhoneLoginErrorClass =
  | "PHONE_LOGIN_DISABLED"
  | "PHONE_NOT_REGISTERED"
  | "PHONE_NOT_VERIFIED"
  | "PHONE_ACCOUNT_CONFLICT"
  | "INVALID_PHONE"
  | "SMS_PROVIDER_CONFIG_ERROR"
  | "SMS_PROVIDER_AUTH_ERROR"
  | "SMS_PROVIDER_REGION_BLOCKED"
  | "SMS_PROVIDER_RATE_LIMITED"
  | "SMS_DELIVERY_FAILED"
  | "OTP_INVALID"
  | "OTP_EXPIRED"
  | "AUTH_USER_LINK_MISSING"
  | "SESSION_CREATION_FAILED"
  | "INTERNAL_ERROR";

/**
 * Map a GoTrue signInWithOtp({ phone }) error onto our taxonomy. GoTrue
 * wraps SMS-vendor (Twilio) failures under `sms_send_failed` with the
 * vendor detail only in the message, so the message is sniffed for the
 * well-known Twilio auth/region codes before the generic delivery bucket.
 * Live-proven mapping (2026-07-11): the dashboard Phone provider being
 * OFF answers 400 `phone_provider_disabled` "Unsupported phone provider".
 */
export function classifyPhoneLoginProviderError(error: {
  code?: string;
  message: string;
  status?: number;
}): PhoneLoginErrorClass {
  const code = error.code ?? "";
  const msg = (error.message ?? "").toLowerCase();
  if (
    code === "phone_provider_disabled" ||
    code === "otp_disabled" ||
    code === "signup_disabled" ||
    code === "sms_template_error" ||
    msg.includes("unsupported phone provider")
  ) {
    return "SMS_PROVIDER_CONFIG_ERROR";
  }
  if (
    code === "over_sms_send_rate_limit" ||
    code === "over_request_rate_limit" ||
    error.status === 429
  ) {
    return "SMS_PROVIDER_RATE_LIMITED";
  }
  if (code === "validation_failed" || msg.includes("invalid phone")) return "INVALID_PHONE";
  if (
    error.status === 401 ||
    msg.includes("authenticate") ||
    msg.includes("20003") // Twilio: authentication failure
  ) {
    return "SMS_PROVIDER_AUTH_ERROR";
  }
  if (
    msg.includes("region") ||
    msg.includes("geo") ||
    msg.includes("21408") || // Twilio: permission not enabled for region
    msg.includes("60605") // Twilio Verify: destination country blocked
  ) {
    return "SMS_PROVIDER_REGION_BLOCKED";
  }
  return "SMS_DELIVERY_FAILED";
}

/** Last-3-digits masking for logs - never a full number. */
function maskPhoneForLog(phone?: string | null): string | null {
  if (!phone) return null;
  return `${phone.slice(0, 5)}*****${phone.slice(-3)}`;
}

/**
 * One sanitized structured line per failure: stage, class, provider
 * code/status, masked suffix, correlation id. NEVER the OTP code, never a
 * full phone number, never vendor copy verbatim beyond the machine code.
 */
function logPhoneLoginFailure(entry: {
  correlationId: string;
  stage: "send" | "verify";
  errorClass: PhoneLoginErrorClass;
  phoneE164?: string | null;
  providerCode?: string | null;
  providerStatus?: number | null;
  detail?: string | null;
}): void {
  console.error(
    "[auth:phone-login] " +
      JSON.stringify({
        evt: "phone_login_failure",
        cid: entry.correlationId,
        stage: entry.stage,
        class: entry.errorClass,
        phone: maskPhoneForLog(entry.phoneE164),
        providerCode: entry.providerCode ?? null,
        providerStatus: entry.providerStatus ?? null,
        detail: entry.detail ?? null,
      }),
  );
}

// ---------------------------------------------------------------------------
// Shared guards
// ---------------------------------------------------------------------------

type NormalizedOk = { phoneE164: string; countryIso: string; dialCode: string };

function normalizeForLogin(
  phone: string,
  countryIso?: string,
):
  | { ok: true; value: NormalizedOk }
  | { ok: false; kind: "invalid_phone" | "unsupported_country" } {
  const normalized = normalizePhone(phone, countryIso);
  if (!normalized.ok) return { ok: false, kind: normalized.reason };
  // The LOGIN list (getSupportedPhoneCountries("login")) - the shared
  // base, unless a documented PHONE_LOGIN_COUNTRIES override narrows it.
  if (!getSupportedPhoneCountrySet("login").has(normalized.countryIso)) {
    return { ok: false, kind: "unsupported_country" };
  }
  return { ok: true, value: normalized };
}

/**
 * The mirror of phone-flow's dead-holder auto-release for the LOGIN flow:
 * an app owner whose account no longer lives (DELETED shell, or its
 * auth.users identity was dashboard-deleted) must not hold the number
 * hostage. Tears the shell down (audited) and reports "no owner" so the
 * login proceeds as a fresh phone-keyed signup. A LIVE owner is never
 * touched (isReleasablePhoneHolder fails safe).
 */
async function autoReleaseDeadOwner(opts: {
  owner: { id: string; status: string };
  phoneE164: string;
  stage: "send" | "verify";
  req?: Request;
}): Promise<boolean> {
  if (!(await isReleasablePhoneHolder(opts.owner))) return false;
  await teardownAccount(opts.owner.id, "orphaned phone holder released for phone login");
  await recordAuthEvent({
    type: "phone_holder_auto_released",
    phoneE164: opts.phoneE164,
    req: opts.req,
    metadata: {
      holderId: opts.owner.id,
      holderStatus: opts.owner.status,
      flow: `phone_login_${opts.stage}`,
    },
  });
  return true;
}

/**
 * The auth.users uid currently holding this number, if any. GoTrue stores
 * phone WITHOUT the leading "+" - match both spellings. Returns "unknown"
 * when auth.users is unreadable: the caller must then fall through to the
 * post-verify bridge instead of guessing.
 */
async function authUidHoldingPhone(phoneE164: string): Promise<string | null | "unknown"> {
  try {
    const bare = phoneE164.replace(/^\+/, "");
    const rows = await db.$queryRaw<{ id: string }[]>`
      SELECT id::text FROM auth.users
      WHERE phone = ${bare} OR phone = ${phoneE164} LIMIT 1`;
    return rows[0]?.id ?? null;
  } catch (error) {
    console.warn(
      `[auth:phone-login] auth.users phone lookup failed: ${String(error).slice(0, 80)}`,
    );
    return "unknown";
  }
}

// ---------------------------------------------------------------------------
// Send
// ---------------------------------------------------------------------------

export type PhoneLoginSendOutcome =
  | { kind: "not_available" }
  | { kind: "invalid_phone" }
  | { kind: "unsupported_country" }
  /** Number owned by an app account the OTP session could never become. */
  | { kind: "identity_conflict" }
  | { kind: "account_blocked" }
  | { kind: "resend_too_soon"; retryAfter: number }
  | {
      kind: "sms_provider_unavailable";
      /** For the route's status choice and the log - never for user copy. */
      errorClass: PhoneLoginErrorClass;
    }
  | { kind: "sent"; retryAfter: number };

export async function sendPhoneLoginCode(opts: {
  phone: string;
  countryIso?: string;
  client: PhoneLoginAuthClient;
  req?: Request;
}): Promise<PhoneLoginSendOutcome> {
  const { req } = opts;
  const cid = randomUUID().slice(0, 8);
  if (!phoneLoginEnabled()) {
    logPhoneLoginFailure({ correlationId: cid, stage: "send", errorClass: "PHONE_LOGIN_DISABLED" });
    return { kind: "not_available" };
  }

  // Normalize + allowlist FIRST - bad input never consumes a rate limit,
  // never reaches GoTrue, never writes state.
  const normalized = normalizeForLogin(opts.phone, opts.countryIso);
  if (!normalized.ok) {
    logPhoneLoginFailure({
      correlationId: cid,
      stage: "send",
      errorClass: "INVALID_PHONE",
      detail: normalized.kind,
    });
    return { kind: normalized.kind };
  }
  const { phoneE164, countryIso, dialCode } = normalized.value;

  // Ban evasion: a number snapshotted from a BANNED account may never
  // start a login again, even after the banned row is deleted
  // (BannedCredential outlives the account; lifted only by appeal
  // approval/unban). Checked before any SMS is sent.
  if (await isCredentialBanned("PHONE", phoneE164)) {
    await recordAuthEvent({
      type: "auth_login_failed",
      phoneE164,
      req,
      metadata: { provider: "phone", stage: "send", reason: "banned_credential" },
    });
    logPhoneLoginFailure({
      correlationId: cid,
      stage: "send",
      errorClass: "PHONE_ACCOUNT_CONFLICT",
      phoneE164,
      detail: "banned_credential",
    });
    return { kind: "account_blocked" };
  }

  // EXISTING-OWNER BRIDGE, part 1 (pre-provider): when the app owner's
  // number is NOT mapped to the same uid in auth.users, verify could only
  // ever end in IDENTITY_CONFLICT - refuse now, before an SMS is burned
  // or GoTrue mints a stray phone-keyed auth user. An unreadable
  // auth.users falls through: the post-verify bridge still guards.
  let owner = await db.user.findUnique({ where: { phoneE164 } });
  if (owner && (await autoReleaseDeadOwner({ owner, phoneE164, stage: "send", req }))) {
    // Dead shell released - the number is free; proceed as a fresh signup.
    owner = null;
  }
  if (owner) {
    if (owner.bannedAt || owner.status === "SUSPENDED") {
      await recordAuthEvent({
        type: "auth_login_failed",
        phoneE164,
        userId: owner.id,
        req,
        metadata: { provider: "phone", stage: "send", reason: "account_blocked" },
      });
      logPhoneLoginFailure({
        correlationId: cid,
        stage: "send",
        errorClass: "PHONE_ACCOUNT_CONFLICT",
        phoneE164,
        detail: "account_blocked",
      });
      return { kind: "account_blocked" };
    }
    const authUid = await authUidHoldingPhone(phoneE164);
    if (authUid !== "unknown" && authUid !== owner.id) {
      await recordAuthEvent({
        type: "auth_login_failed",
        phoneE164,
        userId: owner.id,
        req,
        metadata: {
          provider: "phone",
          stage: "send",
          reason: "identity_conflict",
          authUidForPhone: authUid ?? "none",
        },
      });
      // No auth.users mapping at all = the number was verified through
      // our Twilio backend but never mirrored/re-verified into GoTrue for
      // this account - native OTP cannot log it in yet. A DIFFERENT uid
      // holding it is a genuine account conflict.
      logPhoneLoginFailure({
        correlationId: cid,
        stage: "send",
        errorClass: authUid === null ? "AUTH_USER_LINK_MISSING" : "PHONE_ACCOUNT_CONFLICT",
        phoneE164,
      });
      return { kind: "identity_conflict" };
    }
  }

  // Escalating resend cooldown + hourly caps (kind phone_login counts its
  // own auth_phone_code_sent events; per-IP cap mirrors email's 10/hour).
  const ipLimit = await checkPhoneLoginSendIpLimit(req ? ipHashFrom(req) : null);
  const cooldown = await resendCooldown("phone_login", phoneE164);
  if (!ipLimit.ok || !cooldown.allowed) {
    await recordAuthEvent({
      type: "auth_phone_code_send_limited",
      phoneE164,
      req,
      metadata: {
        provider: "phone",
        reason: ipLimit.ok ? "resend_cooldown" : (ipLimit.reason ?? "ip_hourly"),
        retryAfter: cooldown.retryAfter,
      },
    });
    return { kind: "resend_too_soon", retryAfter: cooldown.retryAfter };
  }

  // Only now may GoTrue run. shouldCreateUser stays true: first-time
  // phone signups need the auth user to exist (same reasoning as the
  // email flow - see docs/AUTH-SETUP.md "Why not shouldCreateUser: false").
  const { error } = await opts.client.signInWithOtp({
    phone: phoneE164,
    options: { shouldCreateUser: true },
  });
  if (error) {
    const errorClass = classifyPhoneLoginProviderError(error);
    await recordAuthEvent({
      type: "auth_phone_code_failed",
      phoneE164,
      req,
      metadata: {
        provider: "phone",
        stage: "send",
        code: error.code ?? error.message,
        errorClass,
      },
    });
    // phone_provider_disabled, sms_send_failed, misconfigured Twilio-in-
    // Supabase, ... - one neutral outage to the CALLER; the class carries
    // the real cause to the log and the route's status choice.
    logPhoneLoginFailure({
      correlationId: cid,
      stage: "send",
      errorClass,
      phoneE164,
      providerCode: error.code ?? null,
      providerStatus: error.status ?? null,
    });
    return { kind: "sms_provider_unavailable", errorClass };
  }

  await recordAuthEvent({
    type: "auth_phone_code_sent",
    phoneE164,
    req,
    metadata: { provider: "phone", countryIso, dialCode },
  });
  return { kind: "sent", retryAfter: cooldown.retryAfter };
}

// ---------------------------------------------------------------------------
// Verify
// ---------------------------------------------------------------------------

export type PhoneLoginVerifyOutcome =
  | { kind: "not_available" }
  | { kind: "invalid_phone" }
  | { kind: "unsupported_country" }
  | { kind: "locked" }
  | { kind: "invalid_code" }
  | { kind: "expired_code" }
  /** OTP approved but the session could not/must not stand - signed out. */
  | { kind: "identity_conflict" }
  | { kind: "account_blocked" }
  | { kind: "session_creation_failed" }
  | { kind: "login"; user: User; created: boolean };

export async function verifyPhoneLoginCode(opts: {
  phone: string;
  code: string;
  countryIso?: string;
  client: PhoneLoginAuthClient;
  req?: Request;
}): Promise<PhoneLoginVerifyOutcome> {
  const { req, client } = opts;
  const cid = randomUUID().slice(0, 8);
  if (!phoneLoginEnabled()) {
    logPhoneLoginFailure({
      correlationId: cid,
      stage: "verify",
      errorClass: "PHONE_LOGIN_DISABLED",
    });
    return { kind: "not_available" };
  }

  const normalized = normalizeForLogin(opts.phone, opts.countryIso);
  if (!normalized.ok) {
    logPhoneLoginFailure({
      correlationId: cid,
      stage: "verify",
      errorClass: "INVALID_PHONE",
      detail: normalized.kind,
    });
    return { kind: normalized.kind };
  }
  const { phoneE164, countryIso, dialCode } = normalized.value;

  // Ban evasion (same check as the send stage - the blocklist may have
  // gained the number between send and verify).
  if (await isCredentialBanned("PHONE", phoneE164)) {
    await recordAuthEvent({
      type: "auth_login_failed",
      phoneE164,
      req,
      metadata: { provider: "phone", stage: "verify", reason: "banned_credential" },
    });
    return { kind: "account_blocked" };
  }

  // Failure lock BEFORE the provider: 5 invalid attempts per number or
  // per IP within 15 minutes -> locked 15 minutes. Locked attempts audit
  // as their own type so they never extend the lock.
  const blocked = await checkPhoneLoginVerifyBlocked({
    phoneE164,
    ipHash: req ? ipHashFrom(req) : null,
  });
  if (!blocked.ok) {
    await recordAuthEvent({
      type: "auth_phone_code_locked",
      phoneE164,
      req,
      metadata: { provider: "phone", reason: blocked.reason ?? "locked" },
    });
    return { kind: "locked" };
  }

  const { data, error } = await client.verifyOtp({
    phone: phoneE164,
    token: opts.code,
    type: "sms",
  });
  if (error) {
    const expired = error.code === "otp_expired";
    await recordAuthEvent({
      type: "auth_phone_code_failed",
      phoneE164,
      req,
      metadata: { provider: "phone", stage: "verify", code: error.code ?? error.message },
    });
    logPhoneLoginFailure({
      correlationId: cid,
      stage: "verify",
      errorClass: expired ? "OTP_EXPIRED" : "OTP_INVALID",
      phoneE164,
      providerCode: error.code ?? null,
      providerStatus: error.status ?? null,
    });
    return { kind: expired ? "expired_code" : "invalid_code" };
  }
  if (!data.user || !data.session) {
    // Approved code but no session materialized - nothing to sign out,
    // nothing was provisioned. Neutral 500 for the caller.
    await recordAuthEvent({
      type: "auth_login_failed",
      phoneE164,
      req,
      metadata: { provider: "phone", reason: "session_creation_failed" },
    });
    logPhoneLoginFailure({
      correlationId: cid,
      stage: "verify",
      errorClass: "SESSION_CREATION_FAILED",
      phoneE164,
    });
    return { kind: "session_creation_failed" };
  }

  const authUid = data.user.id;
  // NOTE: no userId here - AuthVerificationEvent.userId is an FK to the
  // app User table, and a fresh phone-keyed auth uid has no app row yet.
  await recordAuthEvent({
    type: "auth_phone_code_verified",
    phoneE164,
    req,
    metadata: { provider: "phone", authUid },
  });

  /** Kill the just-minted session, then answer with the given outcome. */
  const rejectSession = async (
    outcome: Extract<
      PhoneLoginVerifyOutcome,
      { kind: "identity_conflict" | "account_blocked" }
    >["kind"],
    ownerId: string | null,
  ): Promise<PhoneLoginVerifyOutcome> => {
    await client.signOut().catch(() => {});
    // userId only when an app row exists (FK) - the raw auth uid goes in
    // metadata either way.
    await recordAuthEvent({
      type: "auth_login_failed",
      phoneE164,
      userId: ownerId,
      req,
      metadata: {
        provider: "phone",
        reason: outcome,
        authUid,
        ...(ownerId ? { ownerId } : {}),
      },
    });
    logPhoneLoginFailure({
      correlationId: cid,
      stage: "verify",
      errorClass: "PHONE_ACCOUNT_CONFLICT",
      phoneE164,
      detail: outcome,
    });
    return { kind: outcome };
  };

  // EXISTING-OWNER BRIDGE, part 2 (the contractual check). The app owner
  // of the number is canonical; a session under any OTHER uid must die
  // here - no second app account, owner untouched. (The orphan phone-
  // keyed auth.users row GoTrue minted cannot be deleted without a
  // service-role key; it is inert - no app row ever attaches to it - and
  // the audit trail records it.) One exception, same as the send stage:
  // an owner that is conclusively dead (DELETED shell / auth user gone)
  // is auto-released so the fresh phone-keyed signup can proceed.
  let owner = await db.user.findUnique({ where: { phoneE164 } });
  if (
    owner &&
    owner.id !== authUid &&
    (await autoReleaseDeadOwner({ owner, phoneE164, stage: "verify", req }))
  ) {
    owner = null;
  }
  if (owner && owner.id !== authUid) {
    return rejectSession("identity_conflict", owner.id);
  }

  if (owner) {
    // uid matches the canonical owner (post-backfill world): normal login.
    if (owner.bannedAt || owner.status === "SUSPENDED") {
      return rejectSession("account_blocked", owner.id);
    }
    const now = new Date();
    const user = await db.user.update({
      where: { id: owner.id },
      data: {
        lastActiveAt: now,
        lastLoginAt: now,
        lastLoginIpHash: req ? ipHashFrom(req) : null,
        ...(owner.status === "DEACTIVATED" ? { status: "ACTIVE", deletionRequested: null } : {}),
      },
    });
    await recordAuthEvent({
      type: "auth_login_succeeded",
      phoneE164,
      userId: user.id,
      req,
      metadata: { provider: "phone", created: false },
    });
    return { kind: "login", user, created: false };
  }

  // Nobody owns the number: provision the phone-keyed account. The row is
  // created ONLY now, after the OTP approved, with phoneE164 +
  // phoneVerifiedAt stamped in the same write.
  const provisioned = await provisionPhoneLoginUser({
    authUid,
    email: data.user.email ?? null,
    phoneE164,
    phoneCountryIso: countryIso,
    phoneDialCode: dialCode,
    req,
  });
  if (!provisioned.ok) {
    return rejectSession(
      provisioned.reason === "conflict" ? "identity_conflict" : "account_blocked",
      null,
    );
  }
  await recordAuthEvent({
    type: "auth_login_succeeded",
    phoneE164,
    userId: provisioned.user.id,
    req,
    metadata: { provider: "phone", created: provisioned.created },
  });
  return { kind: "login", user: provisioned.user, created: provisioned.created };
}
