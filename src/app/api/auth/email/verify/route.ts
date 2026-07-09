import { NextResponse } from "next/server";
import { z } from "zod";
import { supabaseServer } from "@/lib/supabase/server";
import { emailSchema } from "@/lib/validators/auth";
import { ensureAppUser } from "@/lib/auth/identity";
import { authNextStep, isPhoneVerificationEnabled } from "@/lib/auth/gate";
import { checkOtpVerifyBlocked } from "@/lib/auth/rate-limit";
import { ipHashFrom, recordAuthEvent } from "@/lib/auth/audit";

const bodySchema = z.object({
  email: emailSchema,
  code: z.string().trim().regex(/^\d{6}$/, "Enter the 6-digit code"),
});

const CODE_FAILED = "That code didn't work. Try again.";
const ACCOUNT_UNAVAILABLE = "That email can't be used right now.";

/**
 * POST /api/auth/email/verify { email, code } -> { ok: true, next } | { ok: false, error }
 *
 * Verifies the emailed 6-digit code through the SSR client (cookies land
 * on this response), then provisions/loads the app user through the SAME
 * identity path as the OAuth callback (ensureAppUser - one email, one
 * account) and answers with the gate's next step. All failures share one
 * neutral message.
 */
export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: CODE_FAILED }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: CODE_FAILED }, { status: 400 });
  }
  const { email, code } = parsed.data;
  const ipHash = ipHashFrom(req);

  // Too many failed attempts this hour -> hard block, same neutral copy
  const blocked = await checkOtpVerifyBlocked({ email, ipHash });
  if (!blocked.ok) {
    await recordAuthEvent({
      type: "otp_verify_fail",
      email,
      req,
      metadata: { reason: blocked.reason ?? "blocked" },
    });
    return NextResponse.json({ ok: false, error: CODE_FAILED }, { status: 429 });
  }

  const supabase = await supabaseServer();
  const { data, error } = await supabase.auth.verifyOtp({ email, token: code, type: "email" });
  if (error || !data.user?.email) {
    await recordAuthEvent({
      type: "otp_verify_fail",
      email,
      req,
      metadata: { code: error?.code ?? "no_user" },
    });
    return NextResponse.json({ ok: false, error: CODE_FAILED }, { status: 400 });
  }

  const result = await ensureAppUser(data.user, { req });
  if (!result.ok) {
    await supabase.auth.signOut().catch(() => {});
    await recordAuthEvent({
      type: "otp_verify_fail",
      email,
      req,
      metadata: { reason: result.reason },
    });
    return NextResponse.json({ ok: false, error: ACCOUNT_UNAVAILABLE }, { status: 403 });
  }

  // Returning-user risk hook: a code sign-in from a new network on an
  // account that HAS a verified phone re-verifies the phone (only when
  // an SMS provider actually exists).
  let next = authNextStep(result.user);
  if (
    isPhoneVerificationEnabled() &&
    result.user.phoneVerifiedAt &&
    result.previousLoginIpHash &&
    ipHash &&
    result.previousLoginIpHash !== ipHash
  ) {
    next = "/auth/phone";
    await recordAuthEvent({
      type: "risk_phone_challenge",
      email,
      userId: result.user.id,
      req,
      metadata: { trigger: "ip_change_on_email_login" },
    });
  }

  await recordAuthEvent({ type: "email_otp_verify", email, userId: result.user.id, req });
  return NextResponse.json({ ok: true, next });
}
