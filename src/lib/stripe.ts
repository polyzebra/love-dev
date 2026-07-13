import { env, isProd } from "@/lib/env";
import { PLANS } from "@/lib/constants";
import type { PlanTier } from "@/generated/prisma/enums";

/**
 * Minimal Stripe REST client + trusted billing configuration.
 *
 * No SDK dependency: Stripe's API is plain form-encoded HTTPS, and the
 * handful of endpoints billing needs (customers, checkout sessions,
 * subscriptions, portal sessions, prices) is small enough that a thin
 * fetch client keeps the raw-body/webhook path trivially correct and the
 * whole surface injectable for tests.
 *
 * Patterns copied from the rest of the codebase:
 *  - lazy env validation (supabase/admin.ts): importing this module never
 *    throws; getStripeClient() returns null until STRIPE_SECRET_KEY is set
 *  - test injection (services/push setPushTransport): setStripeClient()
 *    swaps in a spy so unit suites make ZERO real Stripe calls
 *
 * The PRICE MAP here is the ONLY source of plan identity. A price id is
 * never accepted from the browser, and an unknown price id never grants a
 * paid tier.
 */

// ---------------------------------------------------------------------------
// Structural Stripe types (only the fields we read)
// ---------------------------------------------------------------------------

export type StripePrice = {
  id: string;
  currency?: string;
  unit_amount?: number | null;
  recurring?: { interval?: string } | null;
  active?: boolean;
};

export type StripeSubscriptionItem = {
  id?: string;
  price?: StripePrice;
  /** API 2025-03-31+ ("basil") moved billing periods onto the item. */
  current_period_start?: number;
  current_period_end?: number;
};

export type StripeSubscription = {
  id: string;
  customer: string;
  status: string;
  cancel_at_period_end?: boolean;
  /** Set for date-based cancellations AND mirrored by Stripe when
   * cancel_at_period_end is true - presence means "scheduled to end". */
  cancel_at?: number | null;
  canceled_at?: number | null;
  trial_start?: number | null;
  trial_end?: number | null;
  created?: number;
  /** Pre-basil API versions keep periods on the subscription itself. */
  current_period_start?: number;
  current_period_end?: number;
  items?: { data?: StripeSubscriptionItem[] };
  /** Present while a payment-gated plan change awaits its invoice. */
  pending_update?: Record<string, unknown> | null;
  metadata?: Record<string, string>;
};

export type StripeInvoice = {
  id: string;
  customer?: string | null;
  status?: "draft" | "open" | "paid" | "uncollectible" | "void" | null;
  amount_paid?: number;
  amount_due?: number;
  currency?: string;
  created?: number;
  attempted?: boolean;
  hosted_invoice_url?: string | null;
  invoice_pdf?: string | null;
  lines?: { data?: { price?: { id?: string } | null; pricing?: { price_details?: { price?: string } } }[] };
};

export type StripeCheckoutSession = {
  id: string;
  url?: string | null;
  customer?: string | null;
  subscription?: string | null;
  /** Invoice behind the first charge - payment rows key on it when present. */
  invoice?: string | null;
  status?: "open" | "complete" | "expired" | null;
  payment_status?: "paid" | "unpaid" | "no_payment_required" | null;
  amount_total?: number | null;
  currency?: string | null;
  hosted_invoice_url?: string | null;
  metadata?: Record<string, string> | null;
};

export type StripeCustomer = { id: string; email?: string | null };

export type StripePortalSession = { id: string; url: string };

export class StripeApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string | undefined,
    message: string,
  ) {
    super(message);
    this.name = "StripeApiError";
  }
}

export type CreateCheckoutSessionParams = {
  customer: string;
  priceId: string;
  successUrl: string;
  cancelUrl: string;
  metadata: Record<string, string>;
  subscriptionMetadata: Record<string, string>;
  idempotencyKey: string;
};

export type UpdateSubscriptionPriceParams = {
  subscriptionId: string;
  /** The existing subscription item to swap - Stripe REPLACES its price
   * in place, so no second subscription (or item) can ever appear. */
  itemId: string;
  priceId: string;
  prorationBehavior: "create_prorations" | "always_invoice" | "none";
  idempotencyKey: string;
};

/** Everything billing needs from Stripe - implemented by REST and by test spies. */
export interface StripeClient {
  createCustomer(params: {
    email?: string | null;
    metadata: Record<string, string>;
  }): Promise<StripeCustomer>;
  createCheckoutSession(params: CreateCheckoutSessionParams): Promise<StripeCheckoutSession>;
  retrieveCheckoutSession(id: string): Promise<StripeCheckoutSession>;
  retrieveSubscription(id: string): Promise<StripeSubscription>;
  /** In-place plan change on an EXISTING subscription (upgrade path):
   * same subscription id, same customer, same billing cycle - only the
   * item's price changes, prorated per prorationBehavior. */
  updateSubscriptionPrice(params: UpdateSubscriptionPriceParams): Promise<StripeSubscription>;
  /** Set/clear a scheduled cancellation on the EXISTING subscription
   * (resume path clears it) - never creates or replaces anything. */
  updateSubscriptionCancellation(params: {
    subscriptionId: string;
    cancelAtPeriodEnd: boolean;
    idempotencyKey: string;
  }): Promise<StripeSubscription>;
  /** Newest-first, all statuses - callers pick the relevant one. */
  listSubscriptions(customerId: string): Promise<StripeSubscription[]>;
  /** Newest-first invoices for a customer (payment history + dunning retry). */
  listInvoices(customerId: string, status?: string): Promise<StripeInvoice[]>;
  /** Attempt collection of an open invoice with the saved payment method. */
  payInvoice(id: string, idempotencyKey: string): Promise<StripeInvoice>;
  createPortalSession(params: {
    customer: string;
    returnUrl: string;
    /** Deep-link straight to a portal flow (e.g. updating the card). */
    flow?: "payment_method_update";
  }): Promise<StripePortalSession>;
  retrievePrice(id: string): Promise<StripePrice>;
}

// ---------------------------------------------------------------------------
// Fetch-backed implementation
// ---------------------------------------------------------------------------

const STRIPE_API = "https://api.stripe.com/v1";

/** Flatten nested params to Stripe's form encoding (a[b][0][c]=v). */
export function stripeFormEncode(params: Record<string, unknown>): URLSearchParams {
  const out = new URLSearchParams();
  const walk = (value: unknown, key: string) => {
    if (value === undefined || value === null) return;
    if (Array.isArray(value)) {
      value.forEach((item, i) => walk(item, `${key}[${i}]`));
    } else if (typeof value === "object") {
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        walk(v, key ? `${key}[${k}]` : k);
      }
    } else {
      out.append(key, String(value));
    }
  };
  for (const [k, v] of Object.entries(params)) walk(v, k);
  return out;
}

function restClient(secretKey: string): StripeClient {
  async function request<T>(
    method: "GET" | "POST",
    path: string,
    params?: Record<string, unknown>,
    idempotencyKey?: string,
  ): Promise<T> {
    const body = method === "POST" && params ? stripeFormEncode(params).toString() : undefined;
    const query =
      method === "GET" && params ? `?${stripeFormEncode(params).toString()}` : "";
    const res = await fetch(`${STRIPE_API}${path}${query}`, {
      method,
      headers: {
        Authorization: `Bearer ${secretKey}`,
        ...(body !== undefined
          ? { "Content-Type": "application/x-www-form-urlencoded" }
          : {}),
        ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
      },
      body,
    });
    const json = (await res.json().catch(() => ({}))) as {
      error?: { code?: string; message?: string };
    };
    if (!res.ok) {
      throw new StripeApiError(
        res.status,
        json.error?.code,
        json.error?.message ?? `Stripe ${method} ${path} failed (${res.status})`,
      );
    }
    return json as T;
  }

  return {
    createCustomer: ({ email, metadata }) =>
      request<StripeCustomer>("POST", "/customers", {
        ...(email ? { email } : {}),
        metadata,
      }),
    createCheckoutSession: (p) =>
      request<StripeCheckoutSession>(
        "POST",
        "/checkout/sessions",
        {
          mode: "subscription",
          customer: p.customer,
          line_items: [{ price: p.priceId, quantity: 1 }],
          success_url: p.successUrl,
          cancel_url: p.cancelUrl,
          metadata: p.metadata,
          subscription_data: { metadata: p.subscriptionMetadata },
        },
        p.idempotencyKey,
      ),
    retrieveCheckoutSession: (id) =>
      request<StripeCheckoutSession>("GET", `/checkout/sessions/${encodeURIComponent(id)}`),
    retrieveSubscription: (id) =>
      request<StripeSubscription>("GET", `/subscriptions/${encodeURIComponent(id)}`),
    updateSubscriptionPrice: (p) =>
      request<StripeSubscription>(
        "POST",
        `/subscriptions/${encodeURIComponent(p.subscriptionId)}`,
        {
          items: [{ id: p.itemId, price: p.priceId }],
          proration_behavior: p.prorationBehavior,
          // billing_cycle_anchor is deliberately NOT sent: Stripe's
          // default ("unchanged") preserves the existing billing cycle.
        },
        p.idempotencyKey,
      ),
    updateSubscriptionCancellation: (p) =>
      request<StripeSubscription>(
        "POST",
        `/subscriptions/${encodeURIComponent(p.subscriptionId)}`,
        { cancel_at_period_end: p.cancelAtPeriodEnd },
        p.idempotencyKey,
      ),
    listSubscriptions: async (customerId) => {
      const page = await request<{ data?: StripeSubscription[] }>("GET", "/subscriptions", {
        customer: customerId,
        status: "all",
        limit: 10,
      });
      return page.data ?? [];
    },
    listInvoices: async (customerId, status) => {
      const page = await request<{ data?: StripeInvoice[] }>("GET", "/invoices", {
        customer: customerId,
        limit: 24,
        ...(status ? { status } : {}),
      });
      return page.data ?? [];
    },
    payInvoice: (id, idempotencyKey) =>
      request<StripeInvoice>(
        "POST",
        `/invoices/${encodeURIComponent(id)}/pay`,
        {},
        idempotencyKey,
      ),
    createPortalSession: ({ customer, returnUrl, flow }) =>
      request<StripePortalSession>("POST", "/billing_portal/sessions", {
        customer,
        return_url: returnUrl,
        ...(flow ? { flow_data: { type: flow } } : {}),
      }),
    retrievePrice: (id) =>
      request<StripePrice>("GET", `/prices/${encodeURIComponent(id)}`),
  };
}

// ---------------------------------------------------------------------------
// Lazy singleton + test injection
// ---------------------------------------------------------------------------

let injected: StripeClient | null = null;
let cached: StripeClient | null = null;

/** Test hook: inject a spy client (pass null to restore the real one). */
export function setStripeClient(client: StripeClient | null): void {
  injected = client;
  cached = null;
}

/** Null until STRIPE_SECRET_KEY is configured - callers degrade to 503. */
export function getStripeClient(): StripeClient | null {
  if (injected) return injected;
  if (cached) return cached;
  const key = env.STRIPE_SECRET_KEY;
  if (!key) return null;
  cached = restClient(key);
  return cached;
}

export function stripeConfigured(): boolean {
  return injected !== null || Boolean(env.STRIPE_SECRET_KEY);
}

// ---------------------------------------------------------------------------
// Trusted price map - the ONLY place a price id becomes a plan
// ---------------------------------------------------------------------------

export const PAID_PLANS = ["PLUS", "GOLD"] as const;
export type PaidPlan = (typeof PAID_PLANS)[number];

/** Expected live catalogue - EUR monthly, derived from the ONE plan
 * pricing source (PLANS in lib/constants) so UI and Stripe validation
 * can never drift apart. */
const planPriceCents = (tier: PaidPlan): number =>
  PLANS.find((p) => p.tier === tier)!.priceMonthlyCents;

export const PLAN_PRICE_EXPECTATIONS: Record<
  PaidPlan,
  { amountCents: number; currency: string; interval: string }
> = {
  PLUS: { amountCents: planPriceCents("PLUS"), currency: "eur", interval: "month" },
  GOLD: { amountCents: planPriceCents("GOLD"), currency: "eur", interval: "month" },
};

export function stripePriceIdFor(plan: PaidPlan): string | null {
  const id =
    plan === "PLUS" ? env.STRIPE_PLUS_MONTHLY_PRICE_ID : env.STRIPE_GOLD_MONTHLY_PRICE_ID;
  return id ?? null;
}

/** Reverse lookup; unknown price ids answer null and must NEVER grant a paid tier. */
export function planForPriceId(priceId: string | null | undefined): PlanTier | null {
  if (!priceId) return null;
  if (priceId === env.STRIPE_PLUS_MONTHLY_PRICE_ID) return "PLUS";
  if (priceId === env.STRIPE_GOLD_MONTHLY_PRICE_ID) return "GOLD";
  return null;
}

// ---------------------------------------------------------------------------
// Configuration validation (static + deep)
// ---------------------------------------------------------------------------

export type StripeEnvReport = {
  configured: boolean;
  problems: string[];
};

export type StripeEnvInput = {
  secretKey?: string;
  webhookSecret?: string;
  plusPriceId?: string;
  goldPriceId?: string;
  production?: boolean;
};

/**
 * Static, no-network sanity of the billing env. Never throws and never
 * logs a secret - problems name variables only. Used by /api/health and
 * logged loudly at first billing use. `input` exists for tests; callers
 * omit it to validate the real environment.
 */
export function validateStripeEnvStatic(input?: StripeEnvInput): StripeEnvReport {
  const problems: string[] = [];
  const key = input ? input.secretKey : env.STRIPE_SECRET_KEY;
  const plus = input ? input.plusPriceId : env.STRIPE_PLUS_MONTHLY_PRICE_ID;
  const gold = input ? input.goldPriceId : env.STRIPE_GOLD_MONTHLY_PRICE_ID;
  const webhookSecret = input ? input.webhookSecret : env.STRIPE_WEBHOOK_SECRET;
  const production = input?.production ?? isProd;

  if (key && !/^(sk|rk)_(test|live)_/.test(key)) {
    problems.push("STRIPE_SECRET_KEY has an unexpected format (expected sk_test_/sk_live_)");
  }
  if (plus && !plus.startsWith("price_")) {
    problems.push("STRIPE_PLUS_MONTHLY_PRICE_ID is not a price_ id");
  }
  if (gold && !gold.startsWith("price_")) {
    problems.push("STRIPE_GOLD_MONTHLY_PRICE_ID is not a price_ id");
  }
  if (plus && gold && plus === gold) {
    problems.push("STRIPE_PLUS_MONTHLY_PRICE_ID and STRIPE_GOLD_MONTHLY_PRICE_ID are identical");
  }
  if (key) {
    if (!plus) problems.push("STRIPE_PLUS_MONTHLY_PRICE_ID is missing");
    if (!gold) problems.push("STRIPE_GOLD_MONTHLY_PRICE_ID is missing");
    if (!webhookSecret) {
      problems.push(
        production
          ? "STRIPE_WEBHOOK_SECRET is missing in production - subscriptions will never sync"
          : "STRIPE_WEBHOOK_SECRET is missing",
      );
    }
  }
  return { configured: Boolean(key), problems };
}

export type StripeDeepReport = StripeEnvReport & { checkedAt: string };

let deepReport: StripeDeepReport | null = null;

/**
 * Deep validation: retrieves both prices from Stripe and verifies the
 * catalogue (EUR, monthly, 14.99/29.99). A resource_missing answer is the
 * classic live-key/test-price (or vice versa) mode mismatch and fails
 * loudly. Result is cached for the process lifetime; pass force to
 * re-check. No-op (static report only) until a key is configured.
 */
export async function validateStripeEnvDeep(force = false): Promise<StripeDeepReport> {
  if (deepReport && !force) return deepReport;
  const base = validateStripeEnvStatic();
  const problems = [...base.problems];
  const client = getStripeClient();

  if (client && base.configured) {
    for (const plan of PAID_PLANS) {
      const priceId = stripePriceIdFor(plan);
      if (!priceId) continue;
      const expect = PLAN_PRICE_EXPECTATIONS[plan];
      try {
        const price = await client.retrievePrice(priceId);
        if (price.currency && price.currency !== expect.currency) {
          problems.push(`${plan} price currency is ${price.currency}, expected ${expect.currency}`);
        }
        if (typeof price.unit_amount === "number" && price.unit_amount !== expect.amountCents) {
          problems.push(`${plan} price amount is ${price.unit_amount}, expected ${expect.amountCents}`);
        }
        if (price.recurring?.interval && price.recurring.interval !== expect.interval) {
          problems.push(`${plan} price interval is ${price.recurring.interval}, expected ${expect.interval}`);
        }
        if (price.active === false) {
          problems.push(`${plan} price is archived in Stripe`);
        }
      } catch (error) {
        if (error instanceof StripeApiError && error.code === "resource_missing") {
          problems.push(
            `${plan} price id not found with this key - likely a live/test mode mismatch between STRIPE_SECRET_KEY and the price ids`,
          );
        } else {
          problems.push(`${plan} price could not be verified (${error instanceof Error ? error.message : "unknown error"})`);
        }
      }
    }
  }

  deepReport = { configured: base.configured, problems, checkedAt: new Date().toISOString() };
  if (problems.length > 0) {
    console.error("[billing:env] Stripe configuration problems:", problems);
  }
  return deepReport;
}

/** Test hook: clear the cached deep-validation report. */
export function resetStripeEnvDeepCache(): void {
  deepReport = null;
}
