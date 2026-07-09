import { createHash } from "node:crypto";
import { db } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";

/**
 * Auth audit trail. Every OTP send/verify (including rejected ones) is
 * recorded as an AuthVerificationEvent - the same rows power the
 * DB-backed rate limiter, so recording is NOT optional side channel
 * fluff, it is the enforcement data.
 *
 * PII discipline: raw IPs and user agents are never stored - only
 * salted SHA-256 hashes, enough to correlate abuse without keeping
 * network identifiers around.
 */

const DEV_FALLBACK_SALT = "tirvea-dev-salt-do-not-use-in-prod";
let warnedAboutSalt = false;

function hashSalt(): string {
  const salt = process.env.AUTH_HASH_SALT;
  if (salt && salt.trim().length > 0) return salt.trim();
  if (!warnedAboutSalt) {
    warnedAboutSalt = true;
    console.warn(
      "[auth:audit] AUTH_HASH_SALT is not set - using the dev fallback salt. Set it in production.",
    );
  }
  return DEV_FALLBACK_SALT;
}

export function sha256Hash(value: string): string {
  return createHash("sha256").update(`${hashSalt()}:${value}`).digest("hex");
}

/** First hop of x-forwarded-for = the client, per Vercel/most proxies. */
export function clientIpFrom(req: Request): string | null {
  const fwd = req.headers.get("x-forwarded-for");
  const first = fwd?.split(",")[0]?.trim();
  return first && first.length > 0 ? first : null;
}

export function ipHashFrom(req: Request): string | null {
  const ip = clientIpFrom(req);
  return ip ? sha256Hash(ip) : null;
}

export function userAgentHashFrom(req: Request): string | null {
  const ua = req.headers.get("user-agent");
  return ua ? sha256Hash(ua) : null;
}

export type AuthEventType =
  | "email_otp_send"
  | "email_otp_send_limited"
  | "email_otp_send_disposable"
  | "email_otp_verify"
  | "phone_otp_send"
  | "phone_otp_send_limited"
  | "phone_otp_send_conflict"
  | "phone_otp_verify"
  | "otp_verify_fail"
  | "risk_phone_challenge"
  | (string & {});

/**
 * Record an auth event. Never throws - audit failure must not break the
 * auth flow - but it is always logged.
 */
export async function recordAuthEvent(entry: {
  type: AuthEventType;
  email?: string | null;
  phoneE164?: string | null;
  userId?: string | null;
  req?: Request;
  metadata?: Prisma.InputJsonValue;
}): Promise<void> {
  try {
    await db.authVerificationEvent.create({
      data: {
        type: entry.type,
        email: entry.email?.toLowerCase() ?? null,
        phoneE164: entry.phoneE164 ?? null,
        userId: entry.userId ?? null,
        ipHash: entry.req ? ipHashFrom(entry.req) : null,
        userAgentHash: entry.req ? userAgentHashFrom(entry.req) : null,
        metadata: entry.metadata ?? {},
      },
    });
  } catch (error) {
    console.error(`[auth:audit] failed to record ${entry.type}:`, error);
  }
}
