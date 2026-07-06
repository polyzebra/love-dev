import { db } from "@/lib/db";
import { env } from "@/lib/env";
import type { PlanTier, SubscriptionStatus } from "@/generated/prisma/enums";

/**
 * Stripe webhook receiver.
 *
 * Signature verification uses the raw body + STRIPE_WEBHOOK_SECRET. The
 * official `stripe` SDK slot-in: `stripe.webhooks.constructEvent(raw, sig, secret)`.
 * Until keys are configured the endpoint acknowledges but does nothing.
 */

type StripeEvent = {
  id: string;
  type: string;
  data: {
    object: {
      id: string;
      customer?: string;
      status?: string;
      metadata?: Record<string, string>;
      current_period_end?: number;
      cancel_at_period_end?: boolean;
      items?: { data?: { price?: { lookup_key?: string } }[] };
      amount_total?: number;
      currency?: string;
      hosted_invoice_url?: string;
    };
  };
};

const TIER_BY_LOOKUP_KEY: Record<string, PlanTier> = {
  amora_plus_monthly: "PLUS",
  amora_premium_monthly: "PREMIUM",
};

function mapStatus(status?: string): SubscriptionStatus {
  switch (status) {
    case "active":
      return "ACTIVE";
    case "trialing":
      return "TRIALING";
    case "past_due":
      return "PAST_DUE";
    case "canceled":
      return "CANCELED";
    case "incomplete":
    case "incomplete_expired":
      return "INCOMPLETE";
    default:
      return "EXPIRED";
  }
}

export async function POST(req: Request) {
  const signature = req.headers.get("stripe-signature");
  const raw = await req.text();

  if (!env.STRIPE_WEBHOOK_SECRET || !signature) {
    // Not configured — acknowledge so Stripe CLI testing doesn't retry-spam
    return Response.json({ received: true, configured: false });
  }

  // TODO(payments): verify with stripe.webhooks.constructEvent(raw, signature, secret)
  let event: StripeEvent;
  try {
    event = JSON.parse(raw) as StripeEvent;
  } catch {
    return new Response("Invalid payload", { status: 400 });
  }

  const object = event.data.object;
  const userId = object.metadata?.userId;

  switch (event.type) {
    case "customer.subscription.created":
    case "customer.subscription.updated": {
      if (!userId) break;
      const lookupKey = object.items?.data?.[0]?.price?.lookup_key ?? "";
      await db.subscription.upsert({
        where: { userId },
        create: {
          userId,
          tier: TIER_BY_LOOKUP_KEY[lookupKey] ?? "PLUS",
          status: mapStatus(object.status),
          provider: "STRIPE",
          providerCustomerId: object.customer,
          providerSubId: object.id,
          currentPeriodEnd: object.current_period_end
            ? new Date(object.current_period_end * 1000)
            : null,
          cancelAtPeriodEnd: object.cancel_at_period_end ?? false,
        },
        update: {
          tier: TIER_BY_LOOKUP_KEY[lookupKey] ?? undefined,
          status: mapStatus(object.status),
          providerSubId: object.id,
          currentPeriodEnd: object.current_period_end
            ? new Date(object.current_period_end * 1000)
            : null,
          cancelAtPeriodEnd: object.cancel_at_period_end ?? false,
        },
      });
      break;
    }
    case "customer.subscription.deleted": {
      if (!userId) break;
      await db.subscription.updateMany({
        where: { userId },
        data: { tier: "FREE", status: "CANCELED" },
      });
      break;
    }
    case "checkout.session.completed": {
      if (!userId) break;
      await db.payment.create({
        data: {
          userId,
          provider: "STRIPE",
          providerPaymentId: object.id,
          amountCents: object.amount_total ?? 0,
          currency: object.currency ?? "eur",
          status: "SUCCEEDED",
          description: "Subscription checkout",
          invoiceUrl: object.hosted_invoice_url,
        },
      });
      break;
    }
  }

  return Response.json({ received: true });
}
