import { clientIp, guardRate } from "@/lib/api";
import { env } from "@/lib/env";
import { verifyStripeSignature } from "@/lib/webhook-signatures";
import { stripeConfigured } from "@/lib/stripe";
import { processStripeEvent, type StripeWebhookEvent } from "@/lib/services/billing";

/**
 * POST /api/webhooks/stripe - the ONLY producer of premium entitlements.
 *
 * Stance (same as the verification/email webhooks):
 *  1. RAW body first - the signature is verified over the exact bytes
 *     BEFORE any JSON.parse (T&S security audit 2026-07-11; Stripe's
 *     scheme is plain HMAC, see lib/webhook-signatures.ts).
 *  2. Secret configured => signatures are MANDATORY: unsigned, badly
 *     signed or replayed deliveries answer 400 and change NOTHING.
 *     Secret not configured => acknowledge and process NOTHING (Stripe
 *     CLI testing must not retry-spam, and unverified payloads must
 *     never write state).
 *  3. Idempotent processing behind the StripeEvent ledger; 2xx is sent
 *     ONLY after the handler finished, so Stripe's retries cover crashes.
 *  4. Refetch-latest: handlers never copy subscription fields from the
 *     event payload - services/billing.ts re-reads the subscription from
 *     Stripe, which also makes out-of-order deliveries harmless. That
 *     requires the API key: signature valid but STRIPE_SECRET_KEY absent
 *     answers 503 so Stripe retries once the deployment is fixed.
 */
export async function POST(req: Request) {
  const limited = await guardRate(`webhook-stripe:${clientIp(req)}`, {
    limit: 300,
    windowMs: 60_000,
  });
  if (limited) return limited;

  const signature = req.headers.get("stripe-signature");
  const raw = await req.text();

  if (!env.STRIPE_WEBHOOK_SECRET) {
    return Response.json({ received: true, configured: false });
  }
  if (!signature || !verifyStripeSignature(raw, signature, env.STRIPE_WEBHOOK_SECRET)) {
    return new Response("Invalid signature", { status: 400 });
  }
  if (!stripeConfigured()) {
    // Verified delivery but no API key to refetch state with - tell
    // Stripe to retry rather than acking an event we cannot apply.
    console.error(
      "[billing:webhook] STRIPE_WEBHOOK_SECRET is set but STRIPE_SECRET_KEY is not - cannot process events",
    );
    return new Response("Billing not configured", { status: 503 });
  }

  let event: StripeWebhookEvent;
  try {
    const parsed = JSON.parse(raw) as Partial<StripeWebhookEvent>;
    if (
      typeof parsed?.id !== "string" ||
      typeof parsed?.type !== "string" ||
      !parsed.data?.object
    ) {
      return new Response("Invalid payload", { status: 400 });
    }
    event = parsed as StripeWebhookEvent;
  } catch {
    return new Response("Invalid payload", { status: 400 });
  }

  try {
    const result = await processStripeEvent(event);
    return Response.json({ received: true, ...result });
  } catch (error) {
    // 5xx => Stripe retries; the ledger row stays unprocessed so the
    // retry runs the handler again.
    console.error(`[billing:webhook] processing ${event.type} (${event.id}) failed:`, error);
    return new Response("Processing failed", { status: 500 });
  }
}
