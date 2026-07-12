import type { Metadata } from "next";
import Link from "next/link";
import { ExternalLink, Receipt } from "lucide-react";
import { requireUser } from "@/lib/auth/require-user";
import { db } from "@/lib/db";
import { PLANS } from "@/lib/constants";
import { effectiveTier } from "@/lib/services/entitlements";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { CheckoutButton } from "@/components/billing/checkout-button";
import { ManageBillingButton } from "@/components/billing/manage-billing-button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata: Metadata = { title: "Subscription & billing" };

// Billing state must be fresh the moment the confirm page redirects here -
// never serve a cached render of someone's plan.
export const dynamic = "force-dynamic";

const formatDate = (d: Date) =>
  d.toLocaleDateString("en-IE", { day: "numeric", month: "long", year: "numeric" });

const price = (cents: number) => `€${(cents / 100).toFixed(2)}`;

/**
 * The billing home. Everything shown here is persisted, Stripe-verified
 * state (Subscription/Payment rows) - the page reads the database on
 * every render and displays the EFFECTIVE plan (same status policy the
 * entitlement gates use), so what the user sees is what the product
 * enforces. Plan naming is exact: Tirvea Free / Tirvea Plus / Tirvea Gold.
 */
export default async function SubscriptionSettingsPage() {
  const user = await requireUser();
  const [subscription, payments] = await Promise.all([
    db.subscription.findUnique({ where: { userId: user.id } }),
    db.payment.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      take: 12,
    }),
  ]);

  // Same policy as every entitlement gate (PAST_DUE grace, cancelAtPeriodEnd).
  const effective = effectiveTier(subscription);
  const plan = PLANS.find((p) => p.tier === effective) ?? PLANS[0];
  const paid = effective !== "FREE";

  // Mirrors LIVE_SUB_STATUSES in services/billing.ts: while one of these
  // is live, POST /checkout answers 409 - so we surface the portal, not
  // upgrade CTAs.
  const hasLiveSub =
    !!subscription &&
    subscription.tier !== "FREE" &&
    ["ACTIVE", "TRIALING", "PAST_DUE"].includes(subscription.status);
  const hasBillingProfile = Boolean(subscription?.providerCustomerId);

  const pastDue = subscription?.status === "PAST_DUE";
  const paidPlanName =
    PLANS.find((p) => p.tier === subscription?.tier)?.name ?? plan.name;

  const statusLine = !paid
    ? pastDue
      ? `${paidPlanName} is paused because your last payment failed. Update your payment method to bring it back.`
      : "You're on the free plan. Upgrade whenever you're ready - cancel in two taps."
    : subscription?.cancelAtPeriodEnd
      ? subscription.currentPeriodEnd
        ? `Cancels on ${formatDate(subscription.currentPeriodEnd)}. You keep ${plan.name} until then.`
        : `Cancels at the end of the current period. You keep ${plan.name} until then.`
      : subscription?.status === "TRIALING"
        ? subscription.trialEnd
          ? `Trial - your first billing date is ${formatDate(subscription.trialEnd)}.`
          : "Your trial is active."
        : subscription?.currentPeriodEnd
          ? `Renews on ${formatDate(subscription.currentPeriodEnd)}.`
          : plan.tagline;

  return (
    <>
      <PageHeader title="Subscription" description="Your plan, invoices and receipts." />

      <Card className="mb-6 rounded-3xl">
        <CardHeader>
          <div className="flex items-center justify-between gap-3">
            <CardTitle className="text-base">Current plan</CardTitle>
            <Badge
              variant={paid ? "default" : "secondary"}
              className="rounded-full px-3"
            >
              {plan.name}
            </Badge>
          </div>
          <CardDescription>{statusLine}</CardDescription>
        </CardHeader>
        {(paid || hasBillingProfile) && (
        <CardContent className="space-y-4">
          {paid && (
            <p className="text-sm">
              <span className="font-display text-2xl font-medium tabular-nums">
                {price(plan.priceMonthlyCents)}
              </span>{" "}
              <span className="text-muted-foreground">/ month, VAT included</span>
            </p>
          )}

          {/* Dunning warning while the paid tier is still honored (grace). */}
          {paid && pastDue && (
            <div className="rounded-2xl bg-muted px-4 py-3 text-sm">
              <p className="font-medium">Your last payment didn&apos;t go through.</p>
              <p className="text-muted-foreground">
                We&apos;ll retry for a few days. Update your payment method in billing to keep{" "}
                {plan.name}.
              </p>
            </div>
          )}

          {hasBillingProfile && <ManageBillingButton />}
        </CardContent>
        )}
      </Card>

      {/* Upgrade paths - only while no live subscription exists (a live one
          409s at checkout; plan CHANGES go through the portal above). */}
      {!hasLiveSub && (
        <Card className="mb-6 rounded-3xl">
          <CardHeader>
            <CardTitle className="text-base">Upgrade your membership</CardTitle>
            <CardDescription>
              Billed monthly via Stripe. Cancel anytime in two taps - no dark patterns.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {PLANS.filter((p) => p.tier !== "FREE").map((p) => (
              <div
                key={p.tier}
                className="flex flex-col gap-4 rounded-2xl border border-border bg-card/60 p-5 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <p className="font-medium">{p.name}</p>
                  <p className="text-sm text-muted-foreground">{p.tagline}</p>
                  <p className="mt-1 text-sm">
                    <span className="font-semibold tabular-nums">
                      {price(p.priceMonthlyCents)}
                    </span>{" "}
                    <span className="text-muted-foreground">/ month</span>
                  </p>
                </div>
                <CheckoutButton
                  plan={p.tier as "PLUS" | "GOLD"}
                  className="rounded-full px-6"
                />
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card className="rounded-3xl">
        <CardHeader>
          <CardTitle className="text-base">Payment history</CardTitle>
          <CardDescription>Receipts are also emailed after every payment.</CardDescription>
        </CardHeader>
        <CardContent>
          {payments.length === 0 ? (
            <div className="flex items-center gap-3 rounded-2xl bg-muted px-4 py-6 text-sm text-muted-foreground">
              <Receipt className="size-5" aria-hidden="true" />
              No payments yet.
            </div>
          ) : (
            <ul className="divide-y">
              {payments.map((p) => {
                const receipt = p.receiptUrl ?? p.invoiceUrl;
                return (
                  <li key={p.id} className="flex items-center justify-between gap-3 py-3 text-sm">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{p.description ?? "Subscription"}</p>
                      <p className="text-muted-foreground">
                        {p.createdAt.toLocaleDateString("en-IE", {
                          day: "numeric",
                          month: "short",
                          year: "numeric",
                        })}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-3">
                      <span className="tabular-nums">{price(p.amountCents)}</span>
                      <Badge
                        variant={p.status === "SUCCEEDED" ? "secondary" : "destructive"}
                        className="rounded-full"
                      >
                        {p.status.toLowerCase()}
                      </Badge>
                      {receipt && (
                        <Link
                          href={receipt}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-muted-foreground transition-colors hover:text-foreground"
                          aria-label="Open receipt"
                        >
                          <ExternalLink className="size-4" aria-hidden="true" />
                        </Link>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </>
  );
}
