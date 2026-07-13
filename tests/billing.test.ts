/**
 * Live tests for the canonical Stripe subscription lifecycle. Run with:
 *   npx tsx tests/billing.test.ts
 *
 * Talks to the real database from .env. A SPY Stripe client is injected
 * via setStripeClient (same pattern as setPushTransport), so the suite
 * NEVER contacts Stripe - customers/sessions/subscriptions live in
 * in-memory maps and test helpers script their state transitions. All
 * seeded rows are cleaned up in `finally`.
 *
 * Security invariants asserted here (spec phase 11):
 *  - no client price ids (schema is strict; plan names only)
 *  - success_url/redirects grant nothing; entitlements only from
 *    persisted verified Stripe state
 *  - webhook signature mandatory when secret configured
 *  - ownership on checkout-status; foreign session answers not_found
 *  - unique user<->customer mapping; duplicate sub prevention
 *  - idempotent webhook events; unknown price never grants premium
 */
import "dotenv/config";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
// Type-only: erased at runtime, so env setup below still runs first.
import type {
  StripeClient,
  StripeInvoice,
  StripeSubscription,
  StripeCheckoutSession,
  UpdateSubscriptionPriceParams,
} from "../src/lib/stripe";

process.env.AUTH_HASH_SALT = process.env.AUTH_HASH_SALT || "test-salt";
// Billing must consider itself configured so getStripeClient()/env checks
// behave like production; the spy client guarantees zero real API calls.
// The key is ALWAYS the dummy - it is never sent anywhere, and a
// non-standard local key (e.g. an mk_ mock key) must not fail the
// format checks of case 19d.
process.env.STRIPE_SECRET_KEY = "sk_test_dummy_for_tests";
if (!process.env.STRIPE_WEBHOOK_SECRET?.trim()) {
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_test_dummy";
}
if (!process.env.STRIPE_PLUS_MONTHLY_PRICE_ID?.trim()) {
  process.env.STRIPE_PLUS_MONTHLY_PRICE_ID = "price_test_plus";
}
if (!process.env.STRIPE_GOLD_MONTHLY_PRICE_ID?.trim()) {
  process.env.STRIPE_GOLD_MONTHLY_PRICE_ID = "price_test_gold";
}

const RUN = Date.now().toString(36);
const testEmail = (tag: string) => `billing-${tag}-${RUN}@example.com`;

let passed = 0;
async function check(name: string, fn: () => void | Promise<void>): Promise<void> {
  await fn();
  passed += 1;
  console.log(`  ok - ${name}`);
}
function skip(name: string, why: string) {
  console.log(`  skip - ${name} (${why})`);
}

async function main() {
  const { db } = await import("../src/lib/db");
  const {
    setStripeClient,
    StripeApiError,
    planForPriceId,
    validateStripeEnvStatic,
    validateStripeEnvDeep,
    resetStripeEnvDeepCache,
  } = await import("../src/lib/stripe");
  const {
    startCheckout,
    getCheckoutStatus,
    createPortalSession,
    syncStripeSubscription,
    processStripeEvent,
    checkoutIdempotencyKey,
    changePlan,
    previewChangePlan,
    changePlanStatus,
    planChangeIdempotencyKey,
    PLAN_CHANGE_PRORATION_BEHAVIOR,
    hasLiveSubscription,
    resumeSubscription,
    retryPayment,
    reconcileBilling,
    BillingError,
  } = await import("../src/lib/services/billing");
  const { PLANS, planRank, upgradePlansFor } = await import("../src/lib/constants");
  const { getUserEntitlements, effectiveTier } = await import(
    "../src/lib/services/entitlements"
  );
  const { planTierOf } = await import("../src/lib/services/matching");
  const { checkoutSchema, changePlanSchema } = await import("../src/lib/validators/billing");
  const { POST: webhookPOST } = await import("../src/app/api/webhooks/stripe/route");

  const PLUS_PRICE = process.env.STRIPE_PLUS_MONTHLY_PRICE_ID!;
  const GOLD_PRICE = process.env.STRIPE_GOLD_MONTHLY_PRICE_ID!;
  const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET!;

  // -------------------------------------------------------------------------
  // Spy Stripe client - scripted, in-memory, records every call.
  // -------------------------------------------------------------------------
  let seq = 0;
  const customers = new Map<string, { id: string; email?: string | null }>();
  const sessions = new Map<string, StripeCheckoutSession>();
  const subscriptions = new Map<string, StripeSubscription>();
  const idempotencySessions = new Map<string, string>();
  const portalCalls: { customer: string; returnUrl: string; flow?: string }[] = [];
  const planChangeCalls: UpdateSubscriptionPriceParams[] = [];
  const cancellationCalls: {
    subscriptionId: string;
    cancelAtPeriodEnd: boolean;
    idempotencyKey: string;
  }[] = [];
  const invoices = new Map<string, StripeInvoice>();
  const payInvoiceCalls: string[] = [];
  /** Scripted outcome for the next payInvoice call. */
  let payInvoiceOutcome: "paid" | "declined" = "paid";
  /** Scripted outcome for the next subscription-update (upgrade) call. */
  let upgradeOutcome: "paid" | "zero_due" | "requires_action" | "declined" | "pending" = "paid";
  /** Stripe-side idempotency: same key -> same stored response, ONE application. */
  const planChangeResponses = new Map<string, StripeSubscription>();
  let planChangeApplications = 0;
  const previewCalls: { customerId: string; subscriptionId: string; itemId: string; priceId: string }[] = [];
  const priceCatalogue = new Map<string, { currency: string; unit_amount: number; interval: string }>([
    [PLUS_PRICE, { currency: "eur", unit_amount: 1499, interval: "month" }],
    [GOLD_PRICE, { currency: "eur", unit_amount: 2999, interval: "month" }],
  ]);
  let checkoutSessionsCreated = 0;

  const spy: StripeClient = {
    async createCustomer({ email }) {
      const id = `cus_test_${++seq}`;
      customers.set(id, { id, email });
      return { id, email };
    },
    async createCheckoutSession(p) {
      const existing = idempotencySessions.get(p.idempotencyKey);
      if (existing) return sessions.get(existing)!;
      checkoutSessionsCreated += 1;
      const id = `cs_test_${++seq}`;
      const session: StripeCheckoutSession = {
        id,
        url: `https://checkout.stripe.com/c/pay/${id}`,
        customer: p.customer,
        subscription: null,
        status: "open",
        payment_status: "unpaid",
        metadata: p.metadata,
      };
      sessions.set(id, session);
      idempotencySessions.set(p.idempotencyKey, id);
      return session;
    },
    async retrieveCheckoutSession(id) {
      const s = sessions.get(id);
      if (!s) throw new StripeApiError(404, "resource_missing", "No such checkout session");
      return s;
    },
    async retrieveSubscription(id) {
      const s = subscriptions.get(id);
      if (!s) throw new StripeApiError(404, "resource_missing", "No such subscription");
      return s;
    },
    async retrieveSubscriptionPaymentState(id) {
      // The spy keeps latest_invoice/pending_update inline, so the
      // "expanded" fetch is the same object.
      const s = subscriptions.get(id);
      if (!s) throw new StripeApiError(404, "resource_missing", "No such subscription");
      return s;
    },
    async previewSubscriptionUpdate(p) {
      previewCalls.push(p);
      const s = subscriptions.get(p.subscriptionId);
      if (!s) throw new StripeApiError(404, "resource_missing", "No such subscription");
      if (s.items?.data?.[0]?.id !== p.itemId) {
        throw new StripeApiError(400, "invalid_request", "No such subscription item");
      }
      // Nothing changes - a preview is read-only at Stripe too.
      return {
        id: `in_preview_${++seq}`,
        customer: p.customerId,
        status: "draft",
        amount_due: 1514,
        currency: "eur",
        tax: null,
        billing_reason: "upcoming",
        lines: { data: [{ price: { id: p.priceId } }] },
      };
    },
    async updateSubscriptionPrice(p) {
      planChangeCalls.push(p);
      // Idempotency: a replayed key returns the SAME response and never
      // re-applies - exactly like Stripe.
      const replay = planChangeResponses.get(p.idempotencyKey);
      if (replay) return replay;
      const s = subscriptions.get(p.subscriptionId);
      if (!s) throw new StripeApiError(404, "resource_missing", "No such subscription");
      const item = s.items?.data?.[0];
      if (!item) throw new StripeApiError(400, "invalid_request", "Subscription has no item");
      if (item.id && item.id !== p.itemId) {
        throw new StripeApiError(400, "invalid_request", "No such subscription item");
      }
      if (p.paymentBehavior !== "pending_if_incomplete") {
        throw new StripeApiError(400, "invalid_request", "test spy expects pending_if_incomplete");
      }
      planChangeApplications += 1;

      // pending_if_incomplete semantics: the price ONLY changes when the
      // upgrade invoice is collected; otherwise the proposed change parks
      // in pending_update and the old price stays live.
      if (upgradeOutcome === "zero_due") {
        item.price = { id: p.priceId };
        s.pending_update = null;
        s.latest_invoice = null;
      } else {
        const inv = registerInvoice(s.customer, {
          priceId: p.priceId,
          amountCents: 1500, // prorated difference
          status: upgradeOutcome === "paid" ? "paid" : "open",
          attempted: upgradeOutcome !== "requires_action",
          billingReason: "subscription_update",
        });
        inv.payment_intent = {
          id: `pi_${inv.id}`,
          status:
            upgradeOutcome === "paid"
              ? "succeeded"
              : upgradeOutcome === "requires_action"
                ? "requires_action"
                : upgradeOutcome === "declined"
                  ? "requires_payment_method"
                  : "processing",
          client_secret: `${inv.id}_secret_test`,
        };
        s.latest_invoice = inv;
        if (upgradeOutcome === "paid") {
          item.price = { id: p.priceId };
          s.pending_update = null;
        } else {
          s.pending_update = {
            expires_at: Math.floor(Date.now() / 1000) + 3 * 24 * 3600,
            __targetPrice: p.priceId,
            __invoiceId: inv.id,
          };
        }
      }
      planChangeResponses.set(p.idempotencyKey, s);
      return s;
    },
    async updateSubscriptionCancellation(p) {
      cancellationCalls.push(p);
      const s = subscriptions.get(p.subscriptionId);
      if (!s) throw new StripeApiError(404, "resource_missing", "No such subscription");
      if (s.status === "canceled") {
        throw new StripeApiError(400, "invalid_request", "Canceled subscriptions cannot be updated");
      }
      s.cancel_at_period_end = p.cancelAtPeriodEnd;
      s.cancel_at = p.cancelAtPeriodEnd
        ? (s.items?.data?.[0]?.current_period_end ?? null)
        : null;
      return s;
    },
    async listSubscriptions(customerId) {
      return [...subscriptions.values()].filter((s) => s.customer === customerId);
    },
    async listInvoices(customerId, status) {
      return [...invoices.values()]
        .filter((inv) => inv.customer === customerId)
        .filter((inv) => (status ? inv.status === status : true))
        .sort((a, b) => (b.created ?? 0) - (a.created ?? 0));
    },
    async payInvoice(id) {
      payInvoiceCalls.push(id);
      const inv = invoices.get(id);
      if (!inv) throw new StripeApiError(404, "resource_missing", "No such invoice");
      if (payInvoiceOutcome === "declined") {
        inv.attempted = true;
        throw new StripeApiError(402, "card_declined", "Your card was declined.");
      }
      inv.status = "paid";
      inv.amount_paid = inv.amount_due ?? 0;
      // Like Stripe: collecting the open invoice reactivates the sub.
      for (const s of subscriptions.values()) {
        if (s.customer === inv.customer && s.status === "past_due") s.status = "active";
      }
      return inv;
    },
    async createPortalSession({ customer, returnUrl, flow }) {
      portalCalls.push({ customer, returnUrl, flow });
      return { id: `bps_test_${++seq}`, url: `https://billing.stripe.com/session/${customer}` };
    },
    async retrievePrice(id) {
      const p = priceCatalogue.get(id);
      if (!p) throw new StripeApiError(404, "resource_missing", "No such price");
      return { id, currency: p.currency, unit_amount: p.unit_amount, recurring: { interval: p.interval }, active: true };
    },
  };
  setStripeClient(spy);

  /** Register an invoice at "Stripe" (checkout charges and renewals). */
  function registerInvoice(
    customer: string,
    opts: {
      priceId: string;
      amountCents: number;
      status?: StripeInvoice["status"];
      attempted?: boolean;
      billingReason?: string;
    },
  ): StripeInvoice {
    const id = `in_test_${++seq}`;
    const paid = (opts.status ?? "paid") === "paid";
    const inv: StripeInvoice = {
      id,
      customer,
      status: opts.status ?? "paid",
      billing_reason: opts.billingReason ?? "subscription_create",
      amount_paid: paid ? opts.amountCents : 0,
      amount_due: opts.amountCents,
      currency: "eur",
      created: Math.floor(Date.now() / 1000) + seq, // unique, newest-first sortable
      attempted: opts.attempted ?? paid,
      hosted_invoice_url: `https://invoice.stripe.com/i/${id}`,
      invoice_pdf: `https://pay.stripe.com/receipts/${id}.pdf`,
      lines: { data: [{ price: { id: opts.priceId } }] },
    };
    invoices.set(id, inv);
    return inv;
  }

  /** Stripe collects a pending update's invoice -> the change applies. */
  function applyPendingUpdate(subId: string): StripeInvoice {
    const s = subscriptions.get(subId)!;
    const pending = s.pending_update as { __targetPrice: string; __invoiceId: string };
    const inv = invoices.get(pending.__invoiceId)!;
    inv.status = "paid";
    inv.amount_paid = inv.amount_due ?? 0;
    if (inv.payment_intent && typeof inv.payment_intent === "object") {
      inv.payment_intent.status = "succeeded";
    }
    s.items!.data![0].price = { id: pending.__targetPrice };
    s.pending_update = null;
    s.latest_invoice = inv;
    return inv;
  }

  /** The pending update's invoice was never paid -> Stripe expires it. */
  function expirePendingUpdate(subId: string): void {
    const s = subscriptions.get(subId)!;
    const pending = s.pending_update as { __invoiceId: string } | null;
    if (pending) {
      const inv = invoices.get(pending.__invoiceId);
      if (inv) inv.status = "void";
    }
    s.pending_update = null;
  }

  /** Script a subscription at "Stripe" and mark the session complete. */
  function completeCheckout(
    sessionId: string,
    opts: {
      priceId: string;
      status?: string;
      cancelAtPeriodEnd?: boolean;
      periodEndSecs?: number;
      metadata?: Record<string, string>;
    },
  ): StripeSubscription {
    const session = sessions.get(sessionId)!;
    const id = `sub_test_${++seq}`;
    const nowSecs = Math.floor(Date.now() / 1000);
    const sub: StripeSubscription = {
      id,
      customer: session.customer!,
      status: opts.status ?? "active",
      cancel_at_period_end: opts.cancelAtPeriodEnd ?? false,
      created: nowSecs,
      metadata: opts.metadata ?? {},
      items: {
        data: [
          {
            id: `si_test_${++seq}`,
            price: { id: opts.priceId },
            current_period_start: nowSecs,
            current_period_end: opts.periodEndSecs ?? nowSecs + 30 * 24 * 3600,
          },
        ],
      },
    };
    subscriptions.set(id, sub);
    // Stripe raises an invoice for the first charge; the session carries
    // its id, so payment rows key on the invoice (never duplicated by a
    // later invoice.paid for the same charge).
    const amount = opts.priceId === GOLD_PRICE ? 2999 : 1499;
    const invoice = registerInvoice(session.customer!, {
      priceId: opts.priceId,
      amountCents: amount,
      status: (opts.status ?? "active") === "active" ? "paid" : "open",
    });
    sessions.set(sessionId, {
      ...session,
      status: "complete",
      payment_status: "paid",
      subscription: id,
      invoice: invoice.id,
      amount_total: amount,
      currency: "eur",
    });
    return sub;
  }

  function signedWebhookRequest(event: object, secret = WEBHOOK_SECRET): Request {
    const raw = JSON.stringify(event);
    const ts = Math.floor(Date.now() / 1000);
    const v1 = createHmac("sha256", secret).update(`${ts}.${raw}`).digest("hex");
    return new Request("http://localhost/api/webhooks/stripe", {
      method: "POST",
      headers: { "stripe-signature": `t=${ts},v1=${v1}` },
      body: raw,
    });
  }

  const userIds: string[] = [];
  const eventIds: string[] = [];
  let eventSeq = 0;
  const nextEventId = () => {
    const id = `evt_test_${RUN}_${++eventSeq}`;
    eventIds.push(id);
    return id;
  };

  async function seedUser(tag: string): Promise<string> {
    const user = await db.user.create({ data: { email: testEmail(tag) } });
    userIds.push(user.id);
    return user.id;
  }

  const subRow = (userId: string) =>
    db.subscription.findUniqueOrThrow({ where: { userId } });

  try {
    console.log("billing lifecycle:");

    // -----------------------------------------------------------------------
    // Checkout session creation
    // -----------------------------------------------------------------------
    const alice = await seedUser("alice");
    const bob = await seedUser("bob");

    let aliceSession = "";
    await check("case 1a: checkout session for PLUS carries the PLUS price id and metadata", async () => {
      const result = await startCheckout(alice, "PLUS", testEmail("alice"));
      assert.ok(result.url.startsWith("https://checkout.stripe.com/"));
      aliceSession = result.sessionId;
      const session = sessions.get(result.sessionId)!;
      assert.equal(session.metadata?.userId, alice);
      assert.equal(session.metadata?.plan, "PLUS");
      const row = await subRow(alice);
      assert.equal(row.status, "CHECKOUT_PENDING");
      assert.equal(row.tier, "FREE");
      assert.ok(row.providerCustomerId?.startsWith("cus_test_"));
      assert.equal(row.checkoutSessionId, result.sessionId);
    });

    await check("case 1b: checkout session for GOLD (second user, distinct customer)", async () => {
      const result = await startCheckout(bob, "GOLD", testEmail("bob"));
      const rowA = await subRow(alice);
      const rowB = await subRow(bob);
      assert.notEqual(rowA.providerCustomerId, rowB.providerCustomerId);
      assert.ok(result.sessionId !== aliceSession);
    });

    await check("case 2: invalid plan / extra keys are rejected by the strict schema (422 path)", () => {
      assert.equal(checkoutSchema.safeParse({ plan: "DIAMOND" }).success, false);
      assert.equal(checkoutSchema.safeParse({ plan: "PLUS", priceId: "price_evil" }).success, false);
      assert.equal(checkoutSchema.safeParse({ plan: "GOLD" }).success, true);
    });

    await check("case 4: double-tap inside the idempotency window returns the SAME session", async () => {
      const before = checkoutSessionsCreated;
      const carol = await seedUser("carol");
      const [r1, r2] = [
        await startCheckout(carol, "PLUS"),
        await startCheckout(carol, "PLUS"),
      ];
      assert.equal(r1.sessionId, r2.sessionId);
      assert.equal(checkoutSessionsCreated, before + 1);
      assert.notEqual(
        checkoutIdempotencyKey(carol, "PLUS", Date.now()),
        checkoutIdempotencyKey(carol, "GOLD", Date.now()),
      );
    });

    await check("case 5: creating a checkout session (the success_url flow) grants NOTHING", async () => {
      const ent = await getUserEntitlements(alice);
      assert.equal(ent.plan, "FREE");
      assert.equal(await planTierOf(alice), "FREE");
    });

    await check("case 7: checkout-status answers PENDING/plan FREE while the session is open", async () => {
      const result = await getCheckoutStatus(alice, aliceSession);
      assert.equal(result.state, "PENDING");
      assert.equal(result.plan, "FREE");
    });

    await check("case 9: a FOREIGN session_id answers not_found (no enumeration)", async () => {
      await assert.rejects(
        () => getCheckoutStatus(bob, aliceSession),
        (e: unknown) => e instanceof BillingError && e.code === "not_found",
      );
      await assert.rejects(
        () => getCheckoutStatus(bob, "cs_test_does_not_exist"),
        (e: unknown) => e instanceof BillingError && e.code === "not_found",
      );
    });

    // -----------------------------------------------------------------------
    // Sync + reconciliation
    // -----------------------------------------------------------------------
    await check("case 8: ACTIVE only after server-side sync of verified Stripe state", async () => {
      completeCheckout(aliceSession, { priceId: PLUS_PRICE });
      // Still FREE - nothing synced yet.
      assert.equal((await getUserEntitlements(alice)).plan, "FREE");
      // checkout-status runs the SAME sync as the webhook (reconciliation).
      const result = await getCheckoutStatus(alice, aliceSession);
      assert.equal(result.state, "ACTIVE");
      assert.equal(result.plan, "PLUS");
      const row = await subRow(alice);
      assert.equal(row.status, "ACTIVE");
      assert.equal(row.tier, "PLUS");
      assert.equal(row.stripePriceId, PLUS_PRICE);
      assert.ok(row.currentPeriodEnd && row.currentPeriodEnd > new Date());
      const ent = await getUserEntitlements(alice);
      assert.equal(ent.plan, "PLUS");
      assert.equal(ent.likesPerDay, null);
      assert.equal(ent.superLikesPerDay, 5);
      assert.equal(ent.undo, true);
      assert.equal(ent.firstMessagesPerDay, 10);
    });

    await check("duplicate checkout while subscribed answers already_subscribed (409 path)", async () => {
      await assert.rejects(
        () => startCheckout(alice, "GOLD"),
        (e: unknown) => e instanceof BillingError && e.code === "already_subscribed",
      );
    });

    // -----------------------------------------------------------------------
    // Webhook: signature, idempotency, event mapping
    // -----------------------------------------------------------------------
    const bobSession = (await db.subscription.findUniqueOrThrow({ where: { userId: bob } }))
      .checkoutSessionId!;
    const bobSub = completeCheckout(bobSession, { priceId: GOLD_PRICE });
    const bobCustomer = (await subRow(bob)).providerCustomerId!;

    await check("case 10: unsigned/badly-signed webhook is 400 and changes NOTHING", async () => {
      const event = {
        id: nextEventId(),
        type: "checkout.session.completed",
        data: { object: { ...sessions.get(bobSession)! } },
      };
      const unsigned = new Request("http://localhost/api/webhooks/stripe", {
        method: "POST",
        body: JSON.stringify(event),
      });
      assert.equal((await webhookPOST(unsigned)).status, 400);
      const badKey = signedWebhookRequest(event, "whsec_wrong_secret");
      assert.equal((await webhookPOST(badKey)).status, 400);
      assert.equal((await subRow(bob)).status, "CHECKOUT_PENDING");
      assert.equal(await db.payment.count({ where: { userId: bob } }), 0);
    });

    await check("case 13/webhook: checkout.session.completed syncs GOLD ACTIVE + payment recorded", async () => {
      const event = {
        id: nextEventId(),
        type: "checkout.session.completed",
        data: { object: { ...sessions.get(bobSession)! } },
      };
      const res = await webhookPOST(signedWebhookRequest(event));
      assert.equal(res.status, 200);
      const row = await subRow(bob);
      assert.equal(row.tier, "GOLD");
      assert.equal(row.status, "ACTIVE");
      assert.equal(row.providerSubId, bobSub.id);
      const ent = await getUserEntitlements(bob);
      assert.equal(ent.plan, "GOLD");
      assert.equal(ent.superLikesPerDay, 10);
      assert.equal(ent.firstMessagesPerDay, 25);
      assert.equal(await db.payment.count({ where: { userId: bob } }), 1);
    });

    await check("case 11: a duplicate delivery of the SAME event id is acknowledged without re-processing", async () => {
      const eventId = eventIds[eventIds.length - 1];
      const event = {
        id: eventId,
        type: "checkout.session.completed",
        data: { object: { ...sessions.get(bobSession)! } },
      };
      const res = await webhookPOST(signedWebhookRequest(event));
      assert.equal(res.status, 200);
      assert.equal(((await res.json()) as { duplicate?: boolean }).duplicate, true);
      assert.equal(await db.payment.count({ where: { userId: bob } }), 1);
    });

    await check("ledger crash-retry: an unprocessed event row is reprocessed, not skipped", async () => {
      const eventId = nextEventId();
      await db.stripeEvent.create({ data: { id: eventId, type: "customer.subscription.updated" } });
      const result = await processStripeEvent({
        id: eventId,
        type: "customer.subscription.updated",
        data: { object: { id: bobSub.id, customer: bobCustomer } },
      });
      assert.equal(result.duplicate, false);
      const ledger = await db.stripeEvent.findUniqueOrThrow({ where: { id: eventId } });
      assert.ok(ledger.processedAt);
    });

    await check("case 14: subscription.updated remaps Gold -> Plus via the trusted price map", async () => {
      subscriptions.set(bobSub.id, {
        ...subscriptions.get(bobSub.id)!,
        items: { data: [{ price: { id: PLUS_PRICE }, current_period_end: Math.floor(Date.now() / 1000) + 20 * 24 * 3600 }] },
      });
      const event = {
        id: nextEventId(),
        type: "customer.subscription.updated",
        data: { object: { id: bobSub.id, customer: bobCustomer } },
      };
      assert.equal((await webhookPOST(signedWebhookRequest(event))).status, 200);
      const row = await subRow(bob);
      assert.equal(row.tier, "PLUS");
      assert.equal((await getUserEntitlements(bob)).plan, "PLUS");
    });

    await check("case 12: an UNKNOWN price id never grants a paid tier (audit-logged)", async () => {
      subscriptions.set(bobSub.id, {
        ...subscriptions.get(bobSub.id)!,
        items: { data: [{ price: { id: "price_unknown_rogue" } }] },
      });
      await syncStripeSubscription({ stripeCustomerId: bobCustomer, stripeSubscriptionId: bobSub.id });
      const row = await subRow(bob);
      assert.equal(row.tier, "FREE");
      assert.equal(row.status, "ACTIVE");
      assert.equal((await getUserEntitlements(bob)).plan, "FREE");
      // restore
      subscriptions.set(bobSub.id, {
        ...subscriptions.get(bobSub.id)!,
        items: { data: [{ price: { id: GOLD_PRICE }, current_period_end: Math.floor(Date.now() / 1000) + 20 * 24 * 3600 }] },
      });
      await syncStripeSubscription({ stripeCustomerId: bobCustomer, stripeSubscriptionId: bobSub.id });
    });

    await check("case 15: cancelAtPeriodEnd keeps entitlements until the period actually ends", async () => {
      subscriptions.set(bobSub.id, {
        ...subscriptions.get(bobSub.id)!,
        cancel_at_period_end: true,
      });
      const event = {
        id: nextEventId(),
        type: "customer.subscription.updated",
        data: { object: { id: bobSub.id, customer: bobCustomer } },
      };
      assert.equal((await webhookPOST(signedWebhookRequest(event))).status, 200);
      const row = await subRow(bob);
      assert.equal(row.status, "ACTIVE");
      assert.equal(row.cancelAtPeriodEnd, true);
      assert.equal((await getUserEntitlements(bob)).plan, "GOLD");
    });

    await check("case 17: invoice.payment_failed -> PAST_DUE with a bounded dunning grace", async () => {
      const nowSecs = Math.floor(Date.now() / 1000);
      subscriptions.set(bobSub.id, {
        ...subscriptions.get(bobSub.id)!,
        status: "past_due",
        cancel_at_period_end: false,
        items: { data: [{ price: { id: GOLD_PRICE }, current_period_end: nowSecs - 24 * 3600 }] },
      });
      const event = {
        id: nextEventId(),
        type: "invoice.payment_failed",
        data: { object: { id: `in_test_${RUN}`, customer: bobCustomer, subscription: bobSub.id } },
      };
      assert.equal((await webhookPOST(signedWebhookRequest(event))).status, 200);
      const row = await subRow(bob);
      assert.equal(row.status, "PAST_DUE");
      // Stripe-conventional: access kept during the grace window...
      assert.equal((await getUserEntitlements(bob)).plan, "GOLD");
      // ...and dropped once the grace is exhausted (pure policy check).
      const staleTier = effectiveTier(
        {
          tier: "GOLD",
          status: "PAST_DUE",
          currentPeriodEnd: new Date(Date.now() - 10 * 24 * 3600 * 1000),
          cancelAtPeriodEnd: false,
        },
      );
      assert.equal(staleTier, "FREE");
    });

    await check("paused subscriptions grant nothing", async () => {
      subscriptions.set(bobSub.id, { ...subscriptions.get(bobSub.id)!, status: "paused" });
      const event = {
        id: nextEventId(),
        type: "customer.subscription.paused",
        data: { object: { id: bobSub.id, customer: bobCustomer } },
      };
      assert.equal((await webhookPOST(signedWebhookRequest(event))).status, 200);
      assert.equal((await subRow(bob)).status, "PAUSED");
      assert.equal((await getUserEntitlements(bob)).plan, "FREE");
    });

    await check("case 16: subscription.deleted -> FREE (refetch-latest sees canceled)", async () => {
      subscriptions.set(bobSub.id, {
        ...subscriptions.get(bobSub.id)!,
        status: "canceled",
        canceled_at: Math.floor(Date.now() / 1000),
      });
      const event = {
        id: nextEventId(),
        type: "customer.subscription.deleted",
        data: { object: { id: bobSub.id, customer: bobCustomer } },
      };
      assert.equal((await webhookPOST(signedWebhookRequest(event))).status, 200);
      const row = await subRow(bob);
      assert.equal(row.tier, "FREE");
      assert.equal(row.status, "CANCELED");
      assert.ok(row.canceledAt);
      assert.equal((await getUserEntitlements(bob)).plan, "FREE");
      assert.equal(await planTierOf(bob), "FREE");
    });

    await check("checkout.session.expired clears CHECKOUT_PENDING back to implicit FREE", async () => {
      const dave = await seedUser("dave");
      const { sessionId } = await startCheckout(dave, "PLUS");
      assert.equal((await subRow(dave)).status, "CHECKOUT_PENDING");
      sessions.set(sessionId, { ...sessions.get(sessionId)!, status: "expired" });
      const event = {
        id: nextEventId(),
        type: "checkout.session.expired",
        data: { object: { id: sessionId } },
      };
      assert.equal((await webhookPOST(signedWebhookRequest(event))).status, 200);
      const row = await subRow(dave);
      assert.equal(row.status, "ACTIVE");
      assert.equal(row.tier, "FREE");
      assert.equal(row.checkoutSessionId, null);
    });

    await check("TRIALING is entitled (status policy)", () => {
      const tier = effectiveTier({
        tier: "PLUS",
        status: "TRIALING",
        currentPeriodEnd: new Date(Date.now() + 5 * 24 * 3600 * 1000),
        cancelAtPeriodEnd: false,
      });
      assert.equal(tier, "PLUS");
    });

    await check("webhook events for unmapped customers change nothing (no metadata trust)", async () => {
      const before = await db.subscription.count();
      const event = {
        id: nextEventId(),
        type: "customer.subscription.created",
        data: {
          object: {
            id: "sub_foreign",
            customer: "cus_never_seen",
            metadata: { userId: alice }, // hostile metadata must be ignored
          },
        },
      };
      assert.equal((await webhookPOST(signedWebhookRequest(event))).status, 200);
      assert.equal(await db.subscription.count(), before);
      assert.equal((await subRow(alice)).tier, "PLUS"); // untouched
    });

    // -----------------------------------------------------------------------
    // Portal
    // -----------------------------------------------------------------------
    await check("case 18: portal uses the STORED customer only; users without one are refused", async () => {
      const result = await createPortalSession(alice);
      assert.ok(result.url.includes("billing.stripe.com"));
      const aliceCustomer = (await subRow(alice)).providerCustomerId!;
      assert.equal(portalCalls[portalCalls.length - 1].customer, aliceCustomer);
      assert.ok(portalCalls[portalCalls.length - 1].returnUrl.endsWith("/settings/subscription"));

      const eve = await seedUser("eve");
      await assert.rejects(
        () => createPortalSession(eve),
        (e: unknown) => e instanceof BillingError && e.code === "no_customer",
      );
    });

    await check("unique user<->customer mapping is enforced by the database", async () => {
      const aliceCustomer = (await subRow(alice)).providerCustomerId!;
      const mallory = await seedUser("mallory");
      await assert.rejects(
        db.subscription.create({
          data: { userId: mallory, providerCustomerId: aliceCustomer },
        }),
      );
    });

    // -----------------------------------------------------------------------
    // In-place plan change (upgrade) - Stripe subscription UPDATE
    // -----------------------------------------------------------------------
    await check("hierarchy: upgrade targets derive from canonical FREE < PLUS < GOLD", () => {
      assert.ok(planRank("FREE") < planRank("PLUS"));
      assert.ok(planRank("PLUS") < planRank("GOLD"));
      assert.deepEqual(upgradePlansFor("FREE").map((p) => p.tier), ["PLUS", "GOLD"]);
      assert.deepEqual(upgradePlansFor("PLUS").map((p) => p.tier), ["GOLD"]);
      assert.deepEqual(upgradePlansFor("GOLD").map((p) => p.tier), []);
      // The hierarchy IS the PLANS order - adding a tier propagates.
      assert.deepEqual(PLANS.map((p) => p.tier), ["FREE", "PLUS", "GOLD"]);
    });

    await check("change-plan schema is as strict as checkout (no price ids from the browser)", () => {
      assert.equal(changePlanSchema.safeParse({ plan: "GOLD" }).success, true);
      assert.equal(changePlanSchema.safeParse({ plan: "DIAMOND" }).success, false);
      assert.equal(
        changePlanSchema.safeParse({ plan: "GOLD", priceId: "price_evil" }).success,
        false,
      );
    });

    await check("no live subscription -> no_subscription (checkout is the path)", async () => {
      const gina = await seedUser("gina"); // free member, no subscription row
      assert.equal(hasLiveSubscription(await subRow(alice)), true);
      await assert.rejects(
        () => changePlan(gina, "GOLD"),
        (e: unknown) => e instanceof BillingError && e.code === "no_subscription",
      );
    });

    let aliceSubId = "";
    await check("PLUS -> GOLD: paid upgrade updates the EXISTING subscription in place (no duplicate)", async () => {
      const before = await subRow(alice);
      assert.equal(before.tier, "PLUS");
      aliceSubId = before.providerSubId!;
      const subCountBefore = subscriptions.size;
      const checkoutsBefore = checkoutSessionsCreated;
      const customersBefore = customers.size;
      const periodEndBefore = before.currentPeriodEnd?.getTime();
      const paymentsBefore = await db.payment.count({ where: { userId: alice } });

      upgradeOutcome = "paid";
      const result = await changePlan(alice, "GOLD");
      assert.equal(result.outcome, "PAID_AND_APPLIED", "never a generic success");
      assert.equal(result.plan, "GOLD");
      assert.equal(result.status, "ACTIVE");

      // UPDATE, never CREATE: no second subscription, session or customer.
      assert.equal(subscriptions.size, subCountBefore);
      assert.equal(checkoutSessionsCreated, checkoutsBefore);
      assert.equal(customers.size, customersBefore);

      const row = await subRow(alice);
      assert.equal(row.tier, "GOLD");
      assert.equal(row.status, "ACTIVE");
      assert.equal(row.providerSubId, aliceSubId, "same Stripe subscription id");
      assert.equal(row.providerCustomerId, before.providerCustomerId, "customer id unchanged");
      assert.equal(row.stripePriceId, GOLD_PRICE, "item price replaced with GOLD");
      assert.equal(
        row.currentPeriodEnd?.getTime(),
        periodEndBefore,
        "billing cycle anchor preserved",
      );

      // The corrected Stripe request: always_invoice + pending_if_incomplete
      // + a STABLE per-transition idempotency key.
      const call = planChangeCalls[planChangeCalls.length - 1];
      assert.equal(call.subscriptionId, aliceSubId);
      assert.equal(call.priceId, GOLD_PRICE);
      assert.equal(call.prorationBehavior, "always_invoice");
      assert.equal(call.prorationBehavior, PLAN_CHANGE_PRORATION_BEHAVIOR);
      assert.equal(call.paymentBehavior, "pending_if_incomplete");
      assert.equal(call.itemId, subscriptions.get(aliceSubId)!.items!.data![0].id);
      assert.equal(
        call.idempotencyKey,
        // "none": alice's sub had no latest_invoice before this attempt.
        planChangeIdempotencyKey(aliceSubId, PLUS_PRICE, GOLD_PRICE, "none"),
      );

      // The PAID upgrade invoice lands in history immediately.
      assert.equal(
        await db.payment.count({ where: { userId: alice } }),
        paymentsBefore + 1,
      );
      const upgradePayment = await db.payment.findFirstOrThrow({
        where: { userId: alice, description: "Tirvea Gold - upgrade" },
      });
      assert.equal(upgradePayment.status, "SUCCEEDED");
      assert.equal(upgradePayment.amountCents, 1500);

      // Entitlements follow the CONFIRMED payment - no webhook needed.
      assert.equal((await getUserEntitlements(alice)).plan, "GOLD");
    });

    await check("the customer.subscription.updated webhook after an upgrade is a harmless no-op", async () => {
      const event = {
        id: nextEventId(),
        type: "customer.subscription.updated",
        data: {
          object: { id: aliceSubId, customer: (await subRow(alice)).providerCustomerId },
        },
      };
      assert.equal((await webhookPOST(signedWebhookRequest(event))).status, 200);
      const row = await subRow(alice);
      assert.equal(row.tier, "GOLD");
      assert.equal(row.providerSubId, aliceSubId);
    });

    await check("GOLD has no upgrade: same tier and downgrades answer invalid_plan_change", async () => {
      await assert.rejects(
        () => changePlan(alice, "GOLD"),
        (e: unknown) => e instanceof BillingError && e.code === "invalid_plan_change",
      );
      await assert.rejects(
        () => changePlan(alice, "PLUS"),
        (e: unknown) => e instanceof BillingError && e.code === "invalid_plan_change",
      );
      assert.equal((await subRow(alice)).tier, "GOLD", "nothing changed");
    });

    await check("PAST_DUE blocks in-place upgrades (fix the payment method first)", async () => {
      const frank = await seedUser("frank");
      const { sessionId } = await startCheckout(frank, "PLUS");
      const frankSub = completeCheckout(sessionId, { priceId: PLUS_PRICE });
      await syncStripeSubscription({
        stripeCustomerId: frankSub.customer,
        stripeSubscriptionId: frankSub.id,
      });
      assert.equal((await subRow(frank)).tier, "PLUS");
      subscriptions.set(frankSub.id, { ...subscriptions.get(frankSub.id)!, status: "past_due" });
      await syncStripeSubscription({
        stripeCustomerId: frankSub.customer,
        stripeSubscriptionId: frankSub.id,
      });
      const callsBefore = planChangeCalls.length;
      await assert.rejects(
        () => changePlan(frank, "GOLD"),
        (e: unknown) => e instanceof BillingError && e.code === "payment_past_due",
      );
      assert.equal(planChangeCalls.length, callsBefore, "Stripe never called");
      assert.equal((await subRow(frank)).tier, "PLUS");
    });

    // -----------------------------------------------------------------------
    // Payment-gated upgrades: preview -> confirm -> pay -> apply.
    // Gold is NEVER granted before Stripe confirms the money.
    // -----------------------------------------------------------------------
    const kara = await seedUser("kara");
    const karaSession = (await startCheckout(kara, "PLUS", testEmail("kara"))).sessionId;
    const karaSub = completeCheckout(karaSession, { priceId: PLUS_PRICE });
    await syncStripeSubscription({
      stripeCustomerId: karaSub.customer,
      stripeSubscriptionId: karaSub.id,
    });

    await check("preview returns the EXACT Stripe proration - nothing charged, nothing changed", async () => {
      const before = await subRow(kara);
      const preview = await previewChangePlan(kara, "GOLD");
      assert.equal(preview.amountDueCents, 1514, "the spy's scripted Stripe amount, verbatim");
      assert.equal(preview.currency, "eur");
      assert.equal(preview.nextRecurringCents, 2999);
      assert.equal(preview.planName, "Tirvea Gold");
      assert.equal(
        preview.renewsAt?.getTime(),
        before.currentPeriodEnd?.getTime(),
        "renewal date unchanged in the preview",
      );
      assert.ok(preview.expiresAt.getTime() > Date.now());
      const call = previewCalls[previewCalls.length - 1];
      assert.equal(call.subscriptionId, karaSub.id);
      assert.equal(call.itemId, karaSub.items!.data![0].id);
      assert.equal(call.priceId, GOLD_PRICE);
      // Read-only: same tier, same price, no invoice recorded.
      const after = await subRow(kara);
      assert.equal(after.tier, "PLUS");
      assert.equal(after.stripePriceId, PLUS_PRICE);
    });

    await check("requires_action: plan UNCHANGED, clientSecret returned to the owner only", async () => {
      upgradeOutcome = "requires_action";
      const result = await changePlan(kara, "GOLD");
      assert.equal(result.outcome, "REQUIRES_ACTION");
      assert.ok(result.clientSecret?.includes("_secret_"), "Stripe.js secret present");
      assert.equal(result.plan, "PLUS", "the response says the truth: still Plus");
      const row = await subRow(kara);
      assert.equal(row.tier, "PLUS");
      assert.equal(row.stripePriceId, PLUS_PRICE, "price untouched while pending");
      assert.equal((await getUserEntitlements(kara)).plan, "PLUS", "no entitlement leak");
    });

    await check("upgrade lock: a second request while one awaits payment answers upgrade_pending", async () => {
      await assert.rejects(
        () => changePlan(kara, "GOLD"),
        (e: unknown) => e instanceof BillingError && e.code === "upgrade_pending",
      );
      await assert.rejects(
        () => previewChangePlan(kara, "GOLD"),
        (e: unknown) => e instanceof BillingError && e.code === "upgrade_pending",
      );
    });

    await check("customer.subscription.updated ALONE cannot activate Gold", async () => {
      const event = {
        id: nextEventId(),
        type: "customer.subscription.updated",
        data: { object: { id: karaSub.id, customer: karaSub.customer } },
      };
      assert.equal((await webhookPOST(signedWebhookRequest(event))).status, 200);
      assert.equal((await subRow(kara)).tier, "PLUS");
    });

    await check("invoice.created cannot activate Gold or fabricate history", async () => {
      const paymentsBefore = await db.payment.count({ where: { userId: kara } });
      const pendingInvoiceId = (karaSub.pending_update as { __invoiceId: string }).__invoiceId;
      const event = {
        id: nextEventId(),
        type: "invoice.created",
        data: { object: { ...invoices.get(pendingInvoiceId)!, subscription: karaSub.id } },
      };
      assert.equal((await webhookPOST(signedWebhookRequest(event))).status, 200);
      assert.equal((await subRow(kara)).tier, "PLUS");
      assert.equal(await db.payment.count({ where: { userId: kara } }), paymentsBefore);
    });

    await check("status endpoint reports REQUIRES_ACTION from FRESH Stripe state", async () => {
      const status = await changePlanStatus(kara);
      assert.equal(status.state, "REQUIRES_ACTION");
      assert.ok(status.clientSecret?.includes("_secret_"));
      assert.equal(status.plan, "PLUS");
    });

    await check("pending_update_applied (payment succeeded) activates Gold + records the invoice", async () => {
      const upgradeInvoice = applyPendingUpdate(karaSub.id);
      const applied = {
        id: nextEventId(),
        type: "customer.subscription.pending_update_applied",
        data: { object: { id: karaSub.id, customer: karaSub.customer } },
      };
      assert.equal((await webhookPOST(signedWebhookRequest(applied))).status, 200);
      assert.equal((await subRow(kara)).tier, "GOLD");
      const paid = {
        id: nextEventId(),
        type: "invoice.paid",
        data: { object: { ...upgradeInvoice, subscription: karaSub.id } },
      };
      assert.equal((await webhookPOST(signedWebhookRequest(paid))).status, 200);
      const payment = await db.payment.findUniqueOrThrow({
        where: { providerPaymentId: upgradeInvoice.id },
      });
      assert.equal(payment.status, "SUCCEEDED");
      assert.equal(payment.description, "Tirvea Gold - upgrade");
      assert.equal((await changePlanStatus(kara)).state, "ACTIVE_GOLD");
      assert.equal((await getUserEntitlements(kara)).plan, "GOLD");
    });

    await check("combined lifecycle: cancel after a PAID upgrade shows ENDING, resume restores", async () => {
      const s = subscriptions.get(karaSub.id)!;
      s.cancel_at_period_end = true;
      const event = {
        id: nextEventId(),
        type: "customer.subscription.updated",
        data: { object: { id: karaSub.id, customer: karaSub.customer } },
      };
      assert.equal((await webhookPOST(signedWebhookRequest(event))).status, 200);
      const row = await subRow(kara);
      assert.equal(row.tier, "GOLD");
      assert.equal(row.cancelAtPeriodEnd, true, "Gold ENDING until period end");
      const resumed = await resumeSubscription(kara);
      assert.equal(resumed.cancelAtPeriodEnd, false);
      assert.equal(resumed.plan, "GOLD");
      assert.equal((await subRow(kara)).providerSubId, karaSub.id, "same Gold subscription");
    });

    const liam = await seedUser("liam");
    const liamSession = (await startCheckout(liam, "PLUS", testEmail("liam"))).sessionId;
    const liamSub = completeCheckout(liamSession, { priceId: PLUS_PRICE });
    await syncStripeSubscription({
      stripeCustomerId: liamSub.customer,
      stripeSubscriptionId: liamSub.id,
    });

    await check("declined card: PAYMENT_FAILED, Plus unchanged, failed upgrade invoice in history", async () => {
      upgradeOutcome = "declined";
      const result = await changePlan(liam, "GOLD");
      assert.equal(result.outcome, "PAYMENT_FAILED");
      assert.equal(result.plan, "PLUS");
      const row = await subRow(liam);
      assert.equal(row.tier, "PLUS");
      assert.equal(row.stripePriceId, PLUS_PRICE);
      assert.equal((await getUserEntitlements(liam)).plan, "PLUS");
      const failed = await db.payment.findFirstOrThrow({
        where: { userId: liam, description: "Tirvea Gold - upgrade" },
      });
      assert.equal(failed.status, "FAILED", "the failed attempt is honest history");
      // No fake Gold ENDING state can exist for a failed upgrade.
      assert.equal(row.cancelAtPeriodEnd, false);
    });

    await check("pending_update_expired keeps Plus and clears the pending change", async () => {
      expirePendingUpdate(liamSub.id);
      const event = {
        id: nextEventId(),
        type: "customer.subscription.pending_update_expired",
        data: { object: { id: liamSub.id, customer: liamSub.customer } },
      };
      assert.equal((await webhookPOST(signedWebhookRequest(event))).status, 200);
      assert.equal((await subRow(liam)).tier, "PLUS");
      assert.equal((await changePlanStatus(liam)).state, "STILL_PLUS");
    });

    await check("double tap: concurrent identical upgrades produce ONE Stripe application", async () => {
      upgradeOutcome = "paid";
      const applicationsBefore = planChangeApplications;
      const subCountBefore = subscriptions.size;
      // Depending on interleaving the loser sees a replay (same
      // idempotency key), an already-applied price (ZERO_DUE), or an
      // already-upgraded row (invalid_plan_change) - every path is safe.
      const settled = await Promise.allSettled([
        changePlan(liam, "GOLD"),
        changePlan(liam, "GOLD"),
      ]);
      assert.equal(planChangeApplications, applicationsBefore + 1, "one update applied");
      assert.equal(subscriptions.size, subCountBefore, "no duplicate subscription");
      const fulfilled = settled.filter(
        (s): s is PromiseFulfilledResult<Awaited<ReturnType<typeof changePlan>>> =>
          s.status === "fulfilled",
      );
      assert.ok(
        fulfilled.some((s) => s.value.outcome === "PAID_AND_APPLIED"),
        "the winning tap paid and applied",
      );
      for (const s of settled) {
        if (s.status === "fulfilled") {
          assert.ok(
            ["PAID_AND_APPLIED", "ZERO_DUE_APPLIED"].includes(s.value.outcome),
            `unexpected outcome ${s.value.outcome}`,
          );
        } else {
          assert.ok(
            s.reason instanceof BillingError && s.reason.code === "invalid_plan_change",
            "a losing tap may only fail as already-upgraded",
          );
        }
      }
      assert.equal((await subRow(liam)).tier, "GOLD");
      assert.equal(
        await db.payment.count({
          where: { userId: liam, description: "Tirvea Gold - upgrade", status: "SUCCEEDED" },
        }),
        1,
        "one upgrade invoice in history",
      );
    });

    await check("zero-due upgrade applies ONLY on Stripe's confirmation (fresh price, no pending)", async () => {
      const mona = await seedUser("mona");
      const monaSession = (await startCheckout(mona, "PLUS", testEmail("mona"))).sessionId;
      const monaSub = completeCheckout(monaSession, { priceId: PLUS_PRICE });
      await syncStripeSubscription({
        stripeCustomerId: monaSub.customer,
        stripeSubscriptionId: monaSub.id,
      });
      upgradeOutcome = "zero_due";
      const result = await changePlan(mona, "GOLD");
      assert.equal(result.outcome, "ZERO_DUE_APPLIED");
      assert.equal(result.plan, "GOLD");
      assert.equal(subscriptions.get(monaSub.id)!.pending_update, null);
      assert.equal((await subRow(mona)).tier, "GOLD");
      upgradeOutcome = "paid"; // restore default
    });

    // -----------------------------------------------------------------------
    // Lifecycle: portal cancel -> resume -> expire, dunning retry,
    // invoice-backed payment history, reconcile-on-view
    // -----------------------------------------------------------------------
    const harry = await seedUser("harry");
    const harrySession = (await startCheckout(harry, "GOLD", testEmail("harry"))).sessionId;
    const harrySub = completeCheckout(harrySession, { priceId: GOLD_PRICE });
    const harryCustomer = harrySub.customer;

    await check("portal cancel: cancel_at_period_end flows back via webhook reconciliation", async () => {
      await syncStripeSubscription({
        stripeCustomerId: harryCustomer,
        stripeSubscriptionId: harrySub.id,
      });
      // The user cancels in the Stripe portal - Stripe flags the sub...
      const s = subscriptions.get(harrySub.id)!;
      s.cancel_at_period_end = true;
      s.cancel_at = s.items?.data?.[0]?.current_period_end ?? null;
      // ...and the webhook lands.
      const event = {
        id: nextEventId(),
        type: "customer.subscription.updated",
        data: { object: { id: harrySub.id, customer: harryCustomer } },
      };
      assert.equal((await webhookPOST(signedWebhookRequest(event))).status, 200);
      const row = await subRow(harry);
      assert.equal(row.cancelAtPeriodEnd, true);
      assert.equal(row.tier, "GOLD");
      assert.equal(row.status, "ACTIVE");
      // Scheduled-to-end stays entitled until it actually ends.
      assert.equal((await getUserEntitlements(harry)).plan, "GOLD");
    });

    await check("resume clears cancel_at_period_end on the SAME subscription - nothing new is created", async () => {
      const before = await subRow(harry);
      const subCount = subscriptions.size;
      const custCount = customers.size;
      const result = await resumeSubscription(harry);
      assert.equal(result.cancelAtPeriodEnd, false);
      assert.equal(result.plan, "GOLD");
      const call = cancellationCalls[cancellationCalls.length - 1];
      assert.equal(call.subscriptionId, harrySub.id);
      assert.equal(call.cancelAtPeriodEnd, false);
      const row = await subRow(harry);
      assert.equal(row.cancelAtPeriodEnd, false);
      assert.equal(row.providerSubId, before.providerSubId, "same subscription");
      assert.equal(row.providerCustomerId, before.providerCustomerId, "same customer");
      assert.equal(subscriptions.size, subCount, "no duplicate subscription");
      assert.equal(customers.size, custCount, "no duplicate customer");
    });

    await check("resume guards: not scheduled -> not_ending; no subscription -> no_subscription", async () => {
      await assert.rejects(
        () => resumeSubscription(harry),
        (e: unknown) => e instanceof BillingError && e.code === "not_ending",
      );
      const nora = await seedUser("nora");
      await assert.rejects(
        () => resumeSubscription(nora),
        (e: unknown) => e instanceof BillingError && e.code === "no_subscription",
      );
    });

    await check("portal resume reconciles the same way (webhook only)", async () => {
      const s = subscriptions.get(harrySub.id)!;
      s.cancel_at_period_end = true;
      s.cancel_at = s.items?.data?.[0]?.current_period_end ?? null;
      await syncStripeSubscription({ stripeCustomerId: harryCustomer, stripeSubscriptionId: harrySub.id });
      assert.equal((await subRow(harry)).cancelAtPeriodEnd, true);
      // Resumed in the portal:
      s.cancel_at_period_end = false;
      s.cancel_at = null;
      const event = {
        id: nextEventId(),
        type: "customer.subscription.updated",
        data: { object: { id: harrySub.id, customer: harryCustomer } },
      };
      assert.equal((await webhookPOST(signedWebhookRequest(event))).status, 200);
      assert.equal((await subRow(harry)).cancelAtPeriodEnd, false);
    });

    await check("cancel_at (date-based) also reads as scheduled-to-end", async () => {
      const s = subscriptions.get(harrySub.id)!;
      s.cancel_at = Math.floor(Date.now() / 1000) + 10 * 24 * 3600;
      s.cancel_at_period_end = false; // date-based, not period-end-based
      await syncStripeSubscription({ stripeCustomerId: harryCustomer, stripeSubscriptionId: harrySub.id });
      assert.equal((await subRow(harry)).cancelAtPeriodEnd, true);
      s.cancel_at = null;
      await syncStripeSubscription({ stripeCustomerId: harryCustomer, stripeSubscriptionId: harrySub.id });
      assert.equal((await subRow(harry)).cancelAtPeriodEnd, false);
    });

    await check("reconcile-on-view: a portal cancellation is visible with NO webhook at all", async () => {
      const s = subscriptions.get(harrySub.id)!;
      s.cancel_at_period_end = true; // portal cancel; webhook never arrives
      // Age the cache beyond the 60s throttle so the page re-syncs.
      await db.subscription.update({
        where: { userId: harry },
        data: { syncedAt: new Date(Date.now() - 120_000) },
      });
      const row = await reconcileBilling(harry);
      assert.equal(row?.cancelAtPeriodEnd, true, "Stripe is the source of truth");
      // Fresh syncs are throttled: a change inside the window serves cache.
      s.cancel_at_period_end = false;
      const cached = await reconcileBilling(harry);
      assert.equal(cached?.cancelAtPeriodEnd, true, "cached row inside throttle window");
      // restore for later checks
      await db.subscription.update({
        where: { userId: harry },
        data: { syncedAt: new Date(Date.now() - 120_000) },
      });
      await reconcileBilling(harry);
      assert.equal((await subRow(harry)).cancelAtPeriodEnd, false);
    });

    await check("reconcile-on-view heals payment history from Stripe invoices", async () => {
      // harry's first charge exists ONLY at Stripe (his checkout webhook
      // "never arrived") - the billing page backfills it from invoices.
      const row = await subRow(harry);
      assert.equal(await db.payment.count({ where: { userId: harry } }), 1);
      const payment = await db.payment.findFirstOrThrow({ where: { userId: harry } });
      assert.equal(payment.status, "SUCCEEDED");
      assert.equal(payment.amountCents, 2999);
      assert.equal(payment.currency, "eur");
      assert.equal(payment.description, "Tirvea Gold");
      assert.ok(payment.invoiceUrl?.includes("invoice.stripe.com"));
      assert.ok(payment.receiptUrl?.includes(".pdf"));
      assert.ok(row);
    });

    await check("expired: subscription.deleted keeps the PRIOR plan story, grants nothing", async () => {
      const s = subscriptions.get(harrySub.id)!;
      s.status = "canceled";
      s.canceled_at = Math.floor(Date.now() / 1000);
      const event = {
        id: nextEventId(),
        type: "customer.subscription.deleted",
        data: { object: { id: harrySub.id, customer: harryCustomer } },
      };
      assert.equal((await webhookPOST(signedWebhookRequest(event))).status, 200);
      const row = await subRow(harry);
      assert.equal(row.tier, "FREE");
      assert.equal(row.status, "CANCELED");
      assert.ok(row.canceledAt, "when it ended is recorded");
      assert.ok(row.currentPeriodEnd, "period end kept for the 'ended on' story");
      // The page derives "your GOLD membership ended" from the kept price id.
      assert.equal(planForPriceId(row.stripePriceId), "GOLD");
      assert.equal((await getUserEntitlements(harry)).plan, "FREE", "no entitlement leak");
    });

    await check("resume after expiry is refused - the path back is checkout", async () => {
      await assert.rejects(
        () => resumeSubscription(harry),
        (e: unknown) => e instanceof BillingError && e.code === "no_subscription",
      );
    });

    // --- Dunning: failed payment -> retry ---------------------------------
    const iris = await seedUser("iris");
    const irisSession = (await startCheckout(iris, "PLUS", testEmail("iris"))).sessionId;
    const irisSub = completeCheckout(irisSession, { priceId: PLUS_PRICE });
    const irisCustomer = irisSub.customer;

    await check("invoice.payment_failed records a FAILED payment row + PAST_DUE", async () => {
      await syncStripeSubscription({ stripeCustomerId: irisCustomer, stripeSubscriptionId: irisSub.id });
      const renewal = registerInvoice(irisCustomer, {
        priceId: PLUS_PRICE,
        amountCents: 1499,
        status: "open",
        attempted: true,
      });
      subscriptions.get(irisSub.id)!.status = "past_due";
      const event = {
        id: nextEventId(),
        type: "invoice.payment_failed",
        data: { object: { ...renewal, subscription: irisSub.id } },
      };
      assert.equal((await webhookPOST(signedWebhookRequest(event))).status, 200);
      const row = await subRow(iris);
      assert.equal(row.status, "PAST_DUE");
      const failed = await db.payment.findUniqueOrThrow({
        where: { providerPaymentId: renewal.id },
      });
      assert.equal(failed.status, "FAILED");
      assert.equal(failed.amountCents, 1499);
      assert.equal(failed.description, "Tirvea Plus");
    });

    await check("retry payment: declined card answers payment_failed and changes nothing", async () => {
      payInvoiceOutcome = "declined";
      await assert.rejects(
        () => retryPayment(iris),
        (e: unknown) => e instanceof BillingError && e.code === "payment_failed",
      );
      assert.equal((await subRow(iris)).status, "PAST_DUE");
    });

    await check("retry payment: success collects the invoice and reactivates via the shared sync", async () => {
      payInvoiceOutcome = "paid";
      const openInvoice = [...invoices.values()].find(
        (i) => i.customer === irisCustomer && i.status === "open",
      )!;
      const result = await retryPayment(iris);
      assert.equal(payInvoiceCalls[payInvoiceCalls.length - 1], openInvoice.id);
      assert.equal(result.status, "ACTIVE");
      const flipped = await db.payment.findUniqueOrThrow({
        where: { providerPaymentId: openInvoice.id },
      });
      assert.equal(flipped.status, "SUCCEEDED", "FAILED row flips to paid, no duplicate");
      assert.equal((await getUserEntitlements(iris)).plan, "PLUS");
    });

    await check("retry payment with nothing outstanding answers no_open_invoice", async () => {
      await assert.rejects(
        () => retryPayment(iris),
        (e: unknown) => e instanceof BillingError && e.code === "no_open_invoice",
      );
    });

    // --- Payment history: invoices are the source, never duplicated -------
    await check("checkout charge + its invoice.paid webhook = ONE payment row", async () => {
      const event = {
        id: nextEventId(),
        type: "checkout.session.completed",
        data: { object: { ...sessions.get(irisSession)! } },
      };
      assert.equal((await webhookPOST(signedWebhookRequest(event))).status, 200);
      const checkoutInvoiceId = sessions.get(irisSession)!.invoice!;
      const paidEvent = {
        id: nextEventId(),
        type: "invoice.paid",
        data: { object: { ...invoices.get(checkoutInvoiceId)!, subscription: irisSub.id } },
      };
      assert.equal((await webhookPOST(signedWebhookRequest(paidEvent))).status, 200);
      assert.equal(
        await db.payment.count({
          where: { userId: iris, providerPaymentId: checkoutInvoiceId },
        }),
        1,
        "keyed by invoice id - the same charge never appears twice",
      );
    });

    await check("invoice.paid records renewals (not just the first checkout)", async () => {
      const before = await db.payment.count({ where: { userId: iris } });
      const renewal = registerInvoice(irisCustomer, { priceId: PLUS_PRICE, amountCents: 1499 });
      const event = {
        id: nextEventId(),
        type: "invoice.paid",
        data: { object: { ...renewal, subscription: irisSub.id } },
      };
      assert.equal((await webhookPOST(signedWebhookRequest(event))).status, 200);
      assert.equal(await db.payment.count({ where: { userId: iris } }), before + 1);
      const row = await db.payment.findUniqueOrThrow({
        where: { providerPaymentId: renewal.id },
      });
      assert.equal(row.description, "Tirvea Plus");
      assert.ok(row.invoiceUrl && row.receiptUrl, "invoice and receipt links kept");
    });

    await check("pending_update applied/expired events reconcile via refetch-latest", async () => {
      // A payment-gated change rolled back at Stripe: refetch-latest just
      // lands whatever Stripe now says.
      subscriptions.get(irisSub.id)!.items!.data![0].price = { id: GOLD_PRICE };
      const applied = {
        id: nextEventId(),
        type: "customer.subscription.pending_update_applied",
        data: { object: { id: irisSub.id, customer: irisCustomer } },
      };
      assert.equal((await webhookPOST(signedWebhookRequest(applied))).status, 200);
      assert.equal((await subRow(iris)).tier, "GOLD");
      subscriptions.get(irisSub.id)!.items!.data![0].price = { id: PLUS_PRICE };
      const expired = {
        id: nextEventId(),
        type: "customer.subscription.pending_update_expired",
        data: { object: { id: irisSub.id, customer: irisCustomer } },
      };
      assert.equal((await webhookPOST(signedWebhookRequest(expired))).status, 200);
      assert.equal((await subRow(iris)).tier, "PLUS");
    });

    await check("portal deep-link: payment_method_update flow reaches Stripe", async () => {
      await createPortalSession(iris, "payment_method_update");
      assert.equal(portalCalls[portalCalls.length - 1].flow, "payment_method_update");
      await createPortalSession(iris);
      assert.equal(portalCalls[portalCalls.length - 1].flow, undefined);
    });

    // -----------------------------------------------------------------------
    // Env validation
    // -----------------------------------------------------------------------
    await check("case 19a: identical PLUS/GOLD price ids fail validation", () => {
      const report = validateStripeEnvStatic({
        secretKey: "sk_test_x",
        webhookSecret: "whsec_x",
        plusPriceId: "price_same",
        goldPriceId: "price_same",
      });
      assert.ok(report.problems.some((p) => p.includes("identical")));
    });

    await check("case 19b: missing webhook secret in production is a named problem", () => {
      const report = validateStripeEnvStatic({
        secretKey: "sk_live_x",
        plusPriceId: "price_a",
        goldPriceId: "price_b",
        production: true,
      });
      assert.ok(report.problems.some((p) => p.includes("STRIPE_WEBHOOK_SECRET")));
      assert.ok(!report.problems.join(" ").includes("sk_live_x"), "never leak key material");
    });

    await check("case 19c: malformed key format is flagged", () => {
      const report = validateStripeEnvStatic({
        secretKey: "not_a_stripe_key",
        webhookSecret: "whsec_x",
        plusPriceId: "price_a",
        goldPriceId: "price_b",
      });
      assert.ok(report.problems.some((p) => p.includes("STRIPE_SECRET_KEY")));
    });

    await check("case 19d: deep validation verifies EUR/monthly/amounts via the client", async () => {
      resetStripeEnvDeepCache();
      const good = await validateStripeEnvDeep(true);
      assert.equal(good.problems.length, 0, JSON.stringify(good.problems));
      // Wrong amount -> named problem; resource_missing -> mode-mismatch hint.
      priceCatalogue.set(PLUS_PRICE, { currency: "usd", unit_amount: 999, interval: "year" });
      const bad = await validateStripeEnvDeep(true);
      assert.ok(bad.problems.some((p) => p.includes("currency")));
      assert.ok(bad.problems.some((p) => p.includes("amount")));
      assert.ok(bad.problems.some((p) => p.includes("interval")));
      priceCatalogue.delete(GOLD_PRICE);
      const missing = await validateStripeEnvDeep(true);
      assert.ok(missing.problems.some((p) => p.includes("mode mismatch")));
      // restore
      priceCatalogue.set(PLUS_PRICE, { currency: "eur", unit_amount: 1499, interval: "month" });
      priceCatalogue.set(GOLD_PRICE, { currency: "eur", unit_amount: 2999, interval: "month" });
      resetStripeEnvDeepCache();
    });

    // -----------------------------------------------------------------------
    // Route-level (needs the dev server; skipped when it is not running)
    // -----------------------------------------------------------------------
    const base = process.env.TEST_BASE_URL ?? "http://localhost:3000";
    const reachable = await fetch(`${base}/api/health`).then(
      (r) => r.ok,
      () => false,
    );
    if (!reachable) {
      skip("case 3: unauthenticated POST /api/billing/checkout answers 401", "dev server not running");
      skip("unauthenticated GET /api/billing/checkout-status answers 401", "dev server not running");
      skip("unauthenticated POST /api/billing/portal answers 401", "dev server not running");
      skip("unauthenticated POST /api/billing/change-plan answers 401", "dev server not running");
      skip("unauthenticated POST /api/billing/resume and /retry-payment answer 401", "dev server not running");
    } else {
      await check("case 3: unauthenticated POST /api/billing/checkout answers 401", async () => {
        const res = await fetch(`${base}/api/billing/checkout`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ plan: "PLUS" }),
        });
        assert.equal(res.status, 401);
      });
      await check("unauthenticated GET /api/billing/checkout-status answers 401", async () => {
        const res = await fetch(`${base}/api/billing/checkout-status?session_id=cs_x`);
        assert.equal(res.status, 401);
      });
      await check("unauthenticated POST /api/billing/portal answers 401", async () => {
        const res = await fetch(`${base}/api/billing/portal`, { method: "POST" });
        assert.equal(res.status, 401);
      });
      await check("unauthenticated POST /api/billing/change-plan answers 401", async () => {
        const res = await fetch(`${base}/api/billing/change-plan`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ plan: "GOLD" }),
        });
        assert.equal(res.status, 401);
      });
      await check("unauthenticated POST /api/billing/resume and /retry-payment answer 401", async () => {
        for (const path of ["/api/billing/resume", "/api/billing/retry-payment"]) {
          const res = await fetch(`${base}${path}`, { method: "POST" });
          assert.equal(res.status, 401, path);
        }
      });
    }

    console.log(`\n${passed} checks passed`);
  } finally {
    await db.payment.deleteMany({ where: { userId: { in: userIds } } });
    await db.subscription.deleteMany({ where: { userId: { in: userIds } } });
    await db.stripeEvent.deleteMany({ where: { id: { in: eventIds } } });
    await db.user.deleteMany({ where: { id: { in: userIds } } });
    await db.$disconnect();
  }
}

main().catch((error) => {
  console.error("\nFAILED:", error);
  process.exitCode = 1;
});
