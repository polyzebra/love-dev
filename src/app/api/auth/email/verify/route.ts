import { NextResponse } from "next/server";
import { z } from "zod";
import { supabaseServer } from "@/lib/supabase/server";
import { emailSchema } from "@/lib/validators/auth";
import { ensureAppUser } from "@/lib/auth/identity";
import { authNextStep } from "@/lib/auth/gate";
import { phoneVerificationEnabled } from "@/lib/auth/phone";
import { checkOtpVerifyBlocked } from "@/lib/auth/rate-limit";
import { clientIpFrom, ipHashFrom, recordAuthEvent } from "@/lib/auth/audit";
import { registerDevice } from "@/lib/auth/device";
import { computeRiskScore } from "@/lib/auth/risk";
import { db } from "@/lib/db";

const bodySchema = z.object({
  email: emailSchema,
  code: z.string().trim().regex(/^\d{6}$/, "Enter the 6-digit code"),
});

const CODE_FAILED = "That code didn't work. Try again.";
const ACCOUNT_UNAVAILABLE = "That email can't be used right now.";
const LOCKED = "Too many attempts. Please try again in a few minutes.";

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

  // Failure lock: 5 invalid attempts within 15 minutes (per email or per
  // IP) -> locked for 15 minutes. Audited as its own type so locked
  // requests never extend the lock.
  const blocked = await checkOtpVerifyBlocked({ email, ipHash });
  if (!blocked.ok) {
    await recordAuthEvent({
      type: "otp_verify_locked",
      email,
      req,
      metadata: { reason: blocked.reason ?? "locked" },
    });
    return NextResponse.json({ ok: false, error: LOCKED }, { status: 429 });
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

  // Device + risk evaluation. ensureAppUser already stamped the new
  // lastLoginIpHash; keep the one it replaced as previousIpHash so the
  // engines (and admins) can see the rotation.
  await db.user
    .update({
      where: { id: result.user.id },
      data: { previousIpHash: result.previousLoginIpHash },
    })
    .catch(() => {});
  const device = await registerDevice(result.user.id, req);
  let highRisk = false;
  let riskScore = 0;
  let riskReasons: string[] = [];
  try {
    const risk = await computeRiskScore(result.user, {
      ipHash,
      deviceHash: device?.deviceHash ?? null,
      previousIpHash: result.previousLoginIpHash,
      newDevice: device?.isNewDevice,
      rawIp: clientIpFrom(req), // transient - the intel hook only, never stored
    });
    highRisk = risk.highRisk;
    riskScore = risk.score;
    riskReasons = risk.reasons;
  } catch (error) {
    console.error("[auth:verify] risk evaluation failed:", error);
  }

  // Returning-user step-up: a HIGH-RISK sign-in on an account that HAS a
  // verified phone re-verifies the phone (only when an SMS provider
  // actually exists). Low risk follows the normal gate ladder.
  let next = authNextStep(result.user);
  if (highRisk && phoneVerificationEnabled() && result.user.phoneVerifiedAt) {
    next = "/auth/phone";
    await recordAuthEvent({
      type: "risk_triggered",
      email,
      userId: result.user.id,
      req,
      metadata: {
        trigger: "high_risk_email_login",
        riskScore,
        riskReasons: riskReasons.join(","),
        deviceHash: device?.deviceHash ?? null,
      },
    });
  }

  await recordAuthEvent({
    type: "email_otp_verify",
    email,
    userId: result.user.id,
    req,
    metadata: { deviceHash: device?.deviceHash ?? null, riskScore },
  });
  return NextResponse.json({ ok: true, next });
}
