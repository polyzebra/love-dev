import { NextResponse } from "next/server";
import { z } from "zod";
import { ok, apiError, parseBody, withUnavailableGuard } from "@/lib/api";
import { supabaseServer } from "@/lib/supabase/server";
import { sendPhoneLoginCode } from "@/lib/auth/phone-login-flow";

const bodySchema = z.object({
  phoneE164: z.string().trim().min(4).max(20),
  countryIso: z.string().trim().length(2),
});

const INVALID_PHONE = "Enter a valid phone number.";
const UNSUPPORTED_COUNTRY = "Phone sign-in isn't available for that country yet.";
const NOT_AVAILABLE = "Phone sign-in isn't available right now.";
// Provider send failure (phone_provider_disabled, sms_send_failed, ...):
// production stays neutral; dev/staging name the actual fix so the flag
// being on with the Supabase Phone provider still off is diagnosable
// from the UI instead of a silent dead end.
const SMS_UNAVAILABLE_NEUTRAL =
  "Text sign-in is temporarily unavailable. Use email or Google instead.";
const SMS_UNAVAILABLE_DETAIL =
  "Phone sign-in is not configured: enable the Phone provider with Twilio Verify " +
  "in Supabase Auth settings.";
const SMS_UNAVAILABLE =
  process.env.NODE_ENV === "production" ? SMS_UNAVAILABLE_NEUTRAL : SMS_UNAVAILABLE_DETAIL;
const IDENTITY_CONFLICT =
  "This number is already linked to an account that signs in another way. " +
  "Use your email or Google to sign in, then add phone sign-in from Settings.";
const ACCOUNT_BLOCKED = "That number can't be used right now.";
const RESEND_TOO_SOON = "Please wait before requesting another code.";

/**
 * POST /api/auth/phone-login/send { phoneE164, countryIso } - ANONYMOUS.
 * Part of the phone-LOGIN flow (native Supabase phone OTP) - entirely
 * separate from the authenticated /api/auth/phone/send (phone-change).
 *
 * -> 200 { data: { sent: true, retryAfter } }
 * -> 400 INVALID_PHONE | UNSUPPORTED_COUNTRY (getSupportedPhoneCountries("login"))
 * -> 403 ACCOUNT_BLOCKED
 * -> 409 IDENTITY_CONFLICT   number owned by an account this flow cannot
 *                            sign into (see phone-login-flow.ts bridge)
 * -> 429 RESEND_TOO_SOON     escalating cooldown / hourly caps (Retry-After set)
 * -> 503 PHONE_LOGIN_NOT_AVAILABLE (flag off - UI hides the button)
 *      | SMS_PROVIDER_UNAVAILABLE  (GoTrue/Twilio-in-Supabase failed)
 */
export const POST = withUnavailableGuard(
  "auth:phone-login/send",
  async (req: Request) => {
    const { data, response } = await parseBody(req, bodySchema);
    if (response) return response;

    const supabase = await supabaseServer();
    const outcome = await sendPhoneLoginCode({
      phone: data.phoneE164,
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
      case "identity_conflict":
        return apiError(409, "IDENTITY_CONFLICT", IDENTITY_CONFLICT);
      case "account_blocked":
        return apiError(403, "ACCOUNT_BLOCKED", ACCOUNT_BLOCKED);
      case "resend_too_soon":
        return NextResponse.json(
          {
            error: {
              code: "RESEND_TOO_SOON",
              message: RESEND_TOO_SOON,
              retryAfter: outcome.retryAfter,
            },
          },
          { status: 429, headers: { "Retry-After": String(outcome.retryAfter) } },
        );
      case "sms_provider_unavailable":
        return apiError(503, "SMS_PROVIDER_UNAVAILABLE", SMS_UNAVAILABLE);
      case "sent":
        return ok({ sent: true, retryAfter: outcome.retryAfter });
    }
  },
  NOT_AVAILABLE,
);
