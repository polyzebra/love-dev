import type { Metadata } from "next";
import Link from "next/link";
import {
  CheckCircle2,
  CreditCard,
  ExternalLink,
  Hourglass,
  Minus,
  Receipt,
  RotateCcw,
  Sparkles,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import { requireUser } from "@/lib/auth/require-user";
import { db } from "@/lib/db";
import { PLANS, downgradeLossesFor, upgradePlansFor } from "@/lib/constants";
import { effectiveTier } from "@/lib/services/entitlements";
import { hasLiveSubscription, reconcileBilling } from "@/lib/services/billing";
import { planForPriceId } from "@/lib/stripe";
import type { PaymentStatus } from "@/generated/prisma/enums";
import { cn } from "@/lib/utils";
import { SettingsSubheader } from "@/components/settings/settings-subheader";
import { Badge } from "@/components/ui/badge";
import { ManageBillingButton } from "@/components/billing/manage-billing-button";
import { ResumeSubscriptionButton } from "@/components/billing/resume-subscription-button";
import { RetryPaymentButton } from "@/components/billing/retry-payment-button";
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

const money = (cents: number, currency: string) =>
  new Intl.NumberFormat("en-IE", {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(cents / 100);

const daysUntil = (d: Date) =>
  Math.max(0, Math.ceil((d.getTime() - Date.now()) / (24 * 3600 * 1000)));

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

const PAYMENT_LABEL: Record<PaymentStatus, string> = {
  SUCCEEDED: "paid",
  FAILED: "failed",
  PENDING: "pending",
  REFUNDED: "refunded",
};

/**
 * The complete subscription lifecycle, one state at a time. Stripe is
 * the source of truth: the page re-syncs the subscription AND the
 * invoice history on view (reconcileBilling), so a cancellation or
 * resume made in the Stripe portal renders correctly even before its
 * webhook lands.
 */
type Lifecycle = "FREE" | "ACTIVE" | "TRIAL" | "ENDING" | "PAYMENT_REQUIRED" | "EXPIRED";

export default async function SubscriptionSettingsPage() {
  const user = await requireUser();
  const subscription = await reconcileBilling(user.id);
  const payments = await db.payment.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    take: 12,
  });

  // Same policy as every entitlement gate (PAST_DUE grace, cancelAtPeriodEnd).
  const effective = effectiveTier(subscription);
  const hasLiveSub = hasLiveSubscription(subscription);

  // The paid plan a dead subscription USED to hold (row keeps the price
  // id as history) - powers the honest "your Gold membership ended" story.
  const priorTier = planForPriceId(subscription?.stripePriceId);

  const lifecycle: Lifecycle = (() => {
    if (!subscription) return "FREE";
    const s = subscription;
    if (s.tier !== "FREE" && ["PAST_DUE", "UNPAID", "INCOMPLETE"].includes(s.status)) {
      return "PAYMENT_REQUIRED";
    }
    if (hasLiveSub) {
      if (s.cancelAtPeriodEnd) return "ENDING";
      if (s.status === "TRIALING") return "TRIAL";
      return "ACTIVE";
    }
    if (
      ["CANCELED", "INCOMPLETE_EXPIRED"].includes(s.status) &&
      priorTier &&
      priorTier !== "FREE"
    ) {
      return "EXPIRED";
    }
    return "FREE";
  })();

  // Which plan the hero talks about: the held plan while any relationship
  // with Stripe is alive, Free otherwise. (effective, not row tier, keeps
  // an out-of-grace PAST_DUE honest about entitlements elsewhere.)
  const heroTier =
    lifecycle === "FREE" || lifecycle === "EXPIRED" ? "FREE" : subscription!.tier;
  const plan = PLANS.find((p) => p.tier === heroTier) ?? PLANS[0];
  const paid = heroTier !== "FREE";
  const priorPlanName = PLANS.find((p) => p.tier === priorTier)?.name ?? null;

  const periodEnd = subscription?.currentPeriodEnd ?? null;
  const endedOn = periodEnd ?? subscription?.canceledAt ?? null;
  const trialEnd = subscription?.trialEnd ?? null;

  // The membership chip - one calm word about where the plan stands.
  const membershipChip: Record<Lifecycle, { label: string; className: string }> = {
    ACTIVE: { label: "Active", className: "text-gold" },
    TRIAL: { label: "Trial", className: "text-gold" },
    ENDING: { label: "Ending", className: "text-warning" },
    PAYMENT_REQUIRED: { label: "Payment required", className: "text-warning" },
    EXPIRED: { label: "Free plan", className: "text-muted-foreground" },
    FREE: { label: "Free plan", className: "text-muted-foreground" },
  };
  const chip = membershipChip[lifecycle];

  // One honest sentence per state, under the plan name.
  const statusLine =
    lifecycle === "ACTIVE"
      ? periodEnd
        ? `Renews on ${formatDate(periodEnd)}.`
        : plan.tagline
      : lifecycle === "TRIAL"
        ? trialEnd
          ? `Trial ends in ${daysUntil(trialEnd)} days - your first billing date is ${formatDate(trialEnd)}.`
          : "Your trial is active."
        : lifecycle === "PAYMENT_REQUIRED"
          ? "We couldn't renew your subscription."
          : lifecycle === "EXPIRED"
            ? "You're on the free plan. Upgrade again anytime - cancel in two taps."
            : lifecycle === "FREE"
              ? "You're on the free plan. Upgrade whenever you're ready - cancel in two taps."
              : null; // ENDING renders its own hero block below

  // Upgrade cards: canonical hierarchy, only while it makes sense to
  // offer more - never while ending (the job is resuming, not upselling)
  // or while a payment needs fixing.
  const upgradeTargets =
    lifecycle === "ACTIVE" || lifecycle === "TRIAL"
      ? upgradePlansFor(subscription!.tier)
      : lifecycle === "FREE" || lifecycle === "EXPIRED"
        ? upgradePlansFor("FREE")
        : [];
  const showUpgrades = upgradeTargets.length > 0;

  const hasBillingProfile = Boolean(subscription?.providerCustomerId);
  const losses = lifecycle === "ENDING" ? downgradeLossesFor(subscription!.tier) : [];

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
                  chip.className,
                )}
              >
                {(lifecycle === "ACTIVE" || lifecycle === "TRIAL") && (
                  <Sparkles className="size-3" aria-hidden="true" />
                )}
                {chip.label}
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

            {/* ============ ENDING - scheduled cancellation ============ */}
            {lifecycle === "ENDING" ? (
              <div className="space-y-4">
                <div>
                  <p className="text-sm text-muted-foreground md:text-base">
                    Your {plan.name} membership stays active until
                  </p>
                  <p className="mt-1 font-display text-3xl font-medium tracking-tight md:text-4xl">
                    {periodEnd ? formatDate(periodEnd) : "the end of your billing period"}
                  </p>
                  {periodEnd && (
                    <p className="mt-1 text-sm text-muted-foreground">
                      {daysUntil(periodEnd)} days left. After that your account
                      automatically returns to Tirvea Free.
                    </p>
                  )}
                </div>
                <div className="flex flex-wrap items-start gap-3">
                  <ResumeSubscriptionButton />
                  <ManageBillingButton />
                </div>
                {losses.length > 0 && (
                  <div className="glass rounded-2xl px-5 py-4 text-sm">
                    <p className="font-medium">
                      After {periodEnd ? formatDate(periodEnd) : "your plan ends"} you will
                      lose:
                    </p>
                    <ul className="mt-2 space-y-1.5">
                      {losses.map((loss) => (
                        <li key={loss} className="flex items-start gap-2 text-muted-foreground">
                          <Minus className="mt-1 size-3.5 shrink-0" aria-hidden="true" />
                          <span>{loss}</span>
                        </li>
                      ))}
                    </ul>
                    <p className="mt-3 text-xs text-muted-foreground">
                      Everything on Tirvea Free keeps working - your profile, matches and
                      chats stay exactly as they are.
                    </p>
                  </div>
                )}
              </div>
            ) : (
              <>
                {statusLine && (
                  <p className="max-w-md text-sm text-muted-foreground md:text-base">
                    {statusLine}
                  </p>
                )}

                {/* ============ EXPIRED - the plan that ended ============ */}
                {lifecycle === "EXPIRED" && priorPlanName && (
                  <div className="glass rounded-2xl px-5 py-4 text-sm">
                    <p className="font-medium">
                      Your {priorPlanName} membership ended
                      {endedOn ? ` on ${formatDate(endedOn)}` : ""}.
                    </p>
                    <p className="text-muted-foreground">
                      Upgrade again anytime - your profile, matches and chats never went
                      anywhere.
                    </p>
                  </div>
                )}

                {/* ============ PAYMENT REQUIRED - dunning, honestly ============ */}
                {lifecycle === "PAYMENT_REQUIRED" && (
                  <div className="glass rounded-2xl px-5 py-4 text-sm">
                    <p className="font-medium">Your last payment didn&apos;t go through.</p>
                    <p className="text-muted-foreground">
                      Update your payment method and retry - or we&apos;ll keep retrying for
                      a few days.{" "}
                      {effective !== "FREE"
                        ? `You keep ${plan.name} in the meantime.`
                        : `${plan.name} is paused until the payment succeeds.`}
                    </p>
                  </div>
                )}

                <div className="flex flex-wrap items-start gap-3 pt-1">
                  {lifecycle === "PAYMENT_REQUIRED" ? (
                    <>
                      <ManageBillingButton
                        label="Update payment method"
                        variant="default"
                        flow="payment_method_update"
                      />
                      <RetryPaymentButton />
                    </>
                  ) : (
                    hasBillingProfile && <ManageBillingButton />
                  )}
                </div>
              </>
            )}

            {hasBillingProfile && (
              /* No Stripe brand asset ships in this repo - the lucide
                 credit-card glyph stands in as the payment mark. */
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <CreditCard className="size-3.5" aria-hidden="true" />
                Billed securely via Stripe
              </p>
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
              currentTier={hasLiveSub ? subscription!.tier : "FREE"}
              hasLiveSub={hasLiveSub}
            />
          </section>
        </Reveal>
      )}

      {/* ============ PAYMENT HISTORY - Stripe invoices, materialised ============ */}
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
                const { icon: Icon, className } = PAYMENT_ICON[p.status];
                return (
                  <div
                    key={p.id}
                    className={cn(
                      "flex min-h-11 flex-wrap items-center gap-x-4 gap-y-2 px-5 py-4",
                      i > 0 && "border-t",
                    )}
                  >
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
                        {" · "}
                        {p.currency.toUpperCase()}
                      </span>
                    </span>
                    <span className="flex shrink-0 flex-col items-end gap-1">
                      <span className="text-sm font-medium tabular-nums">
                        {money(p.amountCents, p.currency)}
                      </span>
                      <Badge variant={PAYMENT_BADGE[p.status]} className="rounded-full">
                        {PAYMENT_LABEL[p.status]}
                      </Badge>
                    </span>
                    {(p.receiptUrl || p.invoiceUrl) && (
                      <span className="flex w-full shrink-0 items-center justify-end gap-4 text-xs sm:w-auto">
                        {p.receiptUrl && (
                          <Link
                            href={p.receiptUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex min-h-11 items-center gap-1 text-muted-foreground underline-offset-4 hover:underline"
                            aria-label={`Download receipt - ${p.description ?? "Subscription"}`}
                          >
                            Receipt
                            <ExternalLink className="size-3" aria-hidden="true" />
                          </Link>
                        )}
                        {p.invoiceUrl && (
                          <Link
                            href={p.invoiceUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex min-h-11 items-center gap-1 text-muted-foreground underline-offset-4 hover:underline"
                            aria-label={`Open invoice - ${p.description ?? "Subscription"}`}
                          >
                            Invoice
                            <ExternalLink className="size-3" aria-hidden="true" />
                          </Link>
                        )}
                      </span>
                    )}
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
