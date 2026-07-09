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
  | { ok: true; retryAfter?: number }
  | { ok: false; blocked: boolean; message: string };

export type VerifyResult =
  | { ok: true; next: string }
  | { ok: false; message: string };

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
  if (res.json?.ok === true) return { ok: true, retryAfter: retryAfterOf(res.json) };
  return {
    ok: false,
    blocked: res.json?.blocked === true || res.status === 503,
    message: errorMessage(res.json) ?? GENERIC_MESSAGE,
  };
}

/** POST /api/auth/phone/verify. */
export async function verifyPhoneCode(phoneE164: string, code: string): Promise<VerifyResult> {
  const res = await post("/api/auth/phone/verify", { phoneE164, code });
  if (!res) return { ok: false, message: OFFLINE_MESSAGE };
  const next = res.json?.next;
  if (res.json?.ok === true && typeof next === "string") return { ok: true, next };
  return { ok: false, message: errorMessage(res.json) ?? GENERIC_MESSAGE };
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
