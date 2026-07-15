import { z } from "zod";
import { withUnavailableGuard, authOk, authError } from "@/lib/api";
import { emailSchema } from "@/lib/validators/auth";
import { isDisposableEmail } from "@/lib/auth/disposable-domains";
import { checkOtpSendIpLimit, resendCooldown } from "@/lib/auth/rate-limit";
import { ipHashFrom, recordAuthEvent } from "@/lib/auth/audit";
import { mintEmailLoginOtp, sendBrandedOtpEmail } from "@/lib/auth/otp-email";

const bodySchema = z.object({ email: emailSchema });

/**
 * POST /api/auth/email/send { email } -> { ok: true, retryAfter }
 *
 * Sends a 6-digit sign-in code (signup OR login - unified). The code is
 * minted with admin.generateLink({ type: "magiclink" }) - which
 * auto-creates a new auth user and issues an email_otp for an existing
 * one, exactly like signInWithOtp({ shouldCreateUser }) did, but WITHOUT
 * any Supabase email - then delivered by Tirvea's own branded OTP email
 * (the single canonical renderer). No Supabase template is ever used;
 * verify stays verifyOtp({ type: "email" }).
 *
 * The response is ALWAYS the same neutral 200 - disposable domains, rate
 * limits, mint and delivery failures are never revealed to the caller
 * (they differ only in the audit trail). Account enumeration gets nothing
 * here. `retryAfter` (seconds) is the one thing every caller learns: when
 * the resend unlocks - it is identical whether the code went out or the
 * limiter swallowed the request.
 *
 * Infrastructure failures (the DB-backed limiter cannot reach the
 * database, etc.) answer a clear 503 instead of an anonymous 500 - the
 * limiter fails CLOSED: no code is ever sent unaudited.
 */
export const POST = withUnavailableGuard("auth:email/send", async (req: Request) => {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return authError(400, "invalid_email", "Enter a valid email address.");
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return authError(400, "invalid_email", "Enter a valid email address.");
  }
  const email = parsed.data.email;

  // One neutral shape for every outcome. retryAfter comes from the
  // server-authoritative escalating cooldown (30s -> 60s -> 120s, max 5
  // sends/hour) whether or not a code actually goes out.
  const cooldown = await resendCooldown("email", email);
  const neutral = authOk({ retryAfter: cooldown.retryAfter });

  // Disposable domains: pretend success, record the truth
  if (isDisposableEmail(email)) {
    await recordAuthEvent({ type: "email_otp_send_disposable", email, req });
    return neutral;
  }

  // Escalating resend cooldown + 5/h cap per email: same neutral 200
  if (!cooldown.allowed) {
    await recordAuthEvent({
      type: "email_otp_send_limited",
      email,
      req,
      metadata: { reason: "resend_cooldown", retryAfter: cooldown.retryAfter },
    });
    return neutral;
  }

  // 10/h per IP across addresses: same neutral 200
  const ipLimit = await checkOtpSendIpLimit(ipHashFrom(req));
  if (!ipLimit.ok) {
    await recordAuthEvent({
      type: "email_otp_send_limited",
      email,
      req,
      metadata: { reason: ipLimit.reason ?? "unknown", retryAfter: cooldown.retryAfter },
    });
    return neutral;
  }

  // Mint the code (magiclink: auto-creates new users, no Supabase email)
  // then deliver the canonical branded OTP email. A mint OR delivery
  // failure stays neutral - the caller never learns which, and the OTP
  // code is never logged.
  const minted = await mintEmailLoginOtp(email);
  if (minted.error || !minted.code) {
    console.error(`[auth:email/send] generateLink(magiclink) failed: ${minted.error?.message}`);
    await recordAuthEvent({
      type: "email_otp_send_error",
      email,
      req,
      metadata: { code: minted.error?.code ?? "no_code" },
    });
    return neutral;
  }
  const delivery = await sendBrandedOtpEmail(email, minted.code);
  if (!delivery.ok) {
    console.error(`[auth:email/send] branded OTP delivery failed: ${delivery.error?.message}`);
    await recordAuthEvent({
      type: "email_otp_send_error",
      email,
      req,
      metadata: { code: delivery.error?.code ?? "delivery_failed" },
    });
    return neutral;
  }

  await recordAuthEvent({ type: "email_otp_send", email, req });
  return neutral;
});
