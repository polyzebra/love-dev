/**
 * Typed client wrappers for the step-auth API routes (built by the
 * backend against the same contracts). Every wrapper normalizes network
 * failures and unexpected payloads into calm, renderable results - the
 * steps never touch `fetch` or juggle response shapes themselves.
 */

const OFFLINE_MESSAGE = "You appear to be offline. Check your connection and try again.";
const GENERIC_MESSAGE = "Something went wrong. Please try again.";

type Json = Record<string, unknown> | null;

async function post(path: string, body: unknown): Promise<{ status: number; json: Json } | null> {
  try {
    const res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = (await res.json().catch(() => null)) as Json;
    return { status: res.status, json };
  } catch {
    return null; // network failure
  }
}

/** Pulls a human message out of `error` whether it's a string or {message}. */
function errorMessage(json: Json): string | null {
  const error = json?.error;
  if (typeof error === "string" && error) return error;
  if (error && typeof error === "object") {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message) return message;
  }
  return null;
}

export type SendResult =
  /**
   * `alreadyVerified` = this number is already verified on THIS account;
   * `next` is where the flow continues (skip the OTP screen entirely).
   */
  | { ok: true; retryAfter?: number; alreadyVerified?: boolean; next?: string }
  /**
   * `code` is the machine-readable error state when the server provides
   * one - "duplicate_phone", "invalid_phone", "unsupported_country", ...
   */
  | { ok: false; blocked: boolean; code?: string; message: string };

export type VerifyResult =
  | { ok: true; next: string }
  /** `code`: "incorrect_code" | "code_expired" | "duplicate_phone" | "too_many_attempts" ... */
  | { ok: false; code?: string; message: string };

/**
 * Server-provided resend unlock (seconds). Present on every neutral send
 * success - "sent" and "rate limited" are indistinguishable by design; the
 * countdown is the one honest signal.
 */
function retryAfterOf(json: Json): number | undefined {
  const value = json?.retryAfter;
  return typeof value === "number" && value > 0 ? Math.ceil(value) : undefined;
}

/** POST /api/auth/email/send - contractually always a neutral 200. */
export async function sendEmailCode(email: string): Promise<SendResult> {
  const res = await post("/api/auth/email/send", { email });
  if (!res) return { ok: false, blocked: false, message: OFFLINE_MESSAGE };
  // Neutral by design: even rate-limits come back as 200 {ok:true}.
  if (res.status === 200) return { ok: true, retryAfter: retryAfterOf(res.json) };
  return { ok: false, blocked: false, message: errorMessage(res.json) ?? GENERIC_MESSAGE };
}

/** POST /api/auth/email/verify. */
export async function verifyEmailCode(email: string, code: string): Promise<VerifyResult> {
  const res = await post("/api/auth/email/verify", { email, code });
  if (!res) return { ok: false, message: OFFLINE_MESSAGE };
  const next = res.json?.next;
  if (res.json?.ok === true && typeof next === "string") return { ok: true, next };
  return { ok: false, message: errorMessage(res.json) ?? GENERIC_MESSAGE };
}

/**
 * POST /api/auth/phone/send - a 503 carries { blocked: true }: phone
 * verification cannot happen right now AND must not be skipped (the
 * step screen shows the unavailable notice with no continue path).
 */
export async function sendPhoneCode(input: {
  phoneE164: string;
  countryIso: string;
  dialCode: string;
}): Promise<SendResult> {
  const res = await post("/api/auth/phone/send", input);
  if (!res) return { ok: false, blocked: false, message: OFFLINE_MESSAGE };
  if (res.json?.ok === true) {
    // Already verified on this account: a success state - the flow
    // simply continues to `next` without an OTP screen.
    if (res.json.alreadyVerified === true && typeof res.json.next === "string") {
      return { ok: true, alreadyVerified: true, next: res.json.next };
    }
    return { ok: true, retryAfter: retryAfterOf(res.json) };
  }
  return {
    ok: false,
    blocked: res.json?.blocked === true || res.status === 503,
    code: typeof res.json?.code === "string" ? res.json.code : undefined,
    message: errorMessage(res.json) ?? GENERIC_MESSAGE,
  };
}

/** POST /api/auth/phone/verify. */
export async function verifyPhoneCode(phoneE164: string, code: string): Promise<VerifyResult> {
  const res = await post("/api/auth/phone/verify", { phoneE164, code });
  if (!res) return { ok: false, message: OFFLINE_MESSAGE };
  const next = res.json?.next;
  if (res.json?.ok === true && typeof next === "string") return { ok: true, next };
  return {
    ok: false,
    code: typeof res.json?.code === "string" ? res.json.code : undefined,
    message: errorMessage(res.json) ?? GENERIC_MESSAGE,
  };
}

// ---------------------------------------------------------------------------
// Email ATTACH (authenticated) - /api/auth/email-attach/*. The mirror of the
// phone-change endpoints above for the email channel (phone-first accounts
// replacing their placeholder address) - NOT the anonymous email login.
// ---------------------------------------------------------------------------

/**
 * POST /api/auth/email-attach/send { email }. A 409 carries
 * code "email_in_use" - the UI renders the full-card conflict state with
 * the server's copy (sign in with Email/Google/Apple instead).
 */
export async function sendEmailAttachCode(email: string): Promise<SendResult> {
  const res = await post("/api/auth/email-attach/send", { email });
  if (!res) return { ok: false, blocked: false, message: OFFLINE_MESSAGE };
  if (res.json?.ok === true) {
    // Already verified on this account: a success state - the flow
    // simply continues to `next` without an OTP screen.
    if (res.json.alreadyVerified === true && typeof res.json.next === "string") {
      return { ok: true, alreadyVerified: true, next: res.json.next };
    }
    return { ok: true, retryAfter: retryAfterOf(res.json) };
  }
  return {
    ok: false,
    blocked: false,
    code: typeof res.json?.code === "string" ? res.json.code : undefined,
    message: errorMessage(res.json) ?? GENERIC_MESSAGE,
  };
}

/** POST /api/auth/email-attach/verify { email, code }. */
export async function verifyEmailAttachCode(email: string, code: string): Promise<VerifyResult> {
  const res = await post("/api/auth/email-attach/verify", { email, code });
  if (!res) return { ok: false, message: OFFLINE_MESSAGE };
  const next = res.json?.next;
  if (res.json?.ok === true && typeof next === "string") return { ok: true, next };
  return {
    ok: false,
    code: typeof res.json?.code === "string" ? res.json.code : undefined,
    message: errorMessage(res.json) ?? GENERIC_MESSAGE,
  };
}

// ---------------------------------------------------------------------------
// Phone LOGIN (anonymous) - /api/auth/phone-login/*. A SEPARATE flow from
// the authenticated phone-change endpoints above; structured errors are
// { error: { code, message, retryAfter? } } and success is { data: ... }.
// ---------------------------------------------------------------------------

/** Client-side marker for a network failure - the UI toasts instead of banners. */
export const OFFLINE_CODE = "OFFLINE";

function errorCode(json: Json): string | undefined {
  const error = json?.error;
  if (error && typeof error === "object") {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string" && code) return code;
  }
  return undefined;
}

/** RESEND_TOO_SOON carries when the next send unlocks (seconds). */
function errorRetryAfter(json: Json): number | undefined {
  const error = json?.error;
  if (error && typeof error === "object") {
    const value = (error as { retryAfter?: unknown }).retryAfter;
    if (typeof value === "number" && value > 0) return Math.ceil(value);
  }
  return undefined;
}

export type PhoneLoginSendResult =
  | { ok: true; retryAfter?: number }
  /**
   * `code`: "INVALID_PHONE" | "UNSUPPORTED_COUNTRY" | "IDENTITY_CONFLICT"
   * | "RESEND_TOO_SOON" (with retryAfter) | "PHONE_LOGIN_NOT_AVAILABLE"
   * | "SMS_PROVIDER_UNAVAILABLE" | "ACCOUNT_BLOCKED" | "OFFLINE" ...
   */
  | { ok: false; code?: string; message: string; retryAfter?: number };

/** POST /api/auth/phone-login/send { phoneE164, countryIso }. */
export async function sendPhoneLoginCode(input: {
  phoneE164: string;
  countryIso: string;
}): Promise<PhoneLoginSendResult> {
  const res = await post("/api/auth/phone-login/send", input);
  if (!res) return { ok: false, code: OFFLINE_CODE, message: OFFLINE_MESSAGE };
  const data = res.json?.data;
  if (res.status === 200 && data && typeof data === "object") {
    const retryAfter = (data as { retryAfter?: unknown }).retryAfter;
    return {
      ok: true,
      retryAfter:
        typeof retryAfter === "number" && retryAfter > 0 ? Math.ceil(retryAfter) : undefined,
    };
  }
  return {
    ok: false,
    code: errorCode(res.json),
    message: errorMessage(res.json) ?? GENERIC_MESSAGE,
    retryAfter: errorRetryAfter(res.json),
  };
}

export type PhoneLoginVerifyResult =
  | { ok: true; next: string; created: boolean }
  /**
   * `code`: "INVALID_CODE" | "EXPIRED_CODE" | "TOO_MANY_ATTEMPTS"
   * | "IDENTITY_CONFLICT" | "PHONE_LOGIN_NOT_AVAILABLE" | "OFFLINE" ...
   */
  | { ok: false; code?: string; message: string };

/** POST /api/auth/phone-login/verify { phoneE164, code } - cookies land on the response. */
export async function verifyPhoneLoginCode(
  phoneE164: string,
  code: string,
): Promise<PhoneLoginVerifyResult> {
  const res = await post("/api/auth/phone-login/verify", { phoneE164, code });
  if (!res) return { ok: false, code: OFFLINE_CODE, message: OFFLINE_MESSAGE };
  const data = res.json?.data;
  if (res.status === 200 && data && typeof data === "object") {
    const next = (data as { next?: unknown }).next;
    if (typeof next === "string") {
      return { ok: true, next, created: (data as { created?: unknown }).created === true };
    }
  }
  return {
    ok: false,
    code: errorCode(res.json),
    message: errorMessage(res.json) ?? GENERIC_MESSAGE,
  };
}

/** POST /api/auth/age-confirm - stamps the 18+ confirmation, idempotent. */
export async function confirmAge(): Promise<VerifyResult> {
  const res = await post("/api/auth/age-confirm", {});
  if (!res) return { ok: false, message: OFFLINE_MESSAGE };
  const next = res.json?.next;
  if (res.json?.ok === true && typeof next === "string") return { ok: true, next };
  return { ok: false, message: errorMessage(res.json) ?? GENERIC_MESSAGE };
}

/** POST /api/auth/consent - accepts the current legal versions, idempotent. */
export async function acceptConsent(): Promise<VerifyResult> {
  const res = await post("/api/auth/consent", {});
  if (!res) return { ok: false, message: OFFLINE_MESSAGE };
  const next = res.json?.next;
  if (res.json?.ok === true && typeof next === "string") return { ok: true, next };
  return { ok: false, message: errorMessage(res.json) ?? GENERIC_MESSAGE };
}
