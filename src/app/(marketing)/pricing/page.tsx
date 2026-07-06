import type { Metadata } from "next";
import { Reveal } from "@/components/fx/reveal";
import { MarketingHero } from "@/components/marketing/hero";
import { PricingSpotlight } from "@/components/marketing/pricing-spotlight";

export const metadata: Metadata = {
  title: "Pricing",
  description: "Simple plans for every pace of dating. Start free, upgrade when it clicks.",
};

export default function PricingPage() {
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
        <div className="mx-auto max-w-5xl px-6 pt-10 md:px-10 md:pt-14">
          <Reveal delay={0.1}>
            <PricingSpotlight />
          </Reveal>
        </div>
      </section>
    </>
  );
}
