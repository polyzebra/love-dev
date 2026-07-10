import { db } from "@/lib/db";
import type { User } from "@/generated/prisma/client";
import { normalizePhone } from "@/lib/auth/phone-flow";
import { phoneLoginEnabled } from "@/lib/auth/phone";
import { workflowCountrySet } from "@/lib/auth/phone-countries";
import { provisionPhoneLoginUser } from "@/lib/auth/identity";
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
  // The LOGIN allowlist (workflowCountries("login")) - deliberately its
  // own list, isolated from the authenticated change/verification one.
  if (!workflowCountrySet("login").has(normalized.countryIso)) {
    return { ok: false, kind: "unsupported_country" };
  }
  return { ok: true, value: normalized };
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
  | { kind: "sms_provider_unavailable" }
  | { kind: "sent"; retryAfter: number };

export async function sendPhoneLoginCode(opts: {
  phone: string;
  countryIso?: string;
  client: PhoneLoginAuthClient;
  req?: Request;
}): Promise<PhoneLoginSendOutcome> {
  const { req } = opts;
  if (!phoneLoginEnabled()) return { kind: "not_available" };

  // Normalize + allowlist FIRST - bad input never consumes a rate limit,
  // never reaches GoTrue, never writes state.
  const normalized = normalizeForLogin(opts.phone, opts.countryIso);
  if (!normalized.ok) return { kind: normalized.kind };
  const { phoneE164, countryIso, dialCode } = normalized.value;

  // EXISTING-OWNER BRIDGE, part 1 (pre-provider): when the app owner's
  // number is NOT mapped to the same uid in auth.users, verify could only
  // ever end in IDENTITY_CONFLICT - refuse now, before an SMS is burned
  // or GoTrue mints a stray phone-keyed auth user. An unreadable
  // auth.users falls through: the post-verify bridge still guards.
  const owner = await db.user.findUnique({ where: { phoneE164 } });
  if (owner) {
    if (owner.bannedAt || owner.status === "SUSPENDED") {
      await recordAuthEvent({
        type: "auth_login_failed",
        phoneE164,
        userId: owner.id,
        req,
        metadata: { provider: "phone", stage: "send", reason: "account_blocked" },
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
    await recordAuthEvent({
      type: "auth_phone_code_failed",
      phoneE164,
      req,
      metadata: { provider: "phone", stage: "send", code: error.code ?? error.message },
    });
    // phone_provider_disabled, sms_send_failed, misconfigured Twilio-in-
    // Supabase, ... - all one neutral outage to the caller.
    return { kind: "sms_provider_unavailable" };
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
  if (!phoneLoginEnabled()) return { kind: "not_available" };

  const normalized = normalizeForLogin(opts.phone, opts.countryIso);
  if (!normalized.ok) return { kind: normalized.kind };
  const { phoneE164, countryIso, dialCode } = normalized.value;

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
    await recordAuthEvent({
      type: "auth_phone_code_failed",
      phoneE164,
      req,
      metadata: { provider: "phone", stage: "verify", code: error.code ?? error.message },
    });
    return { kind: error.code === "otp_expired" ? "expired_code" : "invalid_code" };
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
    return { kind: outcome };
  };

  // EXISTING-OWNER BRIDGE, part 2 (the contractual check). The app owner
  // of the number is canonical; a session under any OTHER uid must die
  // here - no second app account, owner untouched. (The orphan phone-
  // keyed auth.users row GoTrue minted cannot be deleted without a
  // service-role key; it is inert - no app row ever attaches to it - and
  // the audit trail records it.)
  const owner = await db.user.findUnique({ where: { phoneE164 } });
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
