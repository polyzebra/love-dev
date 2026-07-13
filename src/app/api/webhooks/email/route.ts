import { NextResponse } from "next/server";
import { clientIp, guardRate } from "@/lib/api";
import { verifyEmailWebhookSignature } from "@/lib/services/email";
import { applyEmailProviderEvent } from "@/lib/services/notify";

export const dynamic = "force-dynamic";

/**
 * POST /api/webhooks/email - email provider delivery events (Resend).
 *
 * Pattern (same stance as /api/webhooks/verification):
 *  1. signature verification over the RAW body. Resend signs with Svix
 *     headers (svix-id / svix-timestamp / svix-signature) using
 *     RESEND_WEBHOOK_SECRET ("whsec_..."). Unsigned/badly-signed/replayed
 *     deliveries are 401 and change NOTHING; no secret configured = the
 *     endpoint fails CLOSED with 503.
 *  2. idempotent application: applyEmailProviderEvent no-ops when the
 *     delivery row is already in the target state - provider retries are
 *     safe (200 either way so they never error-loop).
 *  3. lifecycle: SENT -> DELIVERED | BOUNCED | COMPLAINED. Hard bounces and
 *     complaints put the recipient on the SuppressedEmail list - the outbox
 *     worker refuses future sends to that address.
 */
export async function POST(req: Request) {
  // Coarse flood guard in front of the crypto work. Keyed per IP; generous
  // enough for legitimate provider bursts.
  const limited = await guardRate(`webhook-email:${clientIp(req)}`, {
    limit: 300,
    windowMs: 60_000,
  });
  if (limited) return limited;

  const secret = process.env.RESEND_WEBHOOK_SECRET?.trim();
  if (!secret) {
    return NextResponse.json({ error: { code: "not_configured" } }, { status: 503 });
  }

  const rawBody = await req.text();
  const verified = verifyEmailWebhookSignature(
    rawBody,
    {
      svixId: req.headers.get("svix-id"),
      svixTimestamp: req.headers.get("svix-timestamp"),
      svixSignature: req.headers.get("svix-signature"),
    },
    secret,
  );
  if (!verified) {
    return NextResponse.json({ error: { code: "bad_signature" } }, { status: 401 });
  }

  let payload: { type?: unknown; data?: { email_id?: unknown; to?: unknown } };
  try {
    payload = JSON.parse(rawBody) as typeof payload;
  } catch {
    return NextResponse.json({ error: { code: "bad_payload" } }, { status: 400 });
  }
  const type = typeof payload.type === "string" ? payload.type : "";
  const messageId = typeof payload.data?.email_id === "string" ? payload.data.email_id : null;
  const to = Array.isArray(payload.data?.to)
    ? (payload.data.to.find((t): t is string => typeof t === "string") ?? null)
    : typeof payload.data?.to === "string"
      ? payload.data.to
      : null;
  if (!messageId) {
    // Signed but shapeless (e.g. an event type without an email id) - ack so
    // the provider stops retrying; nothing to apply.
    return NextResponse.json({ ok: true, applied: false, reason: "no_message_id" });
  }

  const result = await applyEmailProviderEvent(type, messageId, to);
  return NextResponse.json({
    ok: true,
    applied: result.applied,
    ...(result.applied ? {} : { reason: result.reason }),
  });
}
