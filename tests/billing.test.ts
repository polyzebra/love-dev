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
  StripeSubscription,
  StripeCheckoutSession,
} from "../src/lib/stripe";

process.env.AUTH_HASH_SALT = process.env.AUTH_HASH_SALT || "test-salt";
// Billing must consider itself configured so getStripeClient()/env checks
// behave like production; the spy client guarantees zero real API calls.
if (!process.env.STRIPE_SECRET_KEY?.trim()) {
  process.env.STRIPE_SECRET_KEY = "sk_test_dummy_for_tests";
}
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
    BillingError,
  } = await import("../src/lib/services/billing");
  const { getUserEntitlements, effectiveTier } = await import(
    "../src/lib/services/entitlements"
  );
  const { planTierOf } = await import("../src/lib/services/matching");
  const { checkoutSchema } = await import("../src/lib/validators/billing");
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
  const portalCalls: { customer: string; returnUrl: string }[] = [];
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
    async listSubscriptions(customerId) {
      return [...subscriptions.values()].filter((s) => s.customer === customerId);
    },
    async createPortalSession({ customer, returnUrl }) {
      portalCalls.push({ customer, returnUrl });
      return { id: `bps_test_${++seq}`, url: `https://billing.stripe.com/session/${customer}` };
    },
    async retrievePrice(id) {
      const p = priceCatalogue.get(id);
      if (!p) throw new StripeApiError(404, "resource_missing", "No such price");
      return { id, currency: p.currency, unit_amount: p.unit_amount, recurring: { interval: p.interval }, active: true };
    },
  };
  setStripeClient(spy);

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
            price: { id: opts.priceId },
            current_period_start: nowSecs,
            current_period_end: opts.periodEndSecs ?? nowSecs + 30 * 24 * 3600,
          },
        ],
      },
    };
    subscriptions.set(id, sub);
    sessions.set(sessionId, {
      ...session,
      status: "complete",
      payment_status: "paid",
      subscription: id,
      amount_total: opts.priceId === GOLD_PRICE ? 2999 : 1499,
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
