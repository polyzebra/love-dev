import { EMAIL_OTP_LENGTH } from "@/lib/auth/otp";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSession, withUnavailableGuard, authOk, authError } from "@/lib/api";
import { supabaseServer } from "@/lib/supabase/server";
import { emailSchema } from "@/lib/validators/auth";
import { verifyEmailAttach, EMAIL_IN_USE_MESSAGE } from "@/lib/auth/email-attach-flow";
import { realEmailAttachClient } from "@/lib/auth/email-attach-client";
import { authNextStep } from "@/lib/auth/gate";

const bodySchema = z.object({
  email: emailSchema,
  code: z
    .string()
    .trim()
    .regex(new RegExp(`^\\d{${EMAIL_OTP_LENGTH}}$`), `Enter the ${EMAIL_OTP_LENGTH}-digit code`),
});

const CODE_FAILED = "That code didn't work. Try again.";
const CODE_EXPIRED = "That code has expired. Request a new one.";
const LOCKED = "Too many attempts. Please try again in a few minutes.";
const NOT_ALLOWED = "That email address can't be used. Please use a different one.";
const ACCOUNT_UNAVAILABLE = "That email can't be used right now.";
const CHANGE_NOT_COMPLETED = "We couldn't complete the email change. Please try again shortly.";

/**
 * POST /api/auth/email-attach/verify { email, code } - AUTHENTICATED.
 * Confirms the emailed code via verifyOtp type "email_change" (GoTrue
 * stamps auth.users.email), then rewrites the app row inside a race-safe
 * transaction: real email + emailVerified, replacing the phone-first
 * placeholder. All ordering/ownership guarantees live in
 * verifyEmailAttach - src/lib/auth/email-attach-flow.ts.
 *
 * -> { ok: true, next }   attached (or already verified) - `next` is the
 *                         gate's following rung (age/legal/onboarding)
 * -> 400 { ok: false, code: "incorrect_code" | "code_expired" | "invalid_email"
 *          | "email_not_allowed", error }
 * -> 403 { ok: false, error }
 * -> 409 { ok: false, code: "email_in_use", error }  the address got claimed
 *        by another account (pre-check or commit race) - nothing was
 *        transferred, the owner is untouched
 * -> 429 { ok: false, code: "too_many_attempts", error }
 */
export const POST = withUnavailableGuard("auth:email-attach/verify", async (req: Request) => {
  const { user, response } = await requireSession();
  if (response) return response;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, code: "incorrect_code", error: CODE_FAILED },
      { status: 400 },
    );
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, code: "incorrect_code", error: CODE_FAILED },
      { status: 400 },
    );
  }

  const supabase = await supabaseServer();
  const outcome = await verifyEmailAttach({
    user,
    email: parsed.data.email,
    code: parsed.data.code,
    client: realEmailAttachClient(supabase),
    req,
  });

  switch (outcome.kind) {
    case "invalid_email":
      return NextResponse.json(
        { ok: false, code: "invalid_email", error: CODE_FAILED },
        { status: 400 },
      );
    case "not_allowed":
      return NextResponse.json(
        { ok: false, code: "email_not_allowed", error: NOT_ALLOWED },
        { status: 400 },
      );
    case "account_blocked":
      return authError(403, "account_unavailable", ACCOUNT_UNAVAILABLE);
    case "locked":
      return NextResponse.json(
        { ok: false, code: "too_many_attempts", error: LOCKED },
        { status: 429 },
      );
    case "email_in_use":
      return NextResponse.json(
        { ok: false, code: "email_in_use", error: EMAIL_IN_USE_MESSAGE },
        { status: 409 },
      );
    case "expired_code":
      return NextResponse.json(
        { ok: false, code: "code_expired", error: CODE_EXPIRED },
        { status: 400 },
      );
    case "invalid_code":
      return NextResponse.json(
        { ok: false, code: "incorrect_code", error: CODE_FAILED },
        { status: 400 },
      );
    case "not_committed":
      // OTP verified but Auth did not stamp the new address (server-side
      // "Secure email change" is ON - see docs/AUTH-SETUP.md §5e). Neutral
      // copy; the misconfiguration is in the audit trail, never leaked.
      return authError(503, "change_not_completed", CHANGE_NOT_COMPLETED);
    case "already_verified":
    case "attached":
      return authOk({ next: authNextStep(outcome.user) });
  }
});
