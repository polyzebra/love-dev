import { z } from "zod";
import { ok, apiError, parseBody, withUnavailableGuard } from "@/lib/api";
import { supabaseServer } from "@/lib/supabase/server";
import { verifyPhoneLoginCode } from "@/lib/auth/phone-login-flow";
import { authNextStep } from "@/lib/auth/gate";

const bodySchema = z.object({
  phoneE164: z.string().trim().min(4).max(20),
  countryIso: z.string().trim().length(2).optional(),
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/),
});

const NOT_AVAILABLE = "Phone sign-in isn't available right now.";
const INVALID_PHONE = "Enter a valid phone number.";
const UNSUPPORTED_COUNTRY = "Phone sign-in isn't available for that country yet.";
const INVALID_CODE = "That code didn't work. Try again.";
const EXPIRED_CODE = "That code has expired. Request a new one.";
const TOO_MANY_ATTEMPTS = "Too many attempts. Please try again in a few minutes.";
const IDENTITY_CONFLICT =
  "This number is already linked to an account that signs in another way. " +
  "Use your email or Google to sign in, then add phone sign-in from Settings.";
const ACCOUNT_BLOCKED = "That number can't be used right now.";
const SESSION_FAILED = "Something went wrong signing you in. Please try again.";

/**
 * POST /api/auth/phone-login/verify { phoneE164, code, countryIso? } -
 * ANONYMOUS. Confirms the SMS code through the SSR client so the session
 * cookies land on THIS response, then resolves the canonical account
 * (existing-owner bridge / uid-match login / new phone-keyed account) in
 * verifyPhoneLoginCode - see src/lib/auth/phone-login-flow.ts.
 *
 * -> 200 { data: { next, created } }  signed in; `next` is the gate's step
 * -> 400 INVALID_PHONE | UNSUPPORTED_COUNTRY | INVALID_CODE | EXPIRED_CODE
 * -> 403 ACCOUNT_BLOCKED
 * -> 409 IDENTITY_CONFLICT   OTP approved but the number belongs to an
 *                            account that signs in another way - the
 *                            session was terminated, nothing was created
 * -> 429 TOO_MANY_ATTEMPTS
 * -> 500 SESSION_CREATION_FAILED
 * -> 503 PHONE_LOGIN_NOT_AVAILABLE (flag off)
 */
export const POST = withUnavailableGuard(
  "auth:phone-login/verify",
  async (req: Request) => {
    const { data, response } = await parseBody(req, bodySchema);
    if (response) return response;

    const supabase = await supabaseServer();
    const outcome = await verifyPhoneLoginCode({
      phone: data.phoneE164,
      code: data.code,
      countryIso: data.countryIso,
      client: supabase.auth,
      req,
    });

    switch (outcome.kind) {
      case "not_available":
        return apiError(503, "PHONE_LOGIN_NOT_AVAILABLE", NOT_AVAILABLE);
      case "invalid_phone":
        return apiError(400, "INVALID_PHONE", INVALID_PHONE);
      case "unsupported_country":
        return apiError(400, "UNSUPPORTED_COUNTRY", UNSUPPORTED_COUNTRY);
      case "locked":
        return apiError(429, "TOO_MANY_ATTEMPTS", TOO_MANY_ATTEMPTS);
      case "invalid_code":
        return apiError(400, "INVALID_CODE", INVALID_CODE);
      case "expired_code":
        return apiError(400, "EXPIRED_CODE", EXPIRED_CODE);
      case "identity_conflict":
        return apiError(409, "IDENTITY_CONFLICT", IDENTITY_CONFLICT);
      case "account_blocked":
        return apiError(403, "ACCOUNT_BLOCKED", ACCOUNT_BLOCKED);
      case "session_creation_failed":
        return apiError(500, "SESSION_CREATION_FAILED", SESSION_FAILED);
      case "login":
        return ok({ next: authNextStep(outcome.user), created: outcome.created });
    }
  },
  NOT_AVAILABLE,
);
