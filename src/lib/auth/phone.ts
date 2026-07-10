/**
 * Phone verification behind a tiny provider interface so the SMS vendor
 * is swappable. Selection order (see phoneVerificationProviderKind):
 *
 *   1. Twilio Verify - when TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN +
 *      TWILIO_VERIFY_SERVICE_SID are ALL set. Verify owns the code, its
 *      expiry (10 min service default) and delivery - we NEVER generate,
 *      see or store OTP codes ourselves.
 *   2. Supabase phone_change flow - when SUPABASE_PHONE_ENABLED === "true".
 *      updateUser({ phone }) texts a code to the new number for the
 *      SIGNED-IN user; verifyOtp(type: "phone_change") confirms it.
 *      signInWithOtp({ phone }) is deliberately NOT used - it would mint
 *      a separate phone-keyed auth identity instead of attaching the
 *      number to the current account.
 *   3. Neither configured - a thrower; routes answer 503 and the gate
 *      hides the phone step entirely.
 *
 * With Twilio Verify the app-side User row (phoneE164 + phoneVerifiedAt,
 * stamped by the verify route) is the source of truth the auth gate
 * reads; the Supabase auth user does not carry the phone identity.
 */

export class PhoneOtpNotConfiguredError extends Error {
  constructor() {
    super(
      "Phone verification is not configured (no TWILIO_* envs and SUPABASE_PHONE_ENABLED != true)",
    );
    this.name = "PhoneOtpNotConfiguredError";
  }
}

/**
 * The provider refused for a policy reason the caller may be told about -
 * but only in OUR neutral words, never the vendor's. `auditMetadata` keeps
 * the real cause for the audit trail; `httpStatus` is the response status
 * the API route should use.
 */
export class PhoneProviderRejectedError extends Error {
  readonly neutralMessage: string;
  readonly httpStatus: number;
  readonly auditMetadata: Record<string, string | number>;

  constructor(
    neutralMessage: string,
    httpStatus: number,
    auditMetadata: Record<string, string | number>,
  ) {
    super(neutralMessage);
    this.name = "PhoneProviderRejectedError";
    this.neutralMessage = neutralMessage;
    this.httpStatus = httpStatus;
    this.auditMetadata = auditMetadata;
  }
}

/**
 * Outcome of a code check. "expired" = the provider no longer holds a
 * pending verification for this number (expired or never sent) - the UI
 * tells the user to request a fresh code instead of retyping this one.
 */
export type PhoneVerifyCheck = "approved" | "incorrect" | "expired";

export interface PhoneVerificationProvider {
  /** Text a one-time code to the number (E.164). */
  sendCode(phoneE164: string): Promise<void>;
  /** Verify the code; "approved" = the number is confirmed for the current user. */
  verifyCode(phoneE164: string, code: string): Promise<PhoneVerifyCheck>;
}

// ---------------------------------------------------------------------------
// Twilio Verify v2 - direct REST via fetch, deliberately WITHOUT the `twilio`
// npm SDK: the whole integration is two form-encoded POSTs with basic auth,
// and the SDK would add a large transitive dependency tree (plus its own
// http client) for no gain. An injectable fetchImpl keeps it unit-testable
// with zero network.
// ---------------------------------------------------------------------------

export type TwilioVerifyConfig = {
  accountSid: string;
  authToken: string;
  serviceSid: string;
};

/** The three Twilio envs, or null when any is missing (feature off). */
export function twilioVerifyConfig(): TwilioVerifyConfig | null {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const serviceSid = process.env.TWILIO_VERIFY_SERVICE_SID;
  if (!accountSid || !authToken || !serviceSid) return null;
  return { accountSid, authToken, serviceSid };
}

// Our copy for vendor-side rejections - matches the neutral strings the
// routes already use, so callers can't tell which layer said no.
const NUMBER_UNAVAILABLE = "That number can't be used right now.";
const TOO_MANY_SENDS = "Too many codes requested for this number. Try again later.";
const TOO_MANY_ATTEMPTS = "Too many attempts. Please try again in a few minutes.";

type TwilioJson = { status?: string; code?: number; message?: string } | null;

/**
 * Known Twilio Verify error codes -> our neutral copy + audit metadata.
 * Anything unknown becomes a plain Error (routes treat it as an outage).
 */
function throwMappedTwilioError(code: number | undefined, httpStatus: number): never {
  const meta = (reason: string) => ({
    provider: "twilio",
    twilioCode: code ?? 0,
    reason,
  });
  switch (code) {
    case 60200: // invalid parameter (malformed/unreachable number)
      throw new PhoneProviderRejectedError(NUMBER_UNAVAILABLE, 400, meta("invalid_number"));
    case 60202: // max check attempts reached for this verification
      throw new PhoneProviderRejectedError(TOO_MANY_ATTEMPTS, 429, meta("max_check_attempts"));
    case 60203: // max send attempts reached for this verification
      throw new PhoneProviderRejectedError(TOO_MANY_SENDS, 429, meta("max_send_attempts"));
    default:
      throw new Error(`twilio verify request failed: http ${httpStatus} code ${code ?? "unknown"}`);
  }
}

export function twilioVerifyProvider(
  config: TwilioVerifyConfig,
  fetchImpl: typeof fetch = fetch,
): PhoneVerificationProvider {
  const base = `https://verify.twilio.com/v2/Services/${config.serviceSid}`;
  const authorization =
    "Basic " + Buffer.from(`${config.accountSid}:${config.authToken}`).toString("base64");

  async function post(
    path: "/Verifications" | "/VerificationCheck",
    form: Record<string, string>,
  ): Promise<{ status: number; ok: boolean; json: TwilioJson }> {
    const res = await fetchImpl(`${base}${path}`, {
      method: "POST",
      headers: {
        Authorization: authorization,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams(form).toString(),
    });
    const json = (await res.json().catch(() => null)) as TwilioJson;
    return { status: res.status, ok: res.ok, json };
  }

  return {
    async sendCode(phoneE164) {
      const { status, ok, json } = await post("/Verifications", {
        To: phoneE164,
        Channel: "sms",
      });
      if (!ok) throwMappedTwilioError(json?.code, status);
      // Success = Verify accepted the request; the code and its TTL live
      // entirely on Twilio's side.
    },
    async verifyCode(phoneE164, code) {
      const { status, ok, json } = await post("/VerificationCheck", {
        To: phoneE164,
        Code: code,
      });
      if (!ok) {
        // 404 = no pending verification for this number (expired or never
        // sent) - surfaced as its own state so the UI can say "request a
        // new code" instead of "wrong code".
        if (status === 404) return "expired";
        throwMappedTwilioError(json?.code, status);
      }
      return json?.status === "approved" ? "approved" : "incorrect";
    },
  };
}

// ---------------------------------------------------------------------------
// Supabase phone_change flow. The supabase client is imported lazily so this
// module stays importable outside a Next request context (unit tests, gate).
// ---------------------------------------------------------------------------

const supabaseProvider: PhoneVerificationProvider = {
  async sendCode(phoneE164) {
    const { supabaseServer } = await import("@/lib/supabase/server");
    const supabase = await supabaseServer();
    const { error } = await supabase.auth.updateUser({ phone: phoneE164 });
    if (error) throw new Error(`phone otp send failed: ${error.code ?? error.message}`);
  },
  async verifyCode(phoneE164, code) {
    const { supabaseServer } = await import("@/lib/supabase/server");
    const supabase = await supabaseServer();
    const { data, error } = await supabase.auth.verifyOtp({
      phone: phoneE164,
      token: code,
      type: "phone_change",
    });
    if (error) return error.code === "otp_expired" ? "expired" : "incorrect";
    return data.user ? "approved" : "incorrect";
  },
};

const notConfiguredProvider: PhoneVerificationProvider = {
  async sendCode() {
    throw new PhoneOtpNotConfiguredError();
  },
  async verifyCode() {
    throw new PhoneOtpNotConfiguredError();
  },
};

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

export type PhoneProviderKind = "twilio" | "supabase" | "none";

/** Which provider the current env selects (twilio -> supabase -> none). */
export function phoneVerificationProviderKind(): PhoneProviderKind {
  if (twilioVerifyConfig()) return "twilio";
  if (process.env.SUPABASE_PHONE_ENABLED === "true") return "supabase";
  return "none";
}

/**
 * Phone verification is only enforceable when an SMS provider is wired up.
 * THE phone-enabled switch - the gate, the routes and the risk step-up all
 * ask this (never SUPABASE_PHONE_ENABLED directly).
 */
export function phoneVerificationEnabled(): boolean {
  return phoneVerificationProviderKind() !== "none";
}

/** Active provider - Twilio Verify, else Supabase Phone Auth, else a 503 thrower. */
export function phoneVerificationProvider(): PhoneVerificationProvider {
  switch (phoneVerificationProviderKind()) {
    case "twilio":
      return twilioVerifyProvider(twilioVerifyConfig()!);
    case "supabase":
      return supabaseProvider;
    case "none":
      return notConfiguredProvider;
  }
}

// ---------------------------------------------------------------------------
// Phone LOGIN (anonymous) - a SEPARATE feature from the authenticated
// phone-change flow above. Native Supabase phone auth (signInWithOtp
// { phone } + verifyOtp type "sms") keys identity by auth.users.phone, so
// it only works when the Supabase Dashboard has BOTH:
//   1. Authentication -> Sign In / Up -> Phone provider ENABLED
//      (live audit 2026-07-09: GET /auth/v1/settings -> external.phone=false,
//      and POST /auth/v1/otp {phone} -> 400 phone_provider_disabled), and
//   2. Twilio Verify configured as Supabase's SMS provider (Account SID,
//      Auth Token, Verify Service SID - the same Verify service the
//      backend uses is fine; codes then come from one pool).
// Flip PHONE_LOGIN_ENABLED="true" ONLY once both are done. The flag also
// arms the auth.users.phone backfill in phone-flow.ts.
// ---------------------------------------------------------------------------

/**
 * THE phone-login switch. Off (default) means the login routes answer
 * 503 PHONE_LOGIN_NOT_AVAILABLE and the UI must hide the button - never
 * render a dead one.
 */
export function phoneLoginEnabled(): boolean {
  return process.env.PHONE_LOGIN_ENABLED === "true";
}

// Country allowlists live in ONE module: src/lib/auth/phone-countries.ts
// (workflowCountries) - the old phoneLoginCountries() env parse moved
// there so login/verification/change each get a named, strictly
// defaulted list.
