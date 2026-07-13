import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, Ban, Eye, FileDown, Flag, Lock, UserCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MarketingHero } from "@/components/marketing/hero";

export const metadata: Metadata = {
  title: "Safety Centre",
  description:
    "How Tirvea keeps dating safe: verification, moderation, privacy controls and GDPR rights.",
};

const PILLARS = [
  {
    icon: UserCheck,
    title: "Verification first",
    body: "Photo verification is part of onboarding. Optional ID verification adds an extra layer for those who want it. We never store identity documents - only the outcome.",
  },
  {
    icon: Flag,
    title: "Report anything, fast",
    body: "Report a profile or a single message in two taps. A human reviews every report, and serious reports are prioritised around the clock.",
  },
  {
    icon: Ban,
    title: "Blocking that actually blocks",
    body: "Blocking removes you both from each other's world instantly - feed, matches and message history.",
  },
  {
    icon: Eye,
    title: "You control your visibility",
    body: "Pause your profile any time. Hide your distance. Choose exactly who can see you.",
  },
  {
    icon: Lock,
    title: "Privacy by design",
    body: "Your precise location is never shown. Data is encrypted in transit and at rest. We are fully GDPR compliant.",
  },
  {
    icon: FileDown,
    title: "Your data, your rights",
    body: "Export everything we hold about you or delete your account permanently - both are self-service in Settings.",
  },
] as const;

const TIPS = [
  "Meet in public for the first few dates.",
  "Tell a friend where you're going and who you're meeting.",
  "Keep conversations on Tirvea until you trust the person.",
  "Never send money or share financial details - ever.",
  "Video chat before meeting if it helps you feel safe.",
  "Trust your instincts. If something feels off, it probably is.",
] as const;

export default function SafetyPage() {
  return (
    <>
      <MarketingHero
        eyebrow="Trust & safety"
        title={
          <>
            Safe is the baseline,
            <br />
            <span className="text-luxe italic">not a feature.</span>
          </>
        }
        subtitle="How Tirvea protects you before, during and after every match."
      />

      <section className="mx-auto max-w-6xl px-5 pt-10 pb-16 md:px-8 md:pt-14 md:pb-24">
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {PILLARS.map(({ icon: Icon, title, body }) => (
            <article key={title} className="bg-card shadow-card rounded-3xl border p-7">
              <Icon className="text-primary-soft mb-4 size-6" aria-hidden="true" />
              <h2 className="mb-2 text-lg font-semibold">{title}</h2>
              <p className="text-muted-foreground text-sm leading-relaxed">{body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="bg-card border-y">
        <div className="mx-auto max-w-3xl px-5 py-16 md:px-8">
          <div className="mb-8 flex items-center gap-3">
            <AlertTriangle className="text-warning size-6" aria-hidden="true" />
            <h2 className="font-display text-2xl font-semibold tracking-tight md:text-3xl">
              Dating safety tips
            </h2>
          </div>
          <ul className="space-y-4">
            {TIPS.map((tip) => (
              <li
                key={tip}
                className="bg-background flex items-start gap-3 rounded-2xl p-4 text-sm leading-relaxed"
              >
                <span
                  className="bg-primary mt-1.5 size-1.5 shrink-0 rounded-full"
                  aria-hidden="true"
                />
                {tip}
              </li>
            ))}
          </ul>
          <div className="bg-accent mt-10 rounded-3xl p-6">
            <h3 className="text-accent-foreground font-semibold">In immediate danger?</h3>
            <p className="text-accent-foreground/80 mt-1 text-sm">
              Call 112 or your local emergency number. For non-urgent support, our safety team is at{" "}
              <a
                href="mailto:safety@tirvea.app"
                className="font-medium underline underline-offset-2"
              >
                safety@tirvea.app
              </a>
              .
            </p>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-5 py-16 text-center md:px-8">
        <h2 className="font-display text-2xl font-semibold tracking-tight md:text-3xl">
          Read our Community Guidelines
        </h2>
        <p className="text-muted-foreground mx-auto mt-3 max-w-md">
          Clear rules, consistently enforced. Know what we expect from every member.
        </p>
        <Button size="lg" className="mt-6 h-12 rounded-full px-8" asChild>
          <Link href="/legal/community-guidelines">Community Guidelines</Link>
        </Button>
      </section>
    </>
  );
}
