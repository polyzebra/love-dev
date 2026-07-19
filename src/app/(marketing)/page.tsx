import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import {
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
import { HeroScene } from "@/components/marketing/hero-scene";
import { MarketingHero } from "@/components/marketing/hero";
import { HeroCta } from "@/components/marketing/hero-cta";

// Homepage keeps the root default title/OG; it only pins its canonical URL.
export const metadata: Metadata = { alternates: { canonical: "/" } };

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
    body: "Long-term, short-term, figuring it out - every profile says so before the first hello. No guessing games.",
  },
  {
    number: "03",
    icon: MessageCircleHeart,
    title: "Conversations with a pulse",
    body: "A curated daily feed instead of an infinite slot machine. Fewer, better matches - and openers worth answering.",
  },
] as const;

export default function LandingPage() {
  return (
    <>
      {/* ============== HERO - the product, already happening ============== */}
      <MarketingHero
        align="split"
        eyebrow="Meet someone real"
        title={
          <>
            Love, with
            <br />
            <span className="text-luxe italic">intention.</span>
          </>
        }
        subtitle="Every profile verified. Every intention stated. Every conversation given room to breathe."
        actions={
          <>
            <HeroCta href="/login">
              Start meeting people
              <ArrowRight className="size-4" aria-hidden="true" />
            </HeroCta>
            <HeroCta href="/safety" variant="secondary">
              How we keep you safe
            </HeroCta>
          </>
        }
        visual={<HeroScene />}
      />

      {/* ====================== MANIFESTO INTERLUDE ====================== */}
      <section className="relative overflow-hidden py-32 md:py-44">
        <div className="mx-auto max-w-4xl px-6 text-center">
          <Reveal>
            <p className="font-display text-[clamp(1.8rem,4.5vw,3.4rem)] leading-[1.25] font-medium tracking-tight text-balance">
              Swiping was built to be <span className="text-muted-foreground italic">endless</span>.
              <br />
              We built Tirvea to be{" "}
              <span className="text-luxe italic">the last app you download</span>.
            </p>
          </Reveal>
        </div>
      </section>

      {/* ==================== EDITORIAL SPLIT · CRAFT ==================== */}
      <section className="relative overflow-hidden py-24 md:py-36">
        <Aurora intensity="faint" />
        <div className="mx-auto grid max-w-6xl items-center gap-14 px-6 md:grid-cols-2 md:px-10">
          <Reveal className="order-2 md:order-1">
            <TiltCard maxTilt={7} className="rounded-2xl">
              <div className="shadow-float light:border-border relative aspect-[4/5] overflow-hidden rounded-2xl border border-white/12">
                <Image
                  src="https://images.unsplash.com/photo-1516589178581-6cd7833ae3b2?w=640&q=75&auto=format&fit=crop"
                  alt="A couple laughing together over coffee"
                  fill
                  sizes="(max-width: 768px) 90vw, 480px"
                  className="object-cover"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent" />
                {/* Aspirational copy in the product's voice - never a
                    fabricated member quote. */}
                <p className="font-display absolute right-5 bottom-5 left-5 text-xl text-white/95 italic">
                  From first hello to first coffee.
                </p>
              </div>
            </TiltCard>
          </Reveal>

          <div className="order-1 space-y-6 md:order-2">
            <Reveal>
              <p className="text-gold text-xs font-semibold tracking-[0.35em] uppercase">
                The difference
              </p>
            </Reveal>
            <Reveal delay={0.08}>
              <h2 className="font-display text-4xl leading-[1.06] font-medium tracking-tight md:text-6xl">
                Designed like it&apos;s
                <br />
                <span className="italic">someone&apos;s story.</span>
              </h2>
            </Reveal>
            <Reveal delay={0.16}>
              <p className="text-muted-foreground max-w-md text-lg leading-relaxed">
                Because it is. Profiles read like people, not inventory. Distance, intentions and
                shared interests sit exactly where your eyes expect them - and nothing screams for
                your attention.
              </p>
            </Reveal>
            <Reveal delay={0.24}>
              <Link
                href="/login"
                className="group text-primary-soft inline-flex items-center gap-2 text-sm font-semibold"
              >
                Create your profile
                <ArrowRight
                  className="size-4 transition-transform group-hover:translate-x-1"
                  aria-hidden="true"
                />
              </Link>
            </Reveal>
          </div>
        </div>
      </section>

      {/* ======================= THREE PRINCIPLES ======================= */}
      <section className="relative py-24 md:py-36">
        <div className="mx-auto max-w-6xl px-6 md:px-10">
          <Reveal>
            <h2 className="font-display mb-20 max-w-2xl text-4xl leading-[1.06] font-medium tracking-tight md:text-6xl">
              Three promises,
              <br />
              <span className="text-muted-foreground italic">kept by design.</span>
            </h2>
          </Reveal>
          <RevealGroup className="grid gap-6 md:grid-cols-3">
            {PRINCIPLES.map(({ number, icon: Icon, title, body }, i) => (
              <RevealItem
                key={number}
                className={i === 1 ? "md:translate-y-14" : i === 2 ? "md:translate-y-28" : ""}
              >
                <article className="glass group relative overflow-hidden rounded-xl p-8 transition-transform duration-500 hover:-translate-y-1.5">
                  <span
                    aria-hidden="true"
                    className="font-display text-foreground/4 group-hover:text-primary/10 pointer-events-none absolute -top-8 -right-4 text-[7rem] leading-none font-semibold transition-colors duration-500"
                  >
                    {number}
                  </span>
                  <Icon className="text-primary-soft mb-6 size-7" aria-hidden="true" />
                  <h3 className="mb-3 text-xl font-semibold tracking-tight">{title}</h3>
                  <p className="text-muted-foreground text-sm leading-relaxed">{body}</p>
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
            <div className="border-glow noise bg-card/60 relative overflow-hidden rounded-[36px] px-8 py-16 md:px-16 md:py-24">
              <div
                aria-hidden="true"
                className="absolute -top-32 left-1/2 size-[36rem] -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,rgba(56,189,248,0.12),transparent_70%)] blur-2xl"
              />
              <div className="relative grid items-center gap-12 md:grid-cols-[auto_1fr]">
                <div className="relative mx-auto flex size-36 items-center justify-center md:size-44">
                  <span className="animate-ping-soft absolute inset-0 rounded-full bg-sky-400/20" />
                  <span className="glass-chip absolute inset-3 rounded-full" />
                  <BadgeCheck
                    className="relative size-16 fill-sky-400 text-white md:size-20"
                    aria-hidden="true"
                  />
                </div>
                <div className="space-y-5 text-center md:text-left">
                  <h2 className="font-display text-3xl leading-tight font-medium tracking-tight md:text-5xl">
                    The blue tick means
                    <br />
                    <span className="italic">they&apos;re real.</span>
                  </h2>
                  <p className="text-muted-foreground mx-auto max-w-lg md:mx-0">
                    A quick selfie check earns every member their verification badge. Reports are
                    reviewed by humans, blocking is instant and absolute, and your exact location is
                    never shown to anyone.
                  </p>
                  <Button variant="outline" className="h-12 rounded-full px-6" asChild>
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
              <h2 className="font-display text-4xl leading-[1.06] font-medium tracking-tight md:sticky md:top-32 md:text-6xl">
                Tonight,
                <br />
                <span className="text-muted-foreground italic">it starts.</span>
              </h2>
            </Reveal>
            <RevealGroup className="space-y-2" stagger={0.12}>
              {[
                [
                  "Five honest minutes",
                  "Photos that look like you, intentions you actually hold, and the small details that make someone stop scrolling.",
                ],
                [
                  "One quick selfie",
                  "Our verification check earns your blue tick - and filters out everyone who wouldn't take it.",
                ],
                [
                  "A feed worth opening",
                  "A short, curated set of profiles each day. When it's mutual, the conversation starts warm.",
                ],
              ].map(([title, body], i) => (
                <RevealItem key={title}>
                  <div className="group border-border flex gap-8 border-t py-10 last:border-b">
                    <span className="font-display text-primary-soft/70 text-2xl italic">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <div className="space-y-2">
                      <h3 className="group-hover:text-primary-soft text-2xl font-semibold tracking-tight transition-colors">
                        {title}
                      </h3>
                      <p className="text-muted-foreground max-w-md leading-relaxed">{body}</p>
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
            <ShieldCheck className="text-gold mx-auto mb-8 size-8" aria-hidden="true" />
          </Reveal>
          <Reveal delay={0.08}>
            <h2 className="font-display text-[clamp(2.6rem,7vw,5.5rem)] leading-[1.02] font-medium tracking-tight text-balance">
              Your person is
              <br />
              <span className="text-luxe italic">not on page 400.</span>
            </h2>
          </Reveal>
          <Reveal delay={0.18}>
            <p className="text-muted-foreground mx-auto mt-6 max-w-md text-lg">
              They&apos;re in a curated feed, verified, and looking for the same thing you are.
            </p>
          </Reveal>
          <Reveal delay={0.28}>
            <Magnetic className="mt-10 inline-block">
              <Button size="lg" className="h-16 rounded-full px-14 text-lg" asChild>
                <Link href="/login">Start meeting people</Link>
              </Button>
            </Magnetic>
          </Reveal>
        </div>
      </section>
    </>
  );
}
