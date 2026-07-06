import type { Metadata } from "next";
import { Aurora } from "@/components/fx/aurora";
import { Reveal } from "@/components/fx/reveal";
import { PricingSpotlight } from "@/components/marketing/pricing-spotlight";

export const metadata: Metadata = {
  title: "Pricing",
  description: "Simple plans for every pace of dating. Start free, upgrade when it clicks.",
};

export default function PricingPage() {
  return (
    <section className="noise relative overflow-hidden pb-28 pt-36 md:pb-40 md:pt-44">
      <Aurora />
      <div className="mx-auto max-w-5xl px-6 md:px-10">
        <div className="mx-auto mb-16 max-w-2xl space-y-5 text-center">
          <Reveal>
            <p className="text-xs font-semibold uppercase tracking-[0.35em] text-gold">Membership</p>
          </Reveal>
          <Reveal delay={0.08}>
            <h1 className="font-display text-[clamp(2.6rem,6vw,5rem)] font-medium leading-[1.02] tracking-tight text-balance">
              Pay for momentum,
              <br />
              <span className="text-luxe italic">never for tricks.</span>
            </h1>
          </Reveal>
          <Reveal delay={0.16}>
            <p className="text-lg text-muted-foreground">
              Start free. Upgrade when you want more. Cancel in two taps — no dark patterns,
              no win-back mazes.
            </p>
          </Reveal>
        </div>

        <Reveal delay={0.1}>
          <PricingSpotlight />
        </Reveal>
      </div>
    </section>
  );
}
