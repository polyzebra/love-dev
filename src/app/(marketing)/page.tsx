import Link from "next/link";
import Image from "next/image";
import {
  ArrowDown,
  ArrowRight,
  BadgeCheck,
  HeartHandshake,
  MessageCircleHeart,
  ShieldCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Aurora } from "@/components/fx/aurora";
import { Magnetic } from "@/components/fx/magnetic";
import { Reveal, RevealGroup, RevealItem } from "@/components/fx/reveal";
import { TiltCard } from "@/components/fx/tilt-card";
import { HeroCards } from "@/components/marketing/hero-cards";

const PRINCIPLES = [
  {
    number: "01",
    icon: BadgeCheck,
    title: "Verified humans only",
    body: "Photo verification is part of joining, not an optional extra. The face you match is the face you meet.",
  },
  {
    number: "02",
    icon: HeartHandshake,
    title: "Intentions, up front",
    body: "Long-term, short-term, figuring it out — every profile says so before the first hello. No guessing games.",
  },
  {
    number: "03",
    icon: MessageCircleHeart,
    title: "Conversations with a pulse",
    body: "A curated daily feed instead of an infinite slot machine. Fewer, better matches — and openers worth answering.",
  },
] as const;

export default function LandingPage() {
  return (
    <>
      {/* ============================== HERO ============================== */}
      <section className="noise relative flex min-h-dvh flex-col overflow-hidden">
        <Aurora intensity="hero" />

        <div className="mx-auto grid w-full max-w-6xl flex-1 items-center gap-16 px-6 pb-16 pt-32 md:grid-cols-[1.1fr_0.9fr] md:px-10 lg:gap-8">
          {/* CSS-only entrances above the fold — LCP paints before hydration */}
          <div className="space-y-8 text-center md:text-left">
            <p className="animate-rise text-xs font-semibold uppercase tracking-[0.35em] text-gold">
              Ireland &amp; the UK
            </p>
            <h1 className="animate-rise font-display text-[clamp(2.9rem,8vw,6.5rem)] font-medium leading-[0.98] tracking-tight text-balance [--rise-delay:80ms]">
              Love, with
              <br />
              <span className="text-luxe italic">intention.</span>
            </h1>
            <p className="animate-rise mx-auto max-w-md text-lg leading-relaxed text-muted-foreground [--rise-delay:160ms] md:mx-0">
              A dating experience that treats meeting someone like it matters. Every profile
              verified. Every intention stated. Every conversation given room to breathe.
            </p>
            <div className="animate-rise flex flex-col items-center gap-4 [--rise-delay:240ms] sm:flex-row md:items-start">
              <Magnetic>
                <Button size="lg" className="h-14 rounded-full px-10 text-base" asChild>
                  <Link href="/register">
                    Start meeting people
                    <ArrowRight className="size-4" aria-hidden="true" />
                  </Link>
                </Button>
              </Magnetic>
              <Button size="lg" variant="outline" className="h-14 rounded-full px-8 text-base" asChild>
                <Link href="/safety">How we keep you safe</Link>
              </Button>
            </div>
            <p className="animate-rise text-sm text-muted-foreground [--rise-delay:320ms]">
              Free to join · No ads · Cancel anytime
            </p>
          </div>

          <HeroCards />
        </div>

        <a
          href="#story"
          aria-label="Scroll to learn more"
          className="mx-auto mb-8 flex size-11 items-center justify-center rounded-full border border-white/12 text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowDown className="size-4 animate-bounce" aria-hidden="true" />
        </a>
      </section>

      {/* ====================== MANIFESTO INTERLUDE ====================== */}
      <section id="story" className="relative overflow-hidden py-32 md:py-44">
        <div className="mx-auto max-w-4xl px-6 text-center">
          <Reveal>
            <p className="font-display text-[clamp(1.8rem,4.5vw,3.4rem)] font-medium leading-[1.25] tracking-tight text-balance">
              Swiping was built to be <span className="italic text-muted-foreground">endless</span>.
              <br />
              We built Amora to be <span className="text-luxe italic">the last app you download</span>.
            </p>
          </Reveal>
        </div>
      </section>

      {/* ==================== EDITORIAL SPLIT · CRAFT ==================== */}
      <section className="relative overflow-hidden py-24 md:py-36">
        <Aurora intensity="faint" />
        <div className="mx-auto grid max-w-6xl items-center gap-14 px-6 md:grid-cols-2 md:px-10">
          <Reveal className="order-2 md:order-1">
            <TiltCard maxTilt={7} className="rounded-[32px]">
              <div className="relative aspect-[4/5] overflow-hidden rounded-[32px] border border-white/12 shadow-float">
                <Image
                  src="https://images.unsplash.com/photo-1516589178581-6cd7833ae3b2?w=640&q=75&auto=format&fit=crop"
                  alt="A couple laughing together over coffee"
                  fill
                  sizes="(max-width: 768px) 90vw, 480px"
                  className="object-cover"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent" />
                <figcaption className="absolute bottom-5 left-5 right-5 font-display text-xl italic text-white/95">
                  “We matched on a Tuesday. Coffee by Friday.”
                </figcaption>
              </div>
            </TiltCard>
          </Reveal>

          <div className="order-1 space-y-6 md:order-2">
            <Reveal>
              <p className="text-xs font-semibold uppercase tracking-[0.35em] text-gold">
                The difference
              </p>
            </Reveal>
            <Reveal delay={0.08}>
              <h2 className="font-display text-4xl font-medium leading-[1.06] tracking-tight md:text-6xl">
                Designed like it&apos;s
                <br />
                <span className="italic">someone&apos;s story.</span>
              </h2>
            </Reveal>
            <Reveal delay={0.16}>
              <p className="max-w-md text-lg leading-relaxed text-muted-foreground">
                Because it is. Profiles read like people, not inventory. Distance, intentions and
                shared interests sit exactly where your eyes expect them — and nothing screams for
                your attention.
              </p>
            </Reveal>
            <Reveal delay={0.24}>
              <Link
                href="/register"
                className="group inline-flex items-center gap-2 text-sm font-semibold text-primary-soft"
              >
                Create your profile
                <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" aria-hidden="true" />
              </Link>
            </Reveal>
          </div>
        </div>
      </section>

      {/* ======================= THREE PRINCIPLES ======================= */}
      <section className="relative py-24 md:py-36">
        <div className="mx-auto max-w-6xl px-6 md:px-10">
          <Reveal>
            <h2 className="mb-20 max-w-2xl font-display text-4xl font-medium leading-[1.06] tracking-tight md:text-6xl">
              Three promises,
              <br />
              <span className="italic text-muted-foreground">kept by design.</span>
            </h2>
          </Reveal>
          <RevealGroup className="grid gap-6 md:grid-cols-3">
            {PRINCIPLES.map(({ number, icon: Icon, title, body }, i) => (
              <RevealItem
                key={number}
                className={i === 1 ? "md:translate-y-14" : i === 2 ? "md:translate-y-28" : ""}
              >
                <article className="glass group relative overflow-hidden rounded-[28px] p-8 transition-transform duration-500 hover:-translate-y-1.5">
                  <span
                    aria-hidden="true"
                    className="pointer-events-none absolute -right-4 -top-8 font-display text-[7rem] font-semibold leading-none text-white/4 transition-colors duration-500 group-hover:text-primary/10"
                  >
                    {number}
                  </span>
                  <Icon className="mb-6 size-7 text-primary-soft" aria-hidden="true" />
                  <h3 className="mb-3 text-xl font-semibold tracking-tight">{title}</h3>
                  <p className="text-sm leading-relaxed text-muted-foreground">{body}</p>
                </article>
              </RevealItem>
            ))}
          </RevealGroup>
        </div>
      </section>

      {/* ===================== VERIFICATION SPOTLIGHT ===================== */}
      <section className="relative py-24 md:my-12 md:py-36">
        <div className="mx-auto max-w-6xl px-6 md:px-10">
          <Reveal>
            <div className="border-glow noise relative overflow-hidden rounded-[36px] bg-card/60 px-8 py-16 md:px-16 md:py-24">
              <div
                aria-hidden="true"
                className="absolute -top-32 left-1/2 size-[36rem] -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,rgba(56,189,248,0.12),transparent_70%)] blur-2xl"
              />
              <div className="relative grid items-center gap-12 md:grid-cols-[auto_1fr]">
                <div className="relative mx-auto flex size-36 items-center justify-center md:size-44">
                  <span className="absolute inset-0 animate-ping-soft rounded-full bg-sky-400/20" />
                  <span className="glass-chip absolute inset-3 rounded-full" />
                  <BadgeCheck className="relative size-16 fill-sky-400 text-white md:size-20" aria-hidden="true" />
                </div>
                <div className="space-y-5 text-center md:text-left">
                  <h2 className="font-display text-3xl font-medium leading-tight tracking-tight md:text-5xl">
                    The blue tick means
                    <br />
                    <span className="italic">they&apos;re real.</span>
                  </h2>
                  <p className="mx-auto max-w-lg text-muted-foreground md:mx-0">
                    A quick selfie check earns every member their verification badge. Reports are
                    reviewed by humans, blocking is instant and absolute, and your exact location
                    is never shown to anyone.
                  </p>
                  <Button variant="outline" className="rounded-full px-6" asChild>
                    <Link href="/safety">
                      Visit the Safety Centre
                      <ArrowRight className="size-4" aria-hidden="true" />
                    </Link>
                  </Button>
                </div>
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ========================= HOW IT BEGINS ========================= */}
      <section className="relative py-24 md:py-36">
        <div className="mx-auto max-w-6xl px-6 md:px-10">
          <div className="grid gap-16 md:grid-cols-[0.8fr_1.2fr]">
            <Reveal>
              <h2 className="font-display text-4xl font-medium leading-[1.06] tracking-tight md:sticky md:top-32 md:text-6xl">
                Tonight,
                <br />
                <span className="italic text-muted-foreground">it starts.</span>
              </h2>
            </Reveal>
            <RevealGroup className="space-y-2" stagger={0.12}>
              {[
                ["Five honest minutes", "Photos that look like you, intentions you actually hold, and the small details that make someone stop scrolling."],
                ["One quick selfie", "Our verification check earns your blue tick — and filters out everyone who wouldn't take it."],
                ["A feed worth opening", "A short, curated set of profiles each day. When it's mutual, the conversation starts warm."],
              ].map(([title, body], i) => (
                <RevealItem key={title}>
                  <div className="group flex gap-8 border-t border-white/8 py-10 last:border-b">
                    <span className="font-display text-2xl italic text-primary-soft/70">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <div className="space-y-2">
                      <h3 className="text-2xl font-semibold tracking-tight transition-colors group-hover:text-primary-soft">
                        {title}
                      </h3>
                      <p className="max-w-md leading-relaxed text-muted-foreground">{body}</p>
                    </div>
                  </div>
                </RevealItem>
              ))}
            </RevealGroup>
          </div>
        </div>
      </section>

      {/* =========================== FINAL CTA =========================== */}
      <section className="noise relative overflow-hidden py-36 md:py-52">
        <Aurora intensity="hero" />
        <div className="relative mx-auto max-w-4xl px-6 text-center">
          <Reveal>
            <ShieldCheck className="mx-auto mb-8 size-8 text-gold" aria-hidden="true" />
          </Reveal>
          <Reveal delay={0.08}>
            <h2 className="font-display text-[clamp(2.6rem,7vw,5.5rem)] font-medium leading-[1.02] tracking-tight text-balance">
              Your person is
              <br />
              <span className="text-luxe italic">not on page 400.</span>
            </h2>
          </Reveal>
          <Reveal delay={0.18}>
            <p className="mx-auto mt-6 max-w-md text-lg text-muted-foreground">
              They&apos;re in a curated feed, verified, and looking for the same thing you are.
            </p>
          </Reveal>
          <Reveal delay={0.28}>
            <Magnetic className="mt-10 inline-block">
              <Button size="lg" className="h-16 rounded-full px-14 text-lg" asChild>
                <Link href="/register">Join Amora — free</Link>
              </Button>
            </Magnetic>
          </Reveal>
        </div>
      </section>
    </>
  );
}
