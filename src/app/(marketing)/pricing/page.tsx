import type { Metadata } from "next";
import Link from "next/link";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PLANS } from "@/lib/constants";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Pricing",
  description: "Simple plans for every pace of dating. Start free, upgrade when it clicks.",
};

function price(cents: number): string {
  if (cents === 0) return "€0";
  return `€${(cents / 100).toFixed(2).replace(/\.00$/, "")}`;
}

export default function PricingPage() {
  return (
    <section className="mx-auto max-w-6xl px-5 py-16 md:px-8 md:py-24">
      <div className="mx-auto mb-14 max-w-2xl space-y-4 text-center">
        <h1 className="font-display text-4xl font-semibold tracking-tight md:text-5xl">
          Simple, honest pricing
        </h1>
        <p className="text-lg text-muted-foreground">
          Start free. Upgrade when you want momentum. Cancel in two taps — no dark patterns.
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        {PLANS.map((plan) => {
          const highlighted = plan.tier === "PLUS";
          return (
            <article
              key={plan.tier}
              className={cn(
                "relative flex flex-col rounded-3xl border bg-card p-8 shadow-card",
                highlighted && "border-primary shadow-float md:-translate-y-2",
              )}
            >
              {highlighted && (
                <Badge className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full px-4">
                  Most popular
                </Badge>
              )}
              <h2 className="text-lg font-semibold">{plan.name}</h2>
              <p className="mt-1 text-sm text-muted-foreground">{plan.tagline}</p>
              <p className="mt-6 flex items-baseline gap-1">
                <span className="font-display text-5xl font-semibold tracking-tight">
                  {price(plan.priceMonthlyCents)}
                </span>
                <span className="text-sm text-muted-foreground">/ month</span>
              </p>
              <ul className="mt-8 flex-1 space-y-3">
                {plan.features.map((feature) => (
                  <li key={feature} className="flex items-start gap-3 text-sm">
                    <Check className="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" />
                    {feature}
                  </li>
                ))}
              </ul>
              <Button
                size="lg"
                variant={highlighted ? "default" : "outline"}
                className="mt-8 h-12 w-full rounded-full"
                asChild
              >
                <Link href="/register">
                  {plan.tier === "FREE" ? "Join free" : `Get ${plan.name}`}
                </Link>
              </Button>
            </article>
          );
        })}
      </div>

      <p className="mt-10 text-center text-sm text-muted-foreground">
        Prices include VAT. Billed monthly via Stripe — Apple Pay, Google Pay and cards accepted.
      </p>
    </section>
  );
}
