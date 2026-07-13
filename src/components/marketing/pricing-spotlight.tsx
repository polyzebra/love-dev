"use client";

import { useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import { EASE_LUXE } from "@/lib/motion";
import { BadgeCheck, Check, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Magnetic } from "@/components/fx/magnetic";
import { CheckoutButton } from "@/components/billing/checkout-button";
import { UpgradePlanButton } from "@/components/billing/upgrade-plan-button";
import { PLANS, planRank, upgradePlansFor, type PlanTierName } from "@/lib/constants";
import { cn } from "@/lib/utils";

// HONESTY RULE: descriptions sell only what exists - unlimited likes,
// rewind, Super Likes and first-message budgets. No boosts, no "be seen
// first", no priority discovery until those mechanisms ship.
const DESCRIPTIONS: Record<string, string> = {
  FREE: "Everything you need to meet someone real. No card, no catch.",
  PLUS: "For when you're ready to move - never run out of likes, never lose a maybe.",
  GOLD: "The most Super Likes and first messages Tirvea offers - open every door yourself.",
};

function price(cents: number) {
  return cents === 0 ? "€0" : `€${(cents / 100).toFixed(2).replace(/\.00$/, "")}`;
}

/**
 * One glass stage, one plan catalogue. The selector drives an animated
 * spotlight; price and features crossfade and cascade per plan.
 *
 * THE plan-card surface for the whole product - /pricing renders the
 * "marketing" variant, /settings/subscription embeds the same component
 * (variant="embedded") - so Plus/Gold card markup exists exactly once.
 *
 * Which plans appear derives from the canonical FREE < PLUS < GOLD
 * hierarchy (planRank/upgradePlansFor in lib/constants):
 *  - marketing: the member's current plan and everything above it
 *    (anonymous visitors see all three); the current plan is labelled,
 *    never sold back to them.
 *  - embedded: ONLY strictly-higher tiers - it renders under the
 *    "Current plan" hero, so the current plan never appears as an
 *    upgrade option. A Gold member has no higher tier and the caller
 *    renders nothing.
 *
 * Which CTA appears derives from the subscription state:
 *  - no live subscription -> CheckoutButton (new Stripe subscription)
 *  - live subscription    -> UpgradePlanButton (in-place Stripe
 *    subscription UPDATE: same customer, same billing cycle, prorated -
 *    never a bounce through the Stripe portal to discover Gold)
 */
export function PricingSpotlight({
  variant = "marketing",
  currentTier = null,
  hasLiveSub = false,
}: {
  variant?: "marketing" | "embedded";
  /** The viewer's effective plan; null = anonymous visitor. */
  currentTier?: PlanTierName | null;
  /** Live Stripe subscription -> paid CTAs update it in place instead of checkout. */
  hasLiveSub?: boolean;
}) {
  const plans =
    variant === "embedded"
      ? upgradePlansFor(currentTier ?? "FREE")
      : currentTier
        ? PLANS.filter((p) => planRank(p.tier) >= planRank(currentTier))
        : PLANS;
  const firstUpgrade = currentTier ? upgradePlansFor(currentTier)[0]?.tier : undefined;
  const [tier, setTier] = useState<PlanTierName>(
    firstUpgrade ?? (plans.some((p) => p.tier === "PLUS") ? "PLUS" : plans[0]?.tier ?? "FREE"),
  );
  const plan = plans.find((p) => p.tier === tier) ?? plans[0];
  if (!plan) return null; // nothing above the current tier - caller usually guards

  const isCurrent = currentTier === plan.tier;
  const upgradeInPlace = hasLiveSub && !isCurrent && plan.tier !== "FREE";

  return (
    <div className="border-glow noise relative overflow-hidden rounded-[36px] bg-card/60 p-6 md:p-12">
      {/* Spotlight follows the selected plan */}
      <div
        aria-hidden="true"
        className={cn(
          "pointer-events-none absolute -top-40 size-[30rem] rounded-full bg-[radial-gradient(closest-side,color-mix(in_srgb,var(--primary)_18%,transparent),transparent_70%)] blur-2xl transition-all duration-700",
          plans.length === 1 || tier === "PLUS"
            ? "left-1/2 -translate-x-1/2"
            : tier === "FREE"
              ? "left-[-10%]"
              : "right-[-10%]",
        )}
      />

      {/* Plan selector - a complete tabs pattern: roving tabindex +
          arrow keys on the list, tabs wired to the stage tabpanel.
          A single remaining plan (e.g. Plus member -> only Gold above)
          needs no selector - the stage IS the upgrade card. */}
      {plans.length > 1 && (
        <div
          role="tablist"
          aria-label="Choose a plan"
          onKeyDown={(e) => {
            if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
            e.preventDefault();
            const index = plans.findIndex((p) => p.tier === tier);
            const next =
              e.key === "Home"
                ? 0
                : e.key === "End"
                  ? plans.length - 1
                  : (index + (e.key === "ArrowRight" ? 1 : -1) + plans.length) % plans.length;
            setTier(plans[next].tier);
            e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
          }}
          className="glass-chip relative mx-auto mb-10 flex w-fit max-w-full rounded-full p-1"
        >
          {plans.map((p) => {
            const active = p.tier === tier;
            return (
              <button
                key={p.tier}
                role="tab"
                id={`plan-tab-${p.tier}`}
                aria-selected={active}
                aria-controls="plan-panel"
                tabIndex={active ? 0 : -1}
                onClick={() => setTier(p.tier)}
                className={cn(
                  "tap-target relative whitespace-nowrap rounded-full px-3.5 py-2 text-sm font-semibold transition-colors sm:px-8",
                  active ? "text-primary-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {active && (
                  <motion.span
                    layoutId="plan-pill"
                    transition={{ type: "spring", stiffness: 350, damping: 32 }}
                    className="absolute inset-0 rounded-full bg-linear-160 from-brand-bright via-brand to-brand-active shadow-[0_6px_20px_color-mix(in_srgb,var(--primary)_40%,transparent)]"
                  />
                )}
                <span className="relative">{p.name}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* Stage */}
      <div
        role="tabpanel"
        id="plan-panel"
        aria-labelledby={plans.length > 1 ? `plan-tab-${plan.tier}` : undefined}
        aria-label={plans.length > 1 ? undefined : plan.name}
        className="relative grid items-start gap-10 md:grid-cols-[1fr_1.2fr] md:gap-16"
      >
        <AnimatePresence mode="wait">
          <motion.div
            key={plan.tier}
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -14 }}
            transition={{ duration: 0.45, ease: EASE_LUXE }}
            className="space-y-6 text-center md:text-left"
          >
            <div className="space-y-2">
              {isCurrent ? (
                <span className="glass-chip inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-widest text-gold">
                  <BadgeCheck className="size-3" aria-hidden="true" /> Your current plan
                </span>
              ) : (
                plan.tier === "PLUS" && (
                  <span className="glass-chip inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-widest text-gold">
                    <Sparkles className="size-3" aria-hidden="true" /> Most loved
                  </span>
                )
              )}
              {plans.length === 1 && (
                <h3 className="font-display text-2xl font-medium tracking-tight md:text-3xl">
                  {plan.name}
                </h3>
              )}
              <p className="flex items-baseline justify-center gap-2 md:justify-start">
                <span className="font-display text-7xl font-medium tracking-tight md:text-8xl">
                  {price(plan.priceMonthlyCents)}
                </span>
                <span className="text-muted-foreground">/ month</span>
              </p>
              <p className="mx-auto max-w-xs text-muted-foreground md:mx-0">
                {DESCRIPTIONS[plan.tier]}
              </p>
            </div>
            {isCurrent ? (
              // Never sell someone the plan they already hold - billing
              // and receipts live in settings.
              <Magnetic className="inline-block">
                <Button
                  size="lg"
                  variant="outline"
                  className="h-14 rounded-full px-10 text-base"
                  asChild
                >
                  <Link href="/settings/subscription">Manage your membership</Link>
                </Button>
              </Magnetic>
            ) : plan.tier === "FREE" ? (
              <Magnetic className="inline-block">
                <Button size="lg" className="h-14 rounded-full px-10 text-base" asChild>
                  <Link href="/login">Join free</Link>
                </Button>
              </Magnetic>
            ) : upgradeInPlace ? (
              // Live subscription: in-place Stripe subscription update -
              // "Upgrade to Tirvea Gold", right here, no portal detour.
              <UpgradePlanButton
                plan={plan.tier}
                className="h-14 rounded-full px-8 text-base"
                errorClassName="mx-auto md:mx-0"
              />
            ) : (
              // Real checkout, not a bounce through /login: POSTs
              // /api/billing/checkout and redirects to Stripe. Signed-out
              // visitors get /login?callbackUrl=/pricing from the 401.
              <CheckoutButton
                plan={plan.tier}
                className="h-14 rounded-full px-8 text-base"
                errorClassName="mx-auto md:mx-0"
              />
            )}
            <p className="text-xs text-muted-foreground">
              {upgradeInPlace
                ? "Prorated - you only pay the difference · Same renewal date · Billed via Stripe"
                : "Prices include VAT · Cancel in two taps · Billed via Stripe"}
            </p>
          </motion.div>
        </AnimatePresence>

        {/* Features cascade */}
        <div aria-live="polite">
          <AnimatePresence mode="wait">
            <motion.ul
              key={plan.tier}
              initial="hidden"
              animate="show"
              exit={{ opacity: 0, transition: { duration: 0.15 } }}
              variants={{ hidden: {}, show: { transition: { staggerChildren: 0.06 } } }}
              className="grid gap-2.5"
            >
              {plan.features.map((feature) => (
                <motion.li
                  key={feature}
                  variants={{
                    hidden: { opacity: 0, x: 22 },
                    show: { opacity: 1, x: 0, transition: { duration: 0.5, ease: EASE_LUXE } },
                  }}
                  className="glass flex items-center gap-3 rounded-2xl px-5 py-4"
                >
                  <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/20">
                    <Check className="size-3.5 text-primary-soft" aria-hidden="true" />
                  </span>
                  <span className="text-sm font-medium">{feature}</span>
                </motion.li>
              ))}
            </motion.ul>
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
