import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Shared webhook signature primitives (Svix-style verification for email
 * lives in services/email.ts next to its provider; Stripe's plain-HMAC
 * scheme lives here so the route file exports only route handlers).
 */

export const STRIPE_SIGNATURE_TOLERANCE_S = 5 * 60;

/**
 * Verify a Stripe-Signature header over the RAW body: header
 * "t=<ts>,v1=<hex>[,v1=...]", signed payload "<ts>.<raw>", HMAC-SHA256
 * with the webhook secret. Constant-time compare + replay tolerance.
 */
export function verifyStripeSignature(
  rawBody: string,
  header: string,
  secret: string,
  now: Date = new Date(),
): boolean {
  const parts = new Map<string, string[]>();
  for (const piece of header.split(",")) {
    const [k, v] = piece.split("=", 2);
    if (!k || !v) continue;
    const list = parts.get(k.trim()) ?? [];
    list.push(v.trim());
    parts.set(k.trim(), list);
  }
  const timestamp = Number(parts.get("t")?.[0]);
  if (!Number.isFinite(timestamp)) return false;
  if (Math.abs(now.getTime() / 1000 - timestamp) > STRIPE_SIGNATURE_TOLERANCE_S) return false;

  const expected = createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
  const expectedBuf = Buffer.from(expected, "utf8");
  for (const candidate of parts.get("v1") ?? []) {
    const buf = Buffer.from(candidate, "utf8");
    if (buf.length === expectedBuf.length && timingSafeEqual(buf, expectedBuf)) return true;
  }
  return false;
}

/** Constant-time equality for shared-secret headers (never `!==`). */
export function secretsEqual(given: string | null, expected: string): boolean {
  if (!given) return false;
  const a = Buffer.from(given, "utf8");
  const b = Buffer.from(expected, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}
