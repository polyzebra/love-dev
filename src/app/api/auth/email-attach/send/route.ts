import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSession, withUnavailableGuard } from "@/lib/api";
import { supabaseServer } from "@/lib/supabase/server";
import { emailSchema } from "@/lib/validators/auth";
import { sendEmailAttach, EMAIL_IN_USE_MESSAGE } from "@/lib/auth/email-attach-flow";
import { authNextStep } from "@/lib/auth/gate";

const bodySchema = z.object({ email: emailSchema });

const INVALID_EMAIL = "Enter a valid email address.";
const NOT_ALLOWED = "That email address can't be used. Please use a different one.";
const ACCOUNT_UNAVAILABLE = "That email can't be used right now.";
const SEND_FAILED = "We couldn't send the code. Please try again shortly.";

/**
 * POST /api/auth/email-attach/send { email } - AUTHENTICATED. Attaches a
 * real email to the CURRENT account (the phone-first placeholder
 * replacement step): supabase.auth.updateUser({ email }) on the live
 * session emails a code to the new address. The mirror of
 * /api/auth/phone/send, NOT of the anonymous /api/auth/email/send.
 *
 * -> { ok: true, retryAfter }                  code was (re)sent / rate-limited
 *                                              (indistinguishable by design)
 * -> { ok: true, alreadyVerified: true, next } CASE 2 - this address is already
 *                                              verified on THIS account - no OTP
 * -> 400 { ok: false, code: "invalid_email" | "email_not_allowed", error }
 * -> 403 { ok: false, error }                  banned/suspended account
 * -> 409 { ok: false, code: "email_in_use", error }  CASE 3 - a different
 *        account owns the address; explicit BY DESIGN (see the flow's
 *        neutrality note) - no OTP was sent, the owner is untouched
 * -> 503 { ok: false, error }                  GoTrue could not take the send
 *
 * Ordering guarantees (normalize -> blocklists -> ownership -> rate limit
 * -> provider) live in sendEmailAttach - src/lib/auth/email-attach-flow.ts.
 */
export const POST = withUnavailableGuard("auth:email-attach/send", async (req: Request) => {
  const { user, response } = await requireSession();
  if (response) return response;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, code: "invalid_email", error: INVALID_EMAIL },
      { status: 400 },
    );
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, code: "invalid_email", error: INVALID_EMAIL },
      { status: 400 },
    );
  }

  const supabase = await supabaseServer();
  const outcome = await sendEmailAttach({
    user,
    email: parsed.data.email,
    client: supabase.auth,
    req,
  });

  switch (outcome.kind) {
    case "invalid_email":
      return NextResponse.json(
        { ok: false, code: "invalid_email", error: INVALID_EMAIL },
        { status: 400 },
      );
    case "not_allowed":
      return NextResponse.json(
        { ok: false, code: "email_not_allowed", error: NOT_ALLOWED },
        { status: 400 },
      );
    case "account_blocked":
      return NextResponse.json({ ok: false, error: ACCOUNT_UNAVAILABLE }, { status: 403 });
    case "email_in_use":
      return NextResponse.json(
        { ok: false, code: "email_in_use", error: EMAIL_IN_USE_MESSAGE },
        { status: 409 },
      );
    case "already_verified":
      // Success state - the flow simply continues to the next step.
      return NextResponse.json({
        ok: true,
        alreadyVerified: true,
        next: authNextStep(outcome.user),
      });
    case "send_failed":
      return NextResponse.json({ ok: false, error: SEND_FAILED }, { status: 503 });
    case "sent":
      return NextResponse.json({ ok: true, retryAfter: outcome.retryAfter });
  }
});
