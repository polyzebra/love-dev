import type { Metadata } from "next";
import Link from "next/link";
import {
  CheckCircle2,
  CreditCard,
  ExternalLink,
  Hourglass,
  Receipt,
  RotateCcw,
  Sparkles,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import { requireUser } from "@/lib/auth/require-user";
import { db } from "@/lib/db";
import { PLANS, upgradePlansFor } from "@/lib/constants";
import { effectiveTier } from "@/lib/services/entitlements";
import { hasLiveSubscription } from "@/lib/services/billing";
import type { PaymentStatus } from "@/generated/prisma/enums";
import { cn } from "@/lib/utils";
import { SettingsSubheader } from "@/components/settings/settings-subheader";
import { Badge } from "@/components/ui/badge";
import { ManageBillingButton } from "@/components/billing/manage-billing-button";
import { PricingSpotlight } from "@/components/marketing/pricing-spotlight";
import { EmptyState } from "@/components/shared/empty-state";
import { Reveal } from "@/components/fx/reveal";

export const metadata: Metadata = { title: "Subscription & billing" };

// Billing state must be fresh the moment the confirm page redirects here -
// never serve a cached render of someone's plan.
export const dynamic = "force-dynamic";

const formatDate = (d: Date) =>
  d.toLocaleDateString("en-IE", { day: "numeric", month: "long", year: "numeric" });

const price = (cents: number) => `€${(cents / 100).toFixed(2)}`;

/** Payment timeline registers - same icon/badge vocabulary as the appeal timeline. */
const PAYMENT_ICON: Record<PaymentStatus, { icon: LucideIcon; className: string }> = {
  SUCCEEDED: { icon: CheckCircle2, className: "text-success" },
  FAILED: { icon: XCircle, className: "text-muted-foreground" },
  PENDING: { icon: Hourglass, className: "text-gold" },
  REFUNDED: { icon: RotateCcw, className: "text-muted-foreground" },
};

const PAYMENT_BADGE: Record<PaymentStatus, "secondary" | "destructive" | "outline"> = {
  SUCCEEDED: "secondary",
  FAILED: "destructive",
  PENDING: "outline",
  REFUNDED: "outline",
};

/**
 * The billing home. Everything shown here is persisted, Stripe-verified
 * state (Subscription/Payment rows) - the page reads the database on
 * every render and displays the EFFECTIVE plan (same status policy the
 * entitlement gates use), so what the user sees is what the product
 * enforces. Plan naming is exact: Tirvea Free / Tirvea Plus / Tirvea Gold.
 *
 * Design register: the membership hero reuses the pricing spotlight
 * surface (border-glow glass stage) and the profile page's editorial
 * type; the upgrade section IS the pricing spotlight (embedded variant);
 * the payment history matches the appeal-timeline register.
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

  // THE shared predicate from services/billing.ts - the same test that
  // makes POST /checkout answer 409 decides which upgrade path the page
  // offers: checkout (no live sub) vs in-place plan change (live sub).
  const hasLiveSub = hasLiveSubscription(subscription);
  const hasBillingProfile = Boolean(subscription?.providerCustomerId);

  const pastDue = subscription?.status === "PAST_DUE";

  // Upgrade cards derive from the canonical FREE < PLUS < GOLD hierarchy:
  // strictly-higher tiers than the plan the user holds. Gold members get
  // no upgrade section at all; past-due members fix their payment first.
  const upgradeTargets = upgradePlansFor(hasLiveSub ? subscription.tier : "FREE");
  const showUpgrades = upgradeTargets.length > 0 && !pastDue;
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

  // The membership chip - one calm word about where the plan stands.
  const membershipChip = pastDue
    ? { label: "Payment past due", className: "text-warning" }
    : !paid
      ? { label: "Free plan", className: "text-muted-foreground" }
      : subscription?.cancelAtPeriodEnd
        ? { label: "Ends soon", className: "text-muted-foreground" }
        : subscription?.status === "TRIALING"
          ? { label: "Trial", className: "text-gold" }
          : { label: "Active", className: "text-gold" };

  return (
    <>
      <SettingsSubheader
        backHref="/settings"
        backLabel="Back to settings"
        title="Subscription"
        description="Your plan, invoices and receipts."
      />

      {/* ============ MEMBERSHIP HERO - the pricing stage material ============ */}
      <Reveal y={16}>
        <section
          aria-labelledby="current-plan-heading"
          className="border-glow noise relative overflow-hidden rounded-[36px] bg-card/60 p-6 md:p-10"
        >
          {/* Same spotlight the pricing stage carries, centred on the plan */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -top-40 left-1/2 size-[30rem] -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,color-mix(in_srgb,var(--primary)_18%,transparent),transparent_70%)] blur-2xl"
          />

          <div className="relative space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p
                id="current-plan-heading"
                className="text-xs font-semibold uppercase tracking-[0.3em] text-gold"
              >
                Current plan
              </p>
              <span
                className={cn(
                  "glass-chip inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-widest",
                  membershipChip.className,
                )}
              >
                {(paid && !pastDue && !subscription?.cancelAtPeriodEnd) && (
                  <Sparkles className="size-3" aria-hidden="true" />
                )}
                {membershipChip.label}
              </span>
            </div>

            <div>
              <h2 className="font-display text-3xl font-medium tracking-tight md:text-4xl">
                {plan.name}
              </h2>
              {paid && (
                <p className="mt-2 flex items-baseline gap-2">
                  <span className="font-display text-5xl font-medium tracking-tight">
                    {price(plan.priceMonthlyCents)}
                  </span>
                  <span className="text-muted-foreground">/ month, VAT included</span>
                </p>
              )}
            </div>

            <p className="max-w-md text-sm text-muted-foreground md:text-base">{statusLine}</p>

            {/* Dunning warning while the paid tier is still honored (grace). */}
            {paid && pastDue && (
              <div className="glass rounded-2xl px-5 py-4 text-sm">
                <p className="font-medium">Your last payment didn&apos;t go through.</p>
                <p className="text-muted-foreground">
                  We&apos;ll retry for a few days. Update your payment method in billing to keep{" "}
                  {plan.name}.
                </p>
              </div>
            )}

            {hasBillingProfile && (
              <div className="space-y-3 pt-1">
                <ManageBillingButton />
                {/* No Stripe brand asset ships in this repo - the lucide
                    credit-card glyph stands in as the payment mark. */}
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <CreditCard className="size-3.5" aria-hidden="true" />
                  Billed securely via Stripe
                </p>
              </div>
            )}
          </div>
        </section>
      </Reveal>

      {/* ============ UPGRADE - the same stage /pricing renders ============ */}
      {/* Directly under the current-plan hero, only the tiers ABOVE the
          user's plan (canonical hierarchy). No live subscription -> the
          cards start a checkout; a live one -> they update the existing
          Stripe subscription in place (same billing cycle, prorated) -
          nobody is sent portal-spelunking to discover Gold. */}
      {showUpgrades && (
        <Reveal>
          <section aria-labelledby="upgrade-heading" className="mt-10">
            <div className="mb-6 space-y-1 px-1">
              <h2
                id="upgrade-heading"
                className="font-display text-3xl font-medium tracking-tight md:text-4xl"
              >
                {hasLiveSub ? "Upgrade available" : "Upgrade your membership"}
              </h2>
              <p className="text-sm text-muted-foreground md:text-base">
                {hasLiveSub
                  ? "Same card, same renewal date - you only pay the prorated difference."
                  : "Billed monthly via Stripe. Cancel anytime in two taps - no dark patterns."}
              </p>
            </div>
            <PricingSpotlight
              variant="embedded"
              currentTier={hasLiveSub ? subscription.tier : "FREE"}
              hasLiveSub={hasLiveSub}
            />
          </section>
        </Reveal>
      )}

      {/* ============ PAYMENT HISTORY - appeal-timeline register ============ */}
      <Reveal>
        <section aria-labelledby="payments-heading" className="mt-10">
          <div className="mb-3 px-1">
            <h2
              id="payments-heading"
              className="text-xs font-semibold uppercase tracking-[0.3em] text-gold"
            >
              Payment history
            </h2>
          </div>

          {payments.length === 0 ? (
            <div className="rounded-3xl border border-border bg-card/80 shadow-card">
              <EmptyState
                icon={Receipt}
                title="No payments yet."
                description="When you join a plan, every receipt lands here - and in your inbox."
                className="min-h-0 px-8 py-14"
              />
            </div>
          ) : (
            <div className="overflow-hidden rounded-3xl border border-border bg-card/80 shadow-card">
              {payments.map((p, i) => {
                const receipt = p.receiptUrl ?? p.invoiceUrl;
                const { icon: Icon, className } = PAYMENT_ICON[p.status];
                const row = (
                  <>
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-foreground/5">
                      <Icon className={`size-5 ${className}`} aria-hidden="true" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">
                        {p.description ?? "Subscription"}
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        {p.createdAt.toLocaleDateString("en-IE", {
                          day: "numeric",
                          month: "short",
                          year: "numeric",
                        })}
                      </span>
                    </span>
                    <span className="flex shrink-0 flex-col items-end gap-1">
                      <span className="text-sm font-medium tabular-nums">
                        {price(p.amountCents)}
                      </span>
                      <Badge variant={PAYMENT_BADGE[p.status]} className="rounded-full">
                        {p.status.toLowerCase()}
                      </Badge>
                    </span>
                  </>
                );
                const rowClass = cn(
                  "flex min-h-11 items-center gap-4 px-5 py-4",
                  i > 0 && "border-t",
                );
                return receipt ? (
                  <Link
                    key={p.id}
                    href={receipt}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`Open receipt - ${p.description ?? "Subscription"}, ${price(p.amountCents)}`}
                    className={cn(rowClass, "transition-colors hover:bg-muted")}
                  >
                    {row}
                    <ExternalLink
                      className="size-4 shrink-0 text-muted-foreground"
                      aria-hidden="true"
                    />
                  </Link>
                ) : (
                  <div key={p.id} className={rowClass}>
                    {row}
                  </div>
                );
              })}
            </div>
          )}
          <p className="mt-3 px-1 text-xs text-muted-foreground">
            Receipts are also emailed after every payment.
          </p>
        </section>
      </Reveal>
    </>
  );
}
