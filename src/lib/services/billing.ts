import { db } from "@/lib/db";
import { siteUrl } from "@/lib/auth/url";
import { PLANS, planRank } from "@/lib/constants";
import {
  getStripeClient,
  planForPriceId,
  stripeConfigured,
  stripePriceIdFor,
  validateStripeEnvStatic,
  StripeApiError,
  type PaidPlan,
  type StripeCheckoutSession,
  type StripeInvoice,
  type StripeSubscription,
} from "@/lib/stripe";
import type { PaymentStatus, PlanTier, SubscriptionStatus } from "@/generated/prisma/enums";

/**
 * Canonical Stripe subscription lifecycle - the ONE place billing state
 * changes. Entry points, one truth:
 *
 *   startCheckout()          creates a Checkout Session (CHECKOUT_PENDING)
 *   changePlan()             in-place upgrade of an EXISTING subscription
 *                            (Stripe subscription update - never a second
 *                            subscription)
 *   resumeSubscription()     clears cancel_at_period_end on the EXISTING
 *                            subscription (undo a scheduled cancellation)
 *   retryPayment()           attempts collection of the open invoice
 *                            behind a PAST_DUE subscription
 *   syncStripeSubscription() refetch-latest sync, used by the webhook,
 *                            checkout-status reconciliation AND the
 *                            billing page (reconcileBilling)
 *   reconcileBilling()       page-load freshness: Stripe is the source of
 *                            truth, the local row is a cache - portal
 *                            cancellations/resumes show up even before
 *                            their webhook lands
 *   processStripeEvent()     idempotent webhook dispatch (StripeEvent ledger)
 *
 * Security invariants (asserted by tests/billing.test.ts):
 *  - the browser never supplies a price id, status, or customer id
 *  - visiting a success_url grants NOTHING - entitlements change only
 *    after verified Stripe state is persisted here
 *  - unknown price ids never grant a paid tier
 *  - one Stripe customer <-> one user (unique providerCustomerId)
 *  - a foreign session_id answers not_found (no enumeration)
 *
 * Out-of-order webhook safety: handlers never write fields from the event
 * payload - every event triggers a fresh retrieve of the subscription
 * from Stripe ("refetch-latest"), so a delayed `created` arriving after
 * `updated` still persists the newest state.
 */

export class BillingError extends Error {
  constructor(
    public readonly code:
      | "billing_unavailable"
      | "already_subscribed"
      | "no_customer"
      | "no_subscription"
      | "invalid_plan_change"
      | "payment_past_due"
      | "upgrade_pending"
      | "not_ending"
      | "no_open_invoice"
      | "payment_failed"
      | "not_found",
    message: string,
  ) {
    super(message);
    this.name = "BillingError";
  }
}

/** HTTP status per domain error - kept here so routes stay thin. */
export const BILLING_ERROR_STATUS: Record<BillingError["code"], number> = {
  billing_unavailable: 503,
  already_subscribed: 409,
  no_customer: 409,
  no_subscription: 409,
  invalid_plan_change: 409,
  payment_past_due: 409,
  upgrade_pending: 409,
  not_ending: 409,
  no_open_invoice: 409,
  payment_failed: 402,
  not_found: 404,
};

// Statuses that mean "this user already has a live subscription" - a new
// checkout would create a duplicate Stripe subscription. PAST_DUE is
// included on purpose: the fix for a failed payment is the portal, not a
// second subscription.
const LIVE_SUB_STATUSES: SubscriptionStatus[] = ["ACTIVE", "TRIALING", "PAST_DUE"];

/**
 * "Does this row hold a live Stripe subscription?" - the shared predicate
 * behind duplicate-checkout prevention AND every UI decision about which
 * upgrade path to offer (checkout vs in-place plan change). Pages import
 * THIS instead of re-deriving the status list.
 */
export function hasLiveSubscription<T extends { tier: PlanTier; status: SubscriptionStatus }>(
  row: T | null,
): row is T {
  return !!row && row.tier !== "FREE" && LIVE_SUB_STATUSES.includes(row.status);
}

function requireClient() {
  const client = getStripeClient();
  if (!client) {
    throw new BillingError(
      "billing_unavailable",
      "Payments are not configured on this deployment.",
    );
  }
  return client;
}

let loggedEnvProblems = false;
function logEnvProblemsOnce() {
  if (loggedEnvProblems) return;
  const report = validateStripeEnvStatic();
  if (report.problems.length > 0) {
    console.error("[billing:env] Stripe configuration problems:", report.problems);
  }
  loggedEnvProblems = true;
}

// ---------------------------------------------------------------------------
// Checkout
// ---------------------------------------------------------------------------

/** Double-tap window: identical user+plan requests inside it share one Stripe idempotency key, so Stripe returns the SAME session instead of minting duplicates. */
const CHECKOUT_IDEMPOTENCY_WINDOW_MS = 60_000;

export function checkoutIdempotencyKey(userId: string, plan: PaidPlan, now = Date.now()): string {
  return `checkout_${userId}_${plan}_${Math.floor(now / CHECKOUT_IDEMPOTENCY_WINDOW_MS)}`;
}

export type StartCheckoutResult = { url: string; sessionId: string };

export async function startCheckout(
  userId: string,
  plan: PaidPlan,
  email?: string | null,
): Promise<StartCheckoutResult> {
  const client = requireClient();
  logEnvProblemsOnce();
  const priceId = stripePriceIdFor(plan);
  if (!priceId) {
    throw new BillingError(
      "billing_unavailable",
      `The ${plan} plan is not configured on this deployment.`,
    );
  }

  let row = await db.subscription.findUnique({ where: { userId } });
  if (row && row.tier !== "FREE" && LIVE_SUB_STATUSES.includes(row.status)) {
    // UI: point the user at the billing portal to change plans instead.
    throw new BillingError("already_subscribed", "You already have an active subscription.");
  }

  // Customer reuse: one Stripe customer per user, forever. The unique
  // constraint on providerCustomerId makes cross-user reuse impossible;
  // a lost race here only orphans a never-charged Stripe customer.
  let customerId = row?.providerCustomerId ?? null;
  if (!customerId) {
    const customer = await client.createCustomer({ email, metadata: { userId } });
    row = await db.subscription.upsert({
      where: { userId },
      create: { userId, tier: "FREE", status: "ACTIVE", providerCustomerId: customer.id },
      update: {}, // never clobber a concurrently-claimed customer id
    });
    if (!row.providerCustomerId) {
      await db.subscription.updateMany({
        where: { userId, providerCustomerId: null },
        data: { providerCustomerId: customer.id },
      });
      row = await db.subscription.findUniqueOrThrow({ where: { userId } });
    }
    customerId = row.providerCustomerId;
    if (!customerId) {
      throw new BillingError("billing_unavailable", "Could not establish a billing customer.");
    }
  }

  const base = siteUrl();
  const session = await client.createCheckoutSession({
    customer: customerId,
    priceId,
    // {CHECKOUT_SESSION_ID} is substituted by Stripe, not by us.
    successUrl: `${base}/settings/subscription/confirm?session_id={CHECKOUT_SESSION_ID}`,
    cancelUrl: `${base}/pricing?checkout=cancelled`,
    metadata: { userId, plan },
    subscriptionMetadata: { userId, plan },
    idempotencyKey: checkoutIdempotencyKey(userId, plan),
  });
  if (!session.url) {
    throw new BillingError("billing_unavailable", "Stripe did not return a checkout URL.");
  }

  // Bookkeeping only - CHECKOUT_PENDING grants nothing. Guarded so a
  // webhook landing between session creation and this write (sub already
  // ACTIVE) is never overwritten.
  await db.subscription.updateMany({
    where: { userId, status: { notIn: ["ACTIVE", "TRIALING"] } },
    data: { status: "CHECKOUT_PENDING", checkoutSessionId: session.id },
  });
  await db.subscription.updateMany({
    where: { userId, status: "ACTIVE", tier: "FREE" },
    data: { status: "CHECKOUT_PENDING", checkoutSessionId: session.id },
  });

  return { url: session.url, sessionId: session.id };
}

// ---------------------------------------------------------------------------
// In-place plan change (upgrade) - Stripe subscription UPDATE, never a
// second subscription
// ---------------------------------------------------------------------------

/**
 * Proration policy for in-place upgrades: `always_invoice` raises the
 * prorated difference as an invoice NOW and attempts collection NOW.
 * NEVER `create_prorations` for paid upgrades - that grants the new plan
 * immediately and defers the charge to the next cycle (the exact bug
 * behind the free-Gold incident).
 */
export const PLAN_CHANGE_PRORATION_BEHAVIOR = "always_invoice" as const;

/**
 * `pending_if_incomplete` makes Stripe itself the payment gate: the
 * subscription KEEPS the old price and parks the proposed change in
 * pending_update until the upgrade invoice is PAID. A failed or
 * abandoned payment expires the update and nothing ever changed.
 */
export const PLAN_CHANGE_PAYMENT_BEHAVIOR = "pending_if_incomplete" as const;

/**
 * STABLE per upgrade ATTEMPT: subscription + from-price + to-price +
 * the subscription's latest_invoice at attempt time. A double-tap (or a
 * lost-response retry) sees the same latest_invoice and replays the SAME
 * Stripe request - one update, one invoice. A genuinely new attempt
 * (after a declined/expired one settled a new latest invoice) gets a new
 * key, so a fixed card is never answered with a replayed decline.
 */
export function planChangeIdempotencyKey(
  subscriptionId: string,
  fromPriceId: string,
  toPriceId: string,
  latestInvoiceRef: string,
): string {
  return `planchange_${subscriptionId}_${fromPriceId}_${toPriceId}_${latestInvoiceRef}`;
}

/**
 * The change-plan contract: the caller learns EXACTLY what happened to
 * the money, never a generic success.
 *
 *  PAID_AND_APPLIED  upgrade invoice collected; new plan is live
 *  ZERO_DUE_APPLIED  Stripe confirmed nothing was owed; new plan is live
 *  REQUIRES_ACTION   card authentication needed - clientSecret drives
 *                    Stripe.js; plan is UNCHANGED until it succeeds
 *  PENDING           payment processing at Stripe; plan UNCHANGED so far
 *  PAYMENT_FAILED    collection failed; plan UNCHANGED
 */
export type ChangePlanResult = {
  outcome:
    "PAID_AND_APPLIED" | "ZERO_DUE_APPLIED" | "REQUIRES_ACTION" | "PENDING" | "PAYMENT_FAILED";
  /** The plan the user actually holds NOW (per persisted verified state). */
  plan: PlanTier;
  status: SubscriptionStatus;
  /** Only for REQUIRES_ACTION; owner-only, never logged. */
  clientSecret?: string;
};

/**
 * Upgrade an EXISTING live subscription to a higher tier from inside the
 * product - the user never has to discover plan changes in the Stripe
 * portal. Invariants:
 *
 *  - UPDATE, never CREATE: the existing subscription item's price is
 *    replaced in place, so no second subscription (or Stripe customer)
 *    can ever appear and the billing cycle anchor is preserved.
 *  - upgrades only: the target must rank strictly ABOVE the current tier
 *    in the canonical FREE < PLUS < GOLD hierarchy (downgrades and
 *    cancellation stay in the portal, where Stripe explains the credit).
 *  - no live subscription -> no_subscription: the caller should send the
 *    user through checkout instead (the exact mirror of startCheckout's
 *    already_subscribed guard).
 *  - PAST_DUE -> payment_past_due: fixing the payment method comes first;
 *    stacking a prorated upgrade on a failing card only deepens dunning.
 *  - persistence happens through syncStripeSubscription (refetch-latest),
 *    the same single write path the webhook uses - the concurrently
 *    arriving customer.subscription.updated event is a harmless no-op.
 */
/**
 * Shared guards for preview AND execution of an upgrade. Loads the
 * user's canonical customer/subscription, verifies ownership against the
 * stored mapping, and refuses every state in which charging would be
 * wrong: no live subscription, past-due/unpaid/incomplete (fresh Stripe
 * status, not just the cached row), non-upgrades, and an upgrade that is
 * ALREADY awaiting payment (pending_update) - which also serves as the
 * concurrency lock across devices.
 */
async function loadUpgradeContext(userId: string, plan: PaidPlan) {
  const client = requireClient();
  logEnvProblemsOnce();
  const priceId = stripePriceIdFor(plan);
  if (!priceId) {
    throw new BillingError(
      "billing_unavailable",
      `The ${plan} plan is not configured on this deployment.`,
    );
  }

  const row = await db.subscription.findUnique({ where: { userId } });
  if (!hasLiveSubscription(row)) {
    throw new BillingError(
      "no_subscription",
      "You don't have an active subscription to change - start a checkout instead.",
    );
  }
  if (row.status === "PAST_DUE") {
    throw new BillingError(
      "payment_past_due",
      "Your last payment didn't go through. Update your payment method in billing first.",
    );
  }
  if (planRank(plan) <= planRank(row.tier)) {
    throw new BillingError(
      "invalid_plan_change",
      plan === row.tier
        ? "You're already on this plan."
        : "Only upgrades happen here - downgrades and cancellation live in billing.",
    );
  }
  if (!row.providerSubId || !row.providerCustomerId) {
    throw new BillingError(
      "no_subscription",
      "We couldn't find your subscription. Please contact support.",
    );
  }

  let sub: StripeSubscription;
  try {
    sub = await client.retrieveSubscriptionPaymentState(row.providerSubId);
  } catch (error) {
    if (error instanceof StripeApiError && error.status === 404) {
      throw new BillingError(
        "no_subscription",
        "Your subscription could not be found at Stripe. Please contact support.",
      );
    }
    throw error;
  }
  if (sub.customer !== row.providerCustomerId) {
    // Cross-customer subscription id - same refusal as syncStripeSubscription.
    console.error(
      `[billing:change-plan] subscription ${sub.id} belongs to ${sub.customer}, not ${row.providerCustomerId} - refusing`,
    );
    throw new BillingError("no_subscription", "Your subscription could not be verified.");
  }
  // Fresh Stripe status beats the cached row: never start a paid upgrade
  // on a subscription that already owes money.
  if (["past_due", "unpaid", "incomplete"].includes(sub.status)) {
    throw new BillingError(
      "payment_past_due",
      "Your subscription has an outstanding payment. Settle it in billing first.",
    );
  }
  if (sub.pending_update) {
    throw new BillingError(
      "upgrade_pending",
      "A plan change is already awaiting payment confirmation - finish or let it expire first.",
    );
  }
  const item = sub.items?.data?.[0];
  if (!item?.id) {
    throw new BillingError(
      "no_subscription",
      "Your subscription has no billable item. Please contact support.",
    );
  }

  return {
    client,
    row,
    sub,
    itemId: item.id,
    // Snapshot BOTH attempt discriminators at the same read: the price
    // being replaced and the latest invoice at attempt time.
    fromPriceId: item.price?.id ?? "unknown",
    latestInvoiceRef:
      typeof sub.latest_invoice === "string"
        ? sub.latest_invoice
        : (sub.latest_invoice?.id ?? "none"),
    priceId,
  };
}

export async function changePlan(userId: string, plan: PaidPlan): Promise<ChangePlanResult> {
  const { client, row, sub, itemId, fromPriceId, latestInvoiceRef, priceId } =
    await loadUpgradeContext(userId, plan);

  if (fromPriceId === priceId) {
    // A concurrent identical request already applied this upgrade at
    // Stripe (the DB row simply hadn't synced yet) - sync and report,
    // never re-apply and never re-charge.
    const synced = await syncStripeSubscription({
      stripeCustomerId: row.providerCustomerId!,
      stripeSubscriptionId: sub.id,
      sourceEventId: `planchange-race:${sub.id}`,
    });
    return {
      outcome: "ZERO_DUE_APPLIED",
      plan: synced?.tier ?? row.tier,
      status: synced?.status ?? row.status,
    };
  }

  const updated = await client.updateSubscriptionPrice({
    subscriptionId: sub.id,
    itemId,
    priceId,
    prorationBehavior: PLAN_CHANGE_PRORATION_BEHAVIOR,
    paymentBehavior: PLAN_CHANGE_PAYMENT_BEHAVIOR,
    idempotencyKey: planChangeIdempotencyKey(sub.id, fromPriceId, priceId, latestInvoiceRef),
  });

  // What did Stripe actually do with the money?
  const newPriceId = updated.items?.data?.[0]?.price?.id ?? null;
  const invoice =
    updated.latest_invoice && typeof updated.latest_invoice === "object"
      ? updated.latest_invoice
      : null;
  const paymentIntent =
    invoice?.payment_intent && typeof invoice.payment_intent === "object"
      ? invoice.payment_intent
      : null;

  // Persist through the ONE write path (refetch-latest). Under
  // pending_if_incomplete an unpaid change leaves the price - and
  // therefore the tier - unchanged, so nothing is ever granted early.
  const synced = await syncStripeSubscription({
    stripeCustomerId: row.providerCustomerId!,
    stripeSubscriptionId: sub.id,
    sourceEventId: `planchange:${sub.id}`,
  });
  const persisted = {
    plan: synced?.tier ?? row.tier,
    status: synced?.status ?? row.status,
  };

  // Settled upgrade invoices belong in payment history immediately
  // (paid, or attempted-and-failed). An authentication-pending invoice
  // is recorded once it settles (webhook / status endpoint / reconcile).
  if (
    invoice &&
    (invoice.status === "paid" ||
      paymentIntent?.status === "requires_payment_method" ||
      paymentIntent?.status === "canceled")
  ) {
    await recordInvoicePayment(userId, invoice);
  }

  if (newPriceId === priceId) {
    const amountDue = invoice?.amount_due ?? 0;
    const paid = invoice?.status === "paid";
    if (!paid && amountDue > 0) {
      // Defensive: pending_if_incomplete should make this impossible.
      console.error(
        `[billing:change-plan] price applied with UNPAID invoice ${invoice?.id} on ${sub.id} - reporting PENDING (audit)`,
      );
      return { outcome: "PENDING", ...persisted };
    }
    return {
      outcome: !invoice || amountDue === 0 ? "ZERO_DUE_APPLIED" : "PAID_AND_APPLIED",
      ...persisted,
    };
  }

  if (updated.pending_update) {
    switch (paymentIntent?.status) {
      case "requires_action":
      case "requires_confirmation":
        return {
          outcome: "REQUIRES_ACTION",
          ...persisted,
          ...(paymentIntent.client_secret ? { clientSecret: paymentIntent.client_secret } : {}),
        };
      case "requires_payment_method":
      case "canceled":
        return { outcome: "PAYMENT_FAILED", ...persisted };
      default:
        return { outcome: "PENDING", ...persisted };
    }
  }

  // Neither applied nor pending - report honestly, grant nothing.
  return { outcome: "PENDING", ...persisted };
}

// ---------------------------------------------------------------------------
// Upgrade preview - the exact Stripe proration, before any confirmation
// ---------------------------------------------------------------------------

export type ChangePlanPreview = {
  plan: PaidPlan;
  planName: string;
  /** Exactly what Stripe would collect NOW (always_invoice proration). */
  amountDueCents: number;
  currency: string;
  /** Tax portion when Stripe reports it; null when unavailable. */
  taxCents: number | null;
  /** The recurring price after the upgrade. */
  nextRecurringCents: number;
  /** The unchanged renewal date. */
  renewsAt: Date | null;
  /** Previews are estimates; the UI should re-preview after this. */
  expiresAt: Date;
};

/** How long a preview is presented as fresh before the UI re-previews. */
const PREVIEW_TTL_MS = 10 * 60_000;

/**
 * Preview the exact upgrade invoice via Stripe's create_preview - same
 * guards, same item, same price the real update would use. Nothing is
 * created or charged. The browser names a plan; every id and amount
 * comes from the server and Stripe.
 */
export async function previewChangePlan(
  userId: string,
  plan: PaidPlan,
): Promise<ChangePlanPreview> {
  const { client, row, sub, itemId, priceId } = await loadUpgradeContext(userId, plan);
  const preview = await client.previewSubscriptionUpdate({
    customerId: row.providerCustomerId!,
    subscriptionId: sub.id,
    itemId,
    priceId,
  });
  const target = PLANS.find((p) => p.tier === plan)!;
  return {
    plan,
    planName: target.name,
    amountDueCents: preview.amount_due ?? 0,
    currency: preview.currency ?? "eur",
    taxCents: typeof preview.tax === "number" ? preview.tax : null,
    nextRecurringCents: target.priceMonthlyCents,
    renewsAt: periodOf(sub).end,
    expiresAt: new Date(Date.now() + PREVIEW_TTL_MS),
  };
}

// ---------------------------------------------------------------------------
// Upgrade status - fresh Stripe truth for polling/reconciliation
// ---------------------------------------------------------------------------

export type ChangePlanStatusResult = {
  state: "ACTIVE_GOLD" | "STILL_PLUS" | "REQUIRES_ACTION" | "PAYMENT_FAILED" | "PENDING";
  plan: PlanTier;
  status: SubscriptionStatus;
  /** Only while authentication is still required; owner-only, never logged. */
  clientSecret?: string;
};

/**
 * Fresh-fetches the subscription WITH payment state from Stripe, syncs
 * it (so the DB can never disagree for long), and answers where the
 * upgrade stands. Never trusts the DB plan alone. State names follow the
 * Plus->Gold journey; semantically ACTIVE_GOLD = "target tier live",
 * STILL_PLUS = "previous tier unchanged".
 */
export async function changePlanStatus(userId: string): Promise<ChangePlanStatusResult> {
  const client = requireClient();
  const row = await db.subscription.findUnique({ where: { userId } });
  if (!row?.providerSubId || !row.providerCustomerId) {
    throw new BillingError("no_subscription", "No subscription to report on.");
  }
  const sub = await client.retrieveSubscriptionPaymentState(row.providerSubId);
  if (sub.customer !== row.providerCustomerId) {
    console.error(
      `[billing:status] subscription ${sub.id} belongs to ${sub.customer}, not ${row.providerCustomerId} - refusing`,
    );
    throw new BillingError("no_subscription", "Your subscription could not be verified.");
  }

  const synced = await syncStripeSubscription({
    stripeCustomerId: row.providerCustomerId,
    stripeSubscriptionId: sub.id,
    sourceEventId: `status:${sub.id}`,
  });
  const persisted = {
    plan: synced?.tier ?? row.tier,
    status: synced?.status ?? row.status,
  };

  if (sub.pending_update) {
    const invoice =
      sub.latest_invoice && typeof sub.latest_invoice === "object" ? sub.latest_invoice : null;
    const paymentIntent =
      invoice?.payment_intent && typeof invoice.payment_intent === "object"
        ? invoice.payment_intent
        : null;
    switch (paymentIntent?.status) {
      case "requires_action":
      case "requires_confirmation":
        return {
          state: "REQUIRES_ACTION",
          ...persisted,
          ...(paymentIntent.client_secret ? { clientSecret: paymentIntent.client_secret } : {}),
        };
      case "requires_payment_method":
      case "canceled":
        return { state: "PAYMENT_FAILED", ...persisted };
      default:
        return { state: "PENDING", ...persisted };
    }
  }

  const freshTier = planForPriceId(sub.items?.data?.[0]?.price?.id ?? null);
  if (freshTier === "GOLD" && ["active", "trialing"].includes(sub.status)) {
    return { state: "ACTIVE_GOLD", ...persisted };
  }
  return { state: "STILL_PLUS", ...persisted };
}

// ---------------------------------------------------------------------------
// Resume - clear a scheduled cancellation on the EXISTING subscription
// ---------------------------------------------------------------------------

export type ResumeResult = {
  plan: PlanTier;
  status: SubscriptionStatus;
  cancelAtPeriodEnd: boolean;
};

/**
 * Undo a scheduled cancellation (portal- or Stripe-side
 * cancel_at_period_end/cancel_at): one Stripe subscription UPDATE that
 * clears the flag on the SAME subscription - no new subscription, no new
 * customer, billing cycle untouched. Only valid while the subscription
 * is still alive and actually scheduled to end.
 */
export async function resumeSubscription(userId: string): Promise<ResumeResult> {
  const client = requireClient();
  const row = await db.subscription.findUnique({ where: { userId } });
  if (!hasLiveSubscription(row) || !row.providerSubId || !row.providerCustomerId) {
    throw new BillingError(
      "no_subscription",
      "There's no active subscription to resume - start a checkout instead.",
    );
  }

  let sub: StripeSubscription;
  try {
    sub = await client.retrieveSubscription(row.providerSubId);
  } catch (error) {
    if (error instanceof StripeApiError && error.status === 404) {
      throw new BillingError("no_subscription", "Your subscription could not be found at Stripe.");
    }
    throw error;
  }
  if (sub.customer !== row.providerCustomerId) {
    console.error(
      `[billing:resume] subscription ${sub.id} belongs to ${sub.customer}, not ${row.providerCustomerId} - refusing`,
    );
    throw new BillingError("no_subscription", "Your subscription could not be verified.");
  }
  if (sub.status === "canceled") {
    // Too late - the subscription already ended. The path back is checkout.
    await syncStripeSubscription({
      stripeCustomerId: row.providerCustomerId,
      stripeSubscriptionId: sub.id,
      sourceEventId: `resume-late:${sub.id}`,
    });
    throw new BillingError(
      "no_subscription",
      "That membership has already ended - you can start a new one anytime.",
    );
  }
  if (!sub.cancel_at_period_end && !sub.cancel_at) {
    throw new BillingError("not_ending", "Your membership isn't scheduled to end.");
  }

  await client.updateSubscriptionCancellation({
    subscriptionId: sub.id,
    cancelAtPeriodEnd: false,
    idempotencyKey: `resume_${userId}_${Math.floor(Date.now() / CHECKOUT_IDEMPOTENCY_WINDOW_MS)}`,
  });

  const updated = await syncStripeSubscription({
    stripeCustomerId: row.providerCustomerId,
    stripeSubscriptionId: sub.id,
    sourceEventId: `resume:${sub.id}`,
  });
  if (!updated) {
    throw new BillingError("no_subscription", "Your subscription could not be verified.");
  }
  return {
    plan: updated.tier,
    status: updated.status,
    cancelAtPeriodEnd: updated.cancelAtPeriodEnd,
  };
}

// ---------------------------------------------------------------------------
// Retry payment - collect the open invoice behind a PAST_DUE subscription
// ---------------------------------------------------------------------------

export type RetryPaymentResult = { plan: PlanTier; status: SubscriptionStatus };

/**
 * Attempt collection of the newest OPEN invoice with the saved payment
 * method. Success flows back through the same sync as the webhook (the
 * subscription returns to active); a declined card answers an honest
 * payment_failed - the fix is updating the card, and nothing is retried
 * behind the user's back.
 */
export async function retryPayment(userId: string): Promise<RetryPaymentResult> {
  const client = requireClient();
  const row = await db.subscription.findUnique({ where: { userId } });
  if (!row?.providerCustomerId) {
    throw new BillingError("no_customer", "No billing profile exists for this account yet.");
  }

  const open = await client.listInvoices(row.providerCustomerId, "open");
  const invoice = open[0];
  if (!invoice) {
    // Nothing outstanding - make sure the row reflects that.
    await syncStripeSubscription({
      stripeCustomerId: row.providerCustomerId,
      stripeSubscriptionId: row.providerSubId ?? null,
      sourceEventId: "retry-noop",
    });
    throw new BillingError("no_open_invoice", "There's no outstanding payment on your account.");
  }

  try {
    await client.payInvoice(
      invoice.id,
      `retrypay_${userId}_${invoice.id}_${Math.floor(Date.now() / CHECKOUT_IDEMPOTENCY_WINDOW_MS)}`,
    );
  } catch (error) {
    if (error instanceof StripeApiError && error.status < 500) {
      throw new BillingError(
        "payment_failed",
        "The payment didn't go through. Updating your payment method usually fixes this.",
      );
    }
    throw error;
  }

  const updated = await syncStripeSubscription({
    stripeCustomerId: row.providerCustomerId,
    stripeSubscriptionId: row.providerSubId ?? null,
    sourceEventId: `retrypay:${invoice.id}`,
  });
  await reconcileInvoicePayments(userId, row.providerCustomerId);
  return {
    plan: updated?.tier ?? row.tier,
    status: updated?.status ?? row.status,
  };
}

// ---------------------------------------------------------------------------
// Shared sync - webhook AND reconciliation call THIS
// ---------------------------------------------------------------------------

function mapStripeStatus(status: string | undefined): SubscriptionStatus {
  switch (status) {
    case "active":
      return "ACTIVE";
    case "trialing":
      return "TRIALING";
    case "past_due":
      return "PAST_DUE";
    case "canceled":
      return "CANCELED";
    case "unpaid":
      return "UNPAID";
    case "incomplete":
      return "INCOMPLETE";
    case "incomplete_expired":
      return "INCOMPLETE_EXPIRED";
    case "paused":
      return "PAUSED";
    default:
      // Unknown/new Stripe status: safest state grants no entitlements.
      return "UNPAID";
  }
}

const toDate = (epoch: number | null | undefined) =>
  typeof epoch === "number" ? new Date(epoch * 1000) : null;

/** Billing periods live on the subscription pre-basil and on the item after. */
function periodOf(sub: StripeSubscription): { start: Date | null; end: Date | null } {
  const item = sub.items?.data?.[0];
  return {
    start: toDate(sub.current_period_start ?? item?.current_period_start),
    end: toDate(sub.current_period_end ?? item?.current_period_end),
  };
}

export type SyncArgs = {
  stripeCustomerId: string;
  stripeSubscriptionId?: string | null;
  /** Diagnostics only - persisted as lastStripeEventId. */
  sourceEventId?: string | null;
};

/**
 * Fetch the LATEST subscription state from Stripe and persist it. The
 * user is found via the unique providerCustomerId mapping written at
 * checkout time - webhook metadata is never trusted for identity.
 * Returns the updated row, or null when the customer is unknown to us.
 */
export async function syncStripeSubscription(args: SyncArgs) {
  const client = requireClient();
  const row = await db.subscription.findUnique({
    where: { providerCustomerId: args.stripeCustomerId },
  });
  if (!row) {
    console.error(
      `[billing:sync] Stripe customer ${args.stripeCustomerId} has no local mapping - ignoring (event ${args.sourceEventId ?? "n/a"})`,
    );
    return null;
  }

  let sub: StripeSubscription | null = null;
  if (args.stripeSubscriptionId) {
    try {
      sub = await client.retrieveSubscription(args.stripeSubscriptionId);
    } catch (error) {
      if (!(error instanceof StripeApiError && error.status === 404)) throw error;
    }
  } else {
    const subs = await client.listSubscriptions(args.stripeCustomerId);
    const newestFirst = [...subs].sort((a, b) => (b.created ?? 0) - (a.created ?? 0));
    sub = newestFirst.find((s) => s.status !== "canceled") ?? newestFirst[0] ?? null;
  }

  if (!sub) {
    // Nothing at Stripe. If we previously tracked a subscription, it is
    // gone - drop to FREE. A pending checkout with no subscription yet
    // stays pending.
    if (row.providerSubId) {
      return db.subscription.update({
        where: { id: row.id },
        data: {
          tier: "FREE",
          status: "CANCELED",
          lastStripeEventId: args.sourceEventId ?? undefined,
          syncedAt: new Date(),
        },
      });
    }
    return row;
  }

  if (sub.customer !== args.stripeCustomerId) {
    // Cross-customer subscription id - never persist onto this user.
    console.error(
      `[billing:sync] subscription ${sub.id} belongs to ${sub.customer}, not ${args.stripeCustomerId} - refusing (event ${args.sourceEventId ?? "n/a"})`,
    );
    return null;
  }

  const priceId = sub.items?.data?.[0]?.price?.id ?? null;
  let tier: PlanTier = planForPriceId(priceId) ?? "FREE";
  if (priceId && tier === "FREE") {
    console.error(
      `[billing:sync] unknown price id ${priceId} on subscription ${sub.id} - granting NO paid tier (audit)`,
    );
  }
  const status = mapStripeStatus(sub.status);
  // A dead subscription confers no plan - the row keeps stripePriceId and
  // canceledAt as history, but tier goes FREE so every non-entitlement
  // reader (admin counts, settings) stays honest.
  if (status === "CANCELED" || status === "INCOMPLETE_EXPIRED") tier = "FREE";

  const period = periodOf(sub);
  return db.subscription.update({
    where: { id: row.id },
    data: {
      tier,
      status,
      providerSubId: sub.id,
      stripePriceId: priceId,
      currentPeriodStart: period.start,
      currentPeriodEnd: period.end,
      // cancel_at covers date-based cancellations; Stripe mirrors it when
      // cancel_at_period_end is set, so either means "scheduled to end".
      cancelAtPeriodEnd: (sub.cancel_at_period_end ?? false) || sub.cancel_at != null,
      canceledAt: toDate(sub.canceled_at),
      trialStart: toDate(sub.trial_start),
      trialEnd: toDate(sub.trial_end),
      lastStripeEventId: args.sourceEventId ?? undefined,
      syncedAt: new Date(),
    },
  });
}

// ---------------------------------------------------------------------------
// Checkout status (reconciliation - covers webhook delay)
// ---------------------------------------------------------------------------

export type CheckoutState = "ACTIVE" | "PENDING" | "FAILED" | "CANCELED" | "SESSION_INVALID";
export type CheckoutStatusResult = { state: CheckoutState; plan: PlanTier };

/**
 * Server-side truth for the confirm page. Ownership is mandatory: the
 * session must carry our metadata.userId for this user or belong to the
 * user's Stripe customer; anything else answers not_found so session ids
 * cannot be enumerated. When Stripe says the session completed, the SAME
 * sync as the webhook runs first - the answer is always derived from the
 * database, never from client-supplied state.
 */
export async function getCheckoutStatus(
  userId: string,
  sessionId: string,
): Promise<CheckoutStatusResult> {
  const client = requireClient();

  let session: StripeCheckoutSession;
  try {
    session = await client.retrieveCheckoutSession(sessionId);
  } catch (error) {
    if (error instanceof StripeApiError && error.status === 404) {
      throw new BillingError("not_found", "Checkout session not found.");
    }
    throw error;
  }

  const row = await db.subscription.findUnique({ where: { userId } });
  const ownsByMetadata = session.metadata?.userId === userId;
  const ownsByCustomer = Boolean(
    session.customer && row?.providerCustomerId && session.customer === row.providerCustomerId,
  );
  if (!ownsByMetadata && !ownsByCustomer) {
    throw new BillingError("not_found", "Checkout session not found.");
  }

  if (session.status === "expired") {
    await clearPendingCheckout(session.id);
    const fresh = await db.subscription.findUnique({ where: { userId } });
    return { state: "CANCELED", plan: entitledTier(fresh) };
  }

  if (session.status === "complete") {
    if (session.customer) {
      await syncStripeSubscription({
        stripeCustomerId: session.customer,
        stripeSubscriptionId: session.subscription ?? null,
        sourceEventId: `reconcile:${session.id}`,
      });
    }
    const fresh = await db.subscription.findUnique({ where: { userId } });
    if (
      fresh &&
      (fresh.status === "ACTIVE" || fresh.status === "TRIALING") &&
      fresh.tier !== "FREE"
    ) {
      return { state: "ACTIVE", plan: fresh.tier };
    }
    if (
      fresh &&
      ["INCOMPLETE", "INCOMPLETE_EXPIRED", "UNPAID", "PAST_DUE"].includes(fresh.status)
    ) {
      return { state: "FAILED", plan: entitledTier(fresh) };
    }
    // Completed at Stripe but no subscription surfaced yet.
    return { state: "PENDING", plan: entitledTier(fresh) };
  }

  if (session.status === "open") {
    const freshRow = row ?? null;
    return { state: "PENDING", plan: entitledTier(freshRow) };
  }

  return { state: "SESSION_INVALID", plan: entitledTier(row ?? null) };
}

function entitledTier(row: { tier: PlanTier; status: SubscriptionStatus } | null): PlanTier {
  if (!row) return "FREE";
  return row.status === "ACTIVE" || row.status === "TRIALING" ? row.tier : "FREE";
}

/** checkout.session.expired: a pending row for this session returns to implicit FREE. */
export async function clearPendingCheckout(sessionId: string): Promise<void> {
  await db.subscription.updateMany({
    where: { checkoutSessionId: sessionId, status: "CHECKOUT_PENDING" },
    data: { status: "ACTIVE", tier: "FREE", checkoutSessionId: null },
  });
}

// ---------------------------------------------------------------------------
// Billing portal
// ---------------------------------------------------------------------------

/**
 * Portal session for the STORED customer only - a client-supplied
 * customer id is not part of the contract, so cross-user portal access
 * is structurally impossible. Plan switches (Plus<->Gold) made in the
 * portal come back as customer.subscription.updated with a new price id
 * and remap through the trusted price map in syncStripeSubscription.
 */
export async function createPortalSession(
  userId: string,
  flow?: "payment_method_update",
): Promise<{ url: string }> {
  const client = requireClient();
  const row = await db.subscription.findUnique({ where: { userId } });
  if (!row?.providerCustomerId) {
    throw new BillingError("no_customer", "No billing profile exists for this account yet.");
  }
  const session = await client.createPortalSession({
    customer: row.providerCustomerId,
    returnUrl: `${siteUrl()}/settings/subscription`,
    flow,
  });
  return { url: session.url };
}

// ---------------------------------------------------------------------------
// Payment history from Stripe INVOICES (the source of truth for charges)
// ---------------------------------------------------------------------------

function invoicePriceId(inv: StripeInvoice): string | null {
  const line = inv.lines?.data?.[0];
  return line?.price?.id ?? line?.pricing?.price_details?.price ?? null;
}

/** "Tirvea Gold - upgrade" etc. via the trusted price map; never a guessed label. */
function invoicePlanLabel(inv: StripeInvoice): string {
  const tier = planForPriceId(invoicePriceId(inv));
  const name = PLANS.find((p) => p.tier === tier)?.name ?? "Subscription";
  const reason =
    inv.billing_reason === "subscription_update"
      ? " - upgrade"
      : inv.billing_reason === "subscription_cycle"
        ? " - renewal"
        : "";
  return `${name}${reason}`;
}

/**
 * One Payment row per Stripe INVOICE (providerPaymentId = invoice id).
 * Later events for the same invoice UPDATE the row - a failed attempt
 * that eventually collects flips FAILED -> SUCCEEDED, and the first
 * checkout charge (recorded by checkout.session.completed under the same
 * invoice id) is never duplicated by its invoice.paid event.
 */
export async function recordInvoicePayment(userId: string, inv: StripeInvoice): Promise<void> {
  if (!inv.id) return;
  const paid = inv.status === "paid";
  const status: PaymentStatus = paid ? "SUCCEEDED" : "FAILED";
  const amountCents = paid ? (inv.amount_paid ?? 0) : (inv.amount_due ?? 0);
  const data = {
    amountCents,
    currency: inv.currency ?? "eur",
    status,
    description: invoicePlanLabel(inv),
    invoiceUrl: inv.hosted_invoice_url ?? null,
    receiptUrl: inv.invoice_pdf ?? null,
  };
  await db.payment.upsert({
    where: { providerPaymentId: inv.id },
    create: { userId, provider: "STRIPE", providerPaymentId: inv.id, ...data },
    update: data,
  });
}

/** Pull recent invoices from Stripe and (re)materialise Payment rows -
 * heals history written before invoice recording existed and covers
 * webhook gaps. Only settled outcomes are recorded: paid always, open
 * only after a real collection attempt failed. */
async function reconcileInvoicePayments(userId: string, customerId: string): Promise<void> {
  const client = getStripeClient();
  if (!client) return;
  const invoices = await client.listInvoices(customerId);
  for (const inv of invoices) {
    if (inv.status === "paid" || (inv.status === "open" && inv.attempted)) {
      await recordInvoicePayment(userId, inv);
    }
  }
}

/**
 * Billing-page freshness: Stripe is the source of truth and the local
 * row is a cache. Re-syncs the subscription AND the invoice history on
 * view (throttled to one roundtrip a minute), so a cancellation or
 * resume made in the Stripe portal is visible immediately - even before
 * its webhook lands. Any Stripe hiccup falls back to the cached row;
 * this path never breaks the page.
 */
export async function reconcileBilling(userId: string) {
  const row = await db.subscription.findUnique({ where: { userId } });
  if (!row?.providerCustomerId || !stripeConfigured()) return row;
  if (row.syncedAt && Date.now() - row.syncedAt.getTime() < 60_000) return row;
  try {
    const updated = await syncStripeSubscription({
      stripeCustomerId: row.providerCustomerId,
      stripeSubscriptionId: row.providerSubId ?? null,
      sourceEventId: "reconcile:billing-page",
    });
    await reconcileInvoicePayments(userId, row.providerCustomerId);
    return updated ?? row;
  } catch (error) {
    console.error("[billing:reconcile] Stripe unreachable - serving cached row:", error);
    return row;
  }
}

// ---------------------------------------------------------------------------
// Webhook event processing (idempotent, refetch-latest)
// ---------------------------------------------------------------------------

export type StripeWebhookEvent = {
  id: string;
  type: string;
  data: { object: Record<string, unknown> };
};

const str = (v: unknown): string | null => (typeof v === "string" ? v : null);

/** invoice.customer/subscription across API versions (basil nests the sub id). */
function invoiceRefs(object: Record<string, unknown>) {
  const parent = object.parent as { subscription_details?: { subscription?: unknown } } | undefined;
  return {
    customer: str(object.customer),
    subscription:
      str(object.subscription) ?? str(parent?.subscription_details?.subscription) ?? null,
  };
}

/**
 * Idempotent processing behind the StripeEvent ledger: an event id is
 * processed at most once; a redelivery of a processed event acknowledges
 * without work; a crash mid-processing leaves processedAt NULL so the
 * Stripe retry gets to run the handler again. Callers return 2xx ONLY
 * when this resolves - any throw becomes a 5xx and a Stripe retry.
 */
export async function processStripeEvent(
  event: StripeWebhookEvent,
): Promise<{ duplicate: boolean; handled: boolean }> {
  try {
    await db.stripeEvent.create({ data: { id: event.id, type: event.type } });
  } catch {
    const existing = await db.stripeEvent.findUnique({ where: { id: event.id } });
    if (existing?.processedAt) return { duplicate: true, handled: false };
    // else: recorded but never finished (crash) - reprocess now.
  }

  const handled = await dispatchStripeEvent(event);

  await db.stripeEvent.update({
    where: { id: event.id },
    data: { processedAt: new Date() },
  });
  return { duplicate: false, handled };
}

async function dispatchStripeEvent(event: StripeWebhookEvent): Promise<boolean> {
  const object = event.data.object;

  switch (event.type) {
    case "checkout.session.completed": {
      const customer = str(object.customer);
      if (!customer) return false;
      await recordCheckoutPayment(event, object, customer);
      await syncStripeSubscription({
        stripeCustomerId: customer,
        stripeSubscriptionId: str(object.subscription),
        sourceEventId: event.id,
      });
      return true;
    }

    case "checkout.session.expired": {
      const sessionId = str(object.id);
      if (sessionId) await clearPendingCheckout(sessionId);
      return true;
    }

    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
    case "customer.subscription.paused":
    case "customer.subscription.resumed":
    // Payment-gated plan changes: refetch-latest lands the applied (or
    // rolled-back) state without modelling pending_update ourselves.
    case "customer.subscription.pending_update_applied":
    case "customer.subscription.pending_update_expired": {
      const customer = str(object.customer);
      if (!customer) return false;
      await syncStripeSubscription({
        stripeCustomerId: customer,
        stripeSubscriptionId: str(object.id),
        sourceEventId: event.id,
      });
      return true;
    }

    // Sync-only invoice/payment events: entitlements never move here -
    // sync is price-driven and pending_if_incomplete keeps the old price
    // until Stripe collects, so invoice.created can never grant a tier.
    case "invoice.created":
    case "invoice.finalized":
    case "invoice.payment_action_required": {
      const refs = invoiceRefs(object);
      if (!refs.customer) return false;
      await syncStripeSubscription({
        stripeCustomerId: refs.customer,
        stripeSubscriptionId: refs.subscription,
        sourceEventId: event.id,
      });
      return true;
    }

    case "invoice.paid":
    case "invoice.payment_succeeded":
    case "invoice.payment_failed": {
      const refs = invoiceRefs(object);
      if (!refs.customer) return false;
      // Refetch-latest: a PAID upgrade invoice means Stripe has applied
      // the pending update, so the fresh subscription now carries the
      // new price; a failed one means it still carries the old price.
      await syncStripeSubscription({
        stripeCustomerId: refs.customer,
        stripeSubscriptionId: refs.subscription,
        sourceEventId: event.id,
      });
      // Payment history: every settled invoice becomes (or updates) a
      // Payment row - renewals and upgrade invoices included.
      const row = await db.subscription.findUnique({
        where: { providerCustomerId: refs.customer },
      });
      if (row) await recordInvoicePayment(row.userId, object as StripeInvoice);
      return true;
    }

    // Payment intents settle asynchronously (3DS): refetch-latest by
    // customer lands whatever the payment outcome made true at Stripe.
    case "payment_intent.succeeded":
    case "payment_intent.payment_failed": {
      const customer = str(object.customer);
      if (!customer) return false;
      await syncStripeSubscription({
        stripeCustomerId: customer,
        stripeSubscriptionId: null,
        sourceEventId: event.id,
      });
      const row = await db.subscription.findUnique({
        where: { providerCustomerId: customer },
      });
      if (row?.providerCustomerId) {
        // The intent's invoice settled - re-materialise history.
        try {
          await reconcileInvoicePayments(row.userId, row.providerCustomerId);
        } catch (error) {
          console.error("[billing:webhook] invoice reconcile failed:", error);
        }
      }
      return true;
    }

    // Portal-created schedules (deferred downgrades): refetch-latest by
    // customer keeps us correct without modelling schedules.
    case "subscription_schedule.released":
    case "subscription_schedule.updated": {
      const customer = str(object.customer);
      if (!customer) return false;
      await syncStripeSubscription({
        stripeCustomerId: customer,
        stripeSubscriptionId: null,
        sourceEventId: event.id,
      });
      return true;
    }

    default:
      return false;
  }
}

/** Payment history row for a completed checkout - identity via the customer mapping, NEVER raw metadata. */
async function recordCheckoutPayment(
  event: StripeWebhookEvent,
  object: Record<string, unknown>,
  customer: string,
) {
  const sessionId = str(object.id);
  if (!sessionId) return;
  const row = await db.subscription.findUnique({ where: { providerCustomerId: customer } });
  if (!row) {
    console.error(
      `[billing:webhook] checkout.session.completed for unmapped customer ${customer} - no payment recorded (event ${event.id})`,
    );
    return;
  }
  const metadataUserId = (object.metadata as Record<string, unknown> | undefined)?.userId;
  if (typeof metadataUserId === "string" && metadataUserId !== row.userId) {
    console.error(
      `[billing:webhook] session ${sessionId} metadata userId does not match customer mapping - using mapping (event ${event.id})`,
    );
  }
  // Key by the session's INVOICE when Stripe provides it - invoice.paid
  // for the same charge then updates this row instead of duplicating it.
  const paymentKey = str(object.invoice) ?? sessionId;
  const metadataPlan = (object.metadata as Record<string, unknown> | undefined)?.plan;
  const planLabel = PLANS.find((p) => p.tier === metadataPlan)?.name ?? "Subscription";
  await db.payment.upsert({
    where: { providerPaymentId: paymentKey },
    create: {
      userId: row.userId,
      provider: "STRIPE",
      providerPaymentId: paymentKey,
      amountCents: typeof object.amount_total === "number" ? object.amount_total : 0,
      currency: str(object.currency) ?? "eur",
      status: "SUCCEEDED",
      description: planLabel,
      invoiceUrl: str(object.hosted_invoice_url),
    },
    update: {},
  });
}

/**
 * Honest "restore purchases": reads what the database actually holds for
 * the user and reports it verbatim. Never mutates anything and never
 * claims a restore succeeded - with no store-mediated purchase flow the
 * truthful answer is whatever the payment/subscription records say.
 */
export async function getPurchaseRecords(userId: string): Promise<{
  /** Number of successful payment records on this account. */
  payments: number;
  /** Paid tier on record, or null when there is nothing to restore. */
  subscriptionTier: string | null;
}> {
  const [payments, subscription] = await Promise.all([
    db.payment.count({ where: { userId, status: "SUCCEEDED" } }),
    db.subscription.findUnique({ where: { userId }, select: { tier: true } }),
  ]);
  return {
    payments,
    subscriptionTier: subscription && subscription.tier !== "FREE" ? subscription.tier : null,
  };
}
