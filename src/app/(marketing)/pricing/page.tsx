import type { Metadata } from "next";
import { cn } from "@/lib/utils";
import { layout } from "@/components/layout/public";
import { Suspense } from "react";
import { auth } from "@/lib/auth";
import { buildMarketingMetadata } from "@/lib/marketing/seo";
import { db } from "@/lib/db";
import { effectiveTier } from "@/lib/services/entitlements";
import { hasLiveSubscription } from "@/lib/services/billing";
import type { PlanTierName } from "@/lib/constants";
import { Reveal } from "@/components/fx/reveal";
import { MarketingHero } from "@/components/marketing/hero";
import { CheckoutCancelledNotice } from "@/components/marketing/checkout-cancelled-notice";
import { PricingSpotlight } from "@/components/marketing/pricing-spotlight";

export const metadata: Metadata = buildMarketingMetadata({
  title: "Pricing",
  description: "Simple plans for every pace of dating. Start free, upgrade when it clicks.",
  path: "/pricing",
});

/**
 * Public pricing page, plan-aware for signed-in members: the spotlight
 * receives the viewer's EFFECTIVE tier (same policy as every entitlement
 * gate) so it shows the current plan and the tiers above it - a Plus
 * member sees "Your current plan" + "Upgrade to Tirvea Gold", a Gold
 * member only their membership, and nobody is ever sold the plan they
 * already hold. Anonymous visitors see the full catalogue. Reading the
 * session makes this render dynamic - correct for billing state.
 */
export default async function PricingPage() {
  const session = await auth();
  let currentTier: PlanTierName | null = null;
  let hasLiveSub = false;
  if (session) {
    const subscription = await db.subscription.findUnique({
      where: { userId: session.user.id },
    });
    currentTier = effectiveTier(subscription);
    hasLiveSub = hasLiveSubscription(subscription);
  }

  return (
    <>
      <MarketingHero
        eyebrow="Membership"
        title={
          <>
            Pay for momentum,
            <br />
            <span className="text-luxe italic">never for tricks.</span>
          </>
        }
        subtitle="Start free. Upgrade when you want more. Cancel in two taps - no dark patterns, no win-back mazes."
      />
      <section className="relative pb-28 md:pb-40">
        <div className={cn("mx-auto pt-10 md:pt-14", layout.wide, layout.paddingX)}>
          {/* Stripe cancel_url returns here with ?checkout=cancelled. */}
          <Suspense fallback={null}>
            <CheckoutCancelledNotice />
          </Suspense>
          <Reveal delay={0.1}>
            <PricingSpotlight currentTier={currentTier} hasLiveSub={hasLiveSub} />
          </Reveal>
        </div>
      </section>
    </>
  );
}
