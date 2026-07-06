import Link from "next/link";
import {
  BadgeCheck,
  HeartHandshake,
  MapPin,
  MessageCircleHeart,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { VerifiedBadge } from "@/components/shared/verified-badge";

const FEATURES = [
  {
    icon: BadgeCheck,
    title: "Everyone is verified",
    body: "Photo verification is built into onboarding, so the person you match is the person you meet.",
  },
  {
    icon: HeartHandshake,
    title: "Intentions up front",
    body: "Every profile states what they're looking for — long-term, short-term or figuring it out.",
  },
  {
    icon: MessageCircleHeart,
    title: "Conversations that go somewhere",
    body: "Thoughtful prompts, voice notes and reactions designed for chemistry, not small talk.",
  },
  {
    icon: MapPin,
    title: "Local by design",
    body: "Built for Ireland & the UK — from Galway to Glasgow, Cork to Camden.",
  },
  {
    icon: ShieldCheck,
    title: "Safety without compromise",
    body: "In-chat safety tools, fast human review and GDPR-grade privacy controls.",
  },
  {
    icon: Sparkles,
    title: "Quality over quantity",
    body: "A curated daily feed tuned to compatibility — not an infinite slot machine.",
  },
] as const;

const STEPS = [
  { step: "01", title: "Create your profile", body: "Five minutes, done properly. Photos, intentions and what makes you, you." },
  { step: "02", title: "Get verified", body: "A quick selfie check earns your blue tick and unlocks the full experience." },
  { step: "03", title: "Meet with confidence", body: "Match, chat, and take it offline when it feels right. We'll be discreetly in the background." },
] as const;

export default function LandingPage() {
  return (
    <>
      {/* Hero */}
      <section className="relative overflow-hidden">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(60rem_30rem_at_70%_-10%,--theme(--color-primary/8%),transparent)]"
        />
        <div className="mx-auto grid max-w-6xl items-center gap-14 px-5 pb-20 pt-16 md:grid-cols-2 md:px-8 md:pb-28 md:pt-24">
          <div className="space-y-7">
            <Badge variant="secondary" className="rounded-full px-4 py-1.5 text-xs font-medium">
              Now in Ireland & the UK
            </Badge>
            <h1 className="font-display text-4xl font-semibold leading-[1.1] tracking-tight text-balance md:text-6xl">
              Dating, designed with <span className="text-primary">intention</span>.
            </h1>
            <p className="max-w-md text-lg leading-relaxed text-muted-foreground">
              Amora is a premium dating experience where every profile is verified,
              every intention is clear, and every conversation has a chance to matter.
            </p>
            <div className="flex flex-col gap-3 sm:flex-row">
              <Button size="lg" className="h-13 rounded-full px-8 text-base" asChild>
                <Link href="/register">Start meeting people</Link>
              </Button>
              <Button size="lg" variant="outline" className="h-13 rounded-full px-8 text-base" asChild>
                <Link href="/safety">How we keep you safe</Link>
              </Button>
            </div>
            <p className="text-sm text-muted-foreground">
              Free to join · No ads · Cancel anytime
            </p>
          </div>

          {/* Profile card mock — pure CSS, zero CLS */}
          <div className="relative mx-auto w-full max-w-sm" aria-hidden="true">
            <div className="absolute -left-6 top-8 h-full w-full -rotate-6 rounded-3xl bg-accent" />
            <div className="absolute -right-4 top-4 h-full w-full rotate-3 rounded-3xl bg-muted" />
            <div className="relative overflow-hidden rounded-3xl bg-card shadow-float">
              <div className="flex aspect-4/5 items-end bg-[linear-gradient(160deg,#fda4af_0%,#e11d48_55%,#881337_100%)] p-6">
                <div className="space-y-2 text-white">
                  <div className="flex items-center gap-2">
                    <h2 className="text-2xl font-semibold">Saoirse, 29</h2>
                    <VerifiedBadge className="text-white" />
                  </div>
                  <p className="text-sm/relaxed opacity-90">
                    Sea swims at Forty Foot · Gallery wanderer · Looking for something real
                  </p>
                  <div className="flex gap-2 pt-1">
                    {["Long-term", "Dublin", "2 km away"].map((tag) => (
                      <span
                        key={tag}
                        className="rounded-full bg-white/20 px-3 py-1 text-xs font-medium backdrop-blur-sm"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Social proof */}
      <section className="border-y bg-card">
        <div className="mx-auto grid max-w-6xl grid-cols-3 gap-4 px-5 py-10 text-center md:px-8">
          {[
            ["120k+", "verified members"],
            ["68%", "match within a week"],
            ["4.8★", "average app rating"],
          ].map(([stat, label]) => (
            <div key={label} className="space-y-1">
              <p className="font-display text-2xl font-semibold text-primary md:text-4xl">{stat}</p>
              <p className="text-xs text-muted-foreground md:text-sm">{label}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Features */}
      <section className="mx-auto max-w-6xl px-5 py-20 md:px-8 md:py-28">
        <div className="mx-auto mb-14 max-w-2xl space-y-4 text-center">
          <h2 className="font-display text-3xl font-semibold tracking-tight md:text-5xl">
            Built differently, on purpose
          </h2>
          <p className="text-lg text-muted-foreground">
            We took everything exhausting about dating apps and designed it out.
          </p>
        </div>
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map(({ icon: Icon, title, body }) => (
            <article
              key={title}
              className="group rounded-3xl border bg-card p-7 shadow-card transition-shadow hover:shadow-float"
            >
              <div className="mb-5 flex size-12 items-center justify-center rounded-2xl bg-accent transition-transform duration-300 group-hover:scale-105">
                <Icon className="size-6 text-accent-foreground" aria-hidden="true" />
              </div>
              <h3 className="mb-2 text-lg font-semibold">{title}</h3>
              <p className="text-sm leading-relaxed text-muted-foreground">{body}</p>
            </article>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section className="border-y bg-card">
        <div className="mx-auto max-w-6xl px-5 py-20 md:px-8 md:py-28">
          <h2 className="mb-14 text-center font-display text-3xl font-semibold tracking-tight md:text-5xl">
            Three steps to something real
          </h2>
          <ol className="grid gap-10 md:grid-cols-3">
            {STEPS.map(({ step, title, body }) => (
              <li key={step} className="space-y-3">
                <span className="font-display text-5xl font-semibold text-primary/20">{step}</span>
                <h3 className="text-xl font-semibold">{title}</h3>
                <p className="leading-relaxed text-muted-foreground">{body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* Final CTA */}
      <section className="mx-auto max-w-6xl px-5 py-20 md:px-8 md:py-28">
        <div className="relative overflow-hidden rounded-3xl bg-[linear-gradient(135deg,#e11d48,#be123c)] px-8 py-16 text-center text-white md:py-24">
          <h2 className="mx-auto max-w-2xl font-display text-3xl font-semibold tracking-tight text-balance md:text-5xl">
            Your person might be one profile away
          </h2>
          <p className="mx-auto mt-4 max-w-md text-lg text-white/85">
            Join thousands across Ireland & the UK who date with intention.
          </p>
          <Button
            size="lg"
            variant="secondary"
            className="mt-8 h-13 rounded-full bg-white px-10 text-base text-primary hover:bg-white/90"
            asChild
          >
            <Link href="/register">Create your free profile</Link>
          </Button>
        </div>
      </section>
    </>
  );
}
