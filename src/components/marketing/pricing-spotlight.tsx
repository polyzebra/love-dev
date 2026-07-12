"use client";

import { useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import { EASE_LUXE } from "@/lib/motion";
import { Check, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Magnetic } from "@/components/fx/magnetic";
import { CheckoutButton } from "@/components/billing/checkout-button";
import { PLANS } from "@/lib/constants";
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
 * One glass stage, three plans. The selector drives an animated
 * spotlight; price and features crossfade and cascade per plan.
 */
export function PricingSpotlight() {
  const [tier, setTier] = useState<(typeof PLANS)[number]["tier"]>("PLUS");
  const plan = PLANS.find((p) => p.tier === tier)!;

  return (
    <div className="border-glow noise relative overflow-hidden rounded-[36px] bg-card/60 p-6 md:p-12">
      {/* Spotlight follows the selected plan */}
      <div
        aria-hidden="true"
        className={cn(
          "pointer-events-none absolute -top-40 size-[30rem] rounded-full bg-[radial-gradient(closest-side,rgba(225,29,72,0.18),transparent_70%)] blur-2xl transition-all duration-700",
          tier === "FREE" ? "left-[-10%]" : tier === "PLUS" ? "left-1/2 -translate-x-1/2" : "right-[-10%]",
        )}
      />

      {/* Plan selector */}
      <div
        role="tablist"
        aria-label="Choose a plan"
        className="glass-chip relative mx-auto mb-10 flex w-fit max-w-full rounded-full p-1"
      >
        {PLANS.map((p) => {
          const active = p.tier === tier;
          return (
            <button
              key={p.tier}
              role="tab"
              aria-selected={active}
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
                  className="absolute inset-0 rounded-full bg-linear-160 from-[#fb4a6e] via-[#e11d48] to-[#a3123a] shadow-[0_6px_20px_rgba(225,29,72,0.4)]"
                />
              )}
              <span className="relative">{p.name}</span>
            </button>
          );
        })}
      </div>

      {/* Stage */}
      <div className="relative grid items-start gap-10 md:grid-cols-[1fr_1.2fr] md:gap-16">
        <AnimatePresence mode="wait">
          <motion.div
            key={tier}
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -14 }}
            transition={{ duration: 0.45, ease: EASE_LUXE }}
            className="space-y-6 text-center md:text-left"
          >
            <div className="space-y-2">
              {tier === "PLUS" && (
                <span className="glass-chip inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-widest text-gold">
                  <Sparkles className="size-3" aria-hidden="true" /> Most loved
                </span>
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
            {plan.tier === "FREE" ? (
              <Magnetic className="inline-block">
                <Button size="lg" className="h-14 rounded-full px-10 text-base" asChild>
                  <Link href="/login">Join free</Link>
                </Button>
              </Magnetic>
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
              Prices include VAT · Cancel in two taps · Billed via Stripe
            </p>
          </motion.div>
        </AnimatePresence>

        {/* Features cascade */}
        <div aria-live="polite">
          <AnimatePresence mode="wait">
            <motion.ul
              key={tier}
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
