import { z } from "zod";
import { supabaseServer } from "@/lib/supabase/server";
import { withUnavailableGuard, authOk, authError } from "@/lib/api";
import { emailSchema } from "@/lib/validators/auth";
import { isDisposableEmail } from "@/lib/auth/disposable-domains";
import { checkOtpSendIpLimit, resendCooldown } from "@/lib/auth/rate-limit";
import { ipHashFrom, recordAuthEvent } from "@/lib/auth/audit";

const bodySchema = z.object({ email: emailSchema });

/**
 * POST /api/auth/email/send { email } -> { ok: true, retryAfter }
 *
 * Sends a 6-digit sign-in code. The response is ALWAYS the same neutral
 * 200 - disposable domains, rate limits and provider hiccups are never
 * revealed to the caller (they differ only in the audit trail). Account
 * enumeration gets nothing here. `retryAfter` (seconds) is the one thing
 * every caller learns: when the resend unlocks - it is identical whether
 * the code went out or the limiter swallowed the request.
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
});
