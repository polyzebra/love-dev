import { NextResponse } from "next/server";
import { z } from "zod";
import { supabaseServer } from "@/lib/supabase/server";
import { emailSchema } from "@/lib/validators/auth";
import { isDisposableEmail } from "@/lib/auth/disposable-domains";
import { checkEmailOtpSendLimit } from "@/lib/auth/rate-limit";
import { ipHashFrom, recordAuthEvent } from "@/lib/auth/audit";

const bodySchema = z.object({ email: emailSchema });

/**
 * POST /api/auth/email/send { email } -> { ok: true }
 *
 * Sends a 6-digit sign-in code. The response is ALWAYS the same neutral
 * 200 - disposable domains, rate limits and provider hiccups are never
 * revealed to the caller (they differ only in the audit trail). Account
 * enumeration gets nothing here.
 */
export async function POST(req: Request) {
  const neutral = NextResponse.json({ ok: true });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Enter a valid email address." }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Enter a valid email address." }, { status: 400 });
  }
  const email = parsed.data.email;

  // Disposable domains: pretend success, record the truth
  if (isDisposableEmail(email)) {
    await recordAuthEvent({ type: "email_otp_send_disposable", email, req });
    return neutral;
  }

  // Sliding-window limits (5/h per email, 10/h per IP): same neutral 200
  const limit = await checkEmailOtpSendLimit(email, ipHashFrom(req));
  if (!limit.ok) {
    await recordAuthEvent({
      type: "email_otp_send_limited",
      email,
      req,
      metadata: { reason: limit.reason ?? "unknown" },
    });
    return neutral;
  }

  const supabase = await supabaseServer();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: true },
  });
  if (error) {
    // Provider-side failure (their rate limit, SMTP trouble): still neutral
    console.error(`[auth:email/send] signInWithOtp failed: ${error.message}`);
    await recordAuthEvent({
      type: "email_otp_send_error",
      email,
      req,
      metadata: { code: error.code ?? null },
    });
    return neutral;
  }

  await recordAuthEvent({ type: "email_otp_send", email, req });
  return neutral;
}
