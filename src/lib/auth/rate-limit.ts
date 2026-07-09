import { db } from "@/lib/db";

/**
 * DB-backed sliding-window rate limits for the OTP endpoints. Counting
 * AuthVerificationEvent rows (which are written on EVERY attempt, allowed
 * or not) gives one shared truth across instances - no Redis needed, and
 * the audit trail and the limiter can never disagree.
 */

const HOUR_MS = 60 * 60 * 1000;

async function countEvents(
  where: { type: string | { in: string[] } } & (
    | { email: string }
    | { phoneE164: string }
    | { ipHash: string }
  ),
  windowMs: number,
): Promise<number> {
  return db.authVerificationEvent.count({
    where: { ...where, createdAt: { gte: new Date(Date.now() - windowMs) } },
  });
}

export type OtpLimitResult = { ok: boolean; reason?: string };

/** Email OTP send: max 5/hour per email AND 10/hour per IP hash. */
export async function checkEmailOtpSendLimit(
  email: string,
  ipHash: string | null,
): Promise<OtpLimitResult> {
  const byEmail = await countEvents({ type: "email_otp_send", email: email.toLowerCase() }, HOUR_MS);
  if (byEmail >= 5) return { ok: false, reason: "email_hourly" };
  if (ipHash) {
    const byIp = await countEvents({ type: "email_otp_send", ipHash }, HOUR_MS);
    if (byIp >= 10) return { ok: false, reason: "ip_hourly" };
  }
  return { ok: true };
}

/** Phone OTP send: max 3/hour per phone number. */
export async function checkPhoneOtpSendLimit(phoneE164: string): Promise<OtpLimitResult> {
  const byPhone = await countEvents({ type: "phone_otp_send", phoneE164 }, HOUR_MS);
  if (byPhone >= 3) return { ok: false, reason: "phone_hourly" };
  return { ok: true };
}

/**
 * OTP verification failures: after 8 failed attempts in an hour (per
 * email/phone or per IP) further verification is blocked for the rest
 * of the window.
 */
export async function checkOtpVerifyBlocked(target: {
  email?: string;
  phoneE164?: string;
  ipHash?: string | null;
}): Promise<OtpLimitResult> {
  if (target.email) {
    const fails = await countEvents(
      { type: "otp_verify_fail", email: target.email.toLowerCase() },
      HOUR_MS,
    );
    if (fails >= 8) return { ok: false, reason: "verify_fail_email" };
  }
  if (target.phoneE164) {
    const fails = await countEvents({ type: "otp_verify_fail", phoneE164: target.phoneE164 }, HOUR_MS);
    if (fails >= 8) return { ok: false, reason: "verify_fail_phone" };
  }
  if (target.ipHash) {
    const fails = await countEvents({ type: "otp_verify_fail", ipHash: target.ipHash }, HOUR_MS);
    if (fails >= 8) return { ok: false, reason: "verify_fail_ip" };
  }
  return { ok: true };
}
