import { db } from "@/lib/db";

/**
 * DB-backed sliding-window rate limits for the OTP endpoints. Counting
 * AuthVerificationEvent rows (which are written on EVERY attempt, allowed
 * or not) gives one shared truth across instances - no Redis needed, and
 * the audit trail and the limiter can never disagree.
 *
 * Policy as shipped:
 *  - Sends (email + phone): escalating resend cooldown 30s -> 60s -> 120s
 *    (then 120s), max 5 sends per identifier per hour. Blocked sends do
 *    NOT extend the cooldown - only real sends count.
 *  - Email sends additionally: max 10/hour per IP hash (across emails).
 *  - Verifies: 5 invalid attempts per identifier (or per IP) within 15
 *    minutes -> locked for 15 minutes. Locked attempts are audited as
 *    otp_verify_locked, which does NOT count as a fail, so the lock
 *    expires 15 minutes after the 5th failure.
 */

const HOUR_MS = 60 * 60 * 1000;

/** Cooldown (seconds) that follows the nth send in the hour; 4th+ repeats 120. */
export const RESEND_LADDER_SECONDS = [30, 60, 120] as const;
/** Hard cap on sends per identifier per hour (email or phone). */
export const MAX_SENDS_PER_HOUR = 5;
/** Invalid verify attempts within the window that trigger the lock. */
export const VERIFY_LOCK_MAX_FAILS = 5;
/** Sliding window (and lock duration) for verify failures. */
export const VERIFY_LOCK_WINDOW_MS = 15 * 60 * 1000;

/** Cooldown in seconds after the nth send (n >= 1). */
function ladderCooldown(n: number): number {
  return RESEND_LADDER_SECONDS[Math.min(n, RESEND_LADDER_SECONDS.length) - 1];
}

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

export type ResendCooldownResult = {
  /** May a code be sent right now? */
  allowed: boolean;
  /**
   * Seconds until the NEXT send unlocks: when blocked, the remaining wait;
   * when allowed, the cooldown that will follow the send about to happen.
   * Always safe to hand to the client - it never reveals whether the send
   * actually happened.
   */
  retryAfter: number;
};

/** Audit event type that counts as a "real send" for each flow. */
const SEND_EVENT_TYPE = {
  email: "email_otp_send",
  phone: "phone_otp_send",
  // Anonymous phone LOGIN - counted separately from phone-change sends so
  // the two flows never consume each other's budget.
  phone_login: "auth_phone_code_sent",
} as const;

/**
 * Server-authoritative escalating resend policy for one identifier.
 * Looks at real send events in the last hour: after the nth send the
 * cooldown is RESEND_LADDER_SECONDS[n-1] (120s from the 3rd on), and the
 * 6th send inside an hour is blocked outright (MAX_SENDS_PER_HOUR).
 */
export async function resendCooldown(
  kind: keyof typeof SEND_EVENT_TYPE,
  identifier: string,
): Promise<ResendCooldownResult> {
  const now = Date.now();
  const sends = await db.authVerificationEvent.findMany({
    where: {
      type: SEND_EVENT_TYPE[kind],
      ...(kind === "email" ? { email: identifier.toLowerCase() } : { phoneE164: identifier }),
      createdAt: { gte: new Date(now - HOUR_MS) },
    },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
    take: MAX_SENDS_PER_HOUR,
  });
  const n = sends.length;

  // Hourly cap: unlocks when the oldest of the last MAX sends ages out.
  if (n >= MAX_SENDS_PER_HOUR) {
    const anchor = sends[MAX_SENDS_PER_HOUR - 1].createdAt.getTime();
    return {
      allowed: false,
      retryAfter: Math.max(1, Math.ceil((anchor + HOUR_MS - now) / 1000)),
    };
  }

  if (n > 0) {
    const unlockAt = sends[0].createdAt.getTime() + ladderCooldown(n) * 1000;
    if (now < unlockAt) {
      return { allowed: false, retryAfter: Math.max(1, Math.ceil((unlockAt - now) / 1000)) };
    }
  }

  return { allowed: true, retryAfter: ladderCooldown(n + 1) };
}

/** Email OTP sends: max 10/hour per IP hash (across all addresses). */
export async function checkOtpSendIpLimit(ipHash: string | null): Promise<OtpLimitResult> {
  if (!ipHash) return { ok: true };
  const byIp = await countEvents({ type: "email_otp_send", ipHash }, HOUR_MS);
  if (byIp >= 10) return { ok: false, reason: "ip_hourly" };
  return { ok: true };
}

/** Anonymous phone-login sends: max 10/hour per IP hash (across numbers). */
export async function checkPhoneLoginSendIpLimit(ipHash: string | null): Promise<OtpLimitResult> {
  if (!ipHash) return { ok: true };
  const byIp = await countEvents({ type: "auth_phone_code_sent", ipHash }, HOUR_MS);
  if (byIp >= 10) return { ok: false, reason: "ip_hourly" };
  return { ok: true };
}

/**
 * Phone-LOGIN failure lock: same policy as checkOtpVerifyBlocked (5
 * invalid attempts per number or per IP within 15 minutes -> locked 15
 * minutes) but counted over auth_phone_code_failed events, so login
 * failures and phone-change failures never extend each other's locks.
 * Locked attempts are audited as auth_phone_code_locked (not counted).
 */
export async function checkPhoneLoginVerifyBlocked(target: {
  phoneE164: string;
  ipHash?: string | null;
}): Promise<OtpLimitResult> {
  const byPhone = await countEvents(
    { type: "auth_phone_code_failed", phoneE164: target.phoneE164 },
    VERIFY_LOCK_WINDOW_MS,
  );
  if (byPhone >= VERIFY_LOCK_MAX_FAILS) return { ok: false, reason: "verify_locked_phone" };
  if (target.ipHash) {
    const byIp = await countEvents(
      { type: "auth_phone_code_failed", ipHash: target.ipHash },
      VERIFY_LOCK_WINDOW_MS,
    );
    if (byIp >= VERIFY_LOCK_MAX_FAILS) return { ok: false, reason: "verify_locked_ip" };
  }
  return { ok: true };
}

/**
 * Failure lock: 5 invalid attempts per identifier (or per IP) within 15
 * minutes -> verification locked for 15 minutes. Sliding window over
 * otp_verify_fail events; the lock ends when the 5th-newest failure ages
 * past the window (locked attempts are recorded as otp_verify_locked and
 * do not extend it).
 */
export async function checkOtpVerifyBlocked(target: {
  email?: string;
  phoneE164?: string;
  ipHash?: string | null;
}): Promise<OtpLimitResult> {
  if (target.email) {
    const fails = await countEvents(
      { type: "otp_verify_fail", email: target.email.toLowerCase() },
      VERIFY_LOCK_WINDOW_MS,
    );
    if (fails >= VERIFY_LOCK_MAX_FAILS) return { ok: false, reason: "verify_locked_email" };
  }
  if (target.phoneE164) {
    const fails = await countEvents(
      { type: "otp_verify_fail", phoneE164: target.phoneE164 },
      VERIFY_LOCK_WINDOW_MS,
    );
    if (fails >= VERIFY_LOCK_MAX_FAILS) return { ok: false, reason: "verify_locked_phone" };
  }
  if (target.ipHash) {
    const fails = await countEvents(
      { type: "otp_verify_fail", ipHash: target.ipHash },
      VERIFY_LOCK_WINDOW_MS,
    );
    if (fails >= VERIFY_LOCK_MAX_FAILS) return { ok: false, reason: "verify_locked_ip" };
  }
  return { ok: true };
}
