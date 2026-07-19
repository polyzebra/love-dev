import type { Metadata } from "next";
import { PageShell, layout } from "@/components/layout/public";
import { cn } from "@/lib/utils";
import Link from "next/link";
import { Sparkles, ShieldCheck, Lock, Cpu, BadgeCheck, Scale } from "lucide-react";
import { Button } from "@/components/ui/button";
import { buildMarketingMetadata } from "@/lib/marketing/seo";

export const metadata: Metadata = buildMarketingMetadata({
  title: "About Tirvea",
  description:
    "Tirvea is an international dating platform where verified people meet with intention, with safety and privacy built in. Operated by WiseWave Limited, an Irish company.",
  path: "/about",
});

// Organization structured data - verifiable facts only. No fabricated socials,
// awards, funding, team, or user numbers.
const orgJsonLd = {
  "@context": "https://schema.org",
  "@type": "Organization",
  name: "WiseWave Limited",
  legalName: "WiseWave Limited",
  brand: { "@type": "Brand", name: "Tirvea" },
  url: "https://tirvea.com",
  logo: "https://tirvea.com/logo.svg",
  email: "info@tirvea.com",
  address: {
    "@type": "PostalAddress",
    streetAddress: "39 Cooley Park",
    addressLocality: "Dundalk",
    addressRegion: "Co. Louth",
    postalCode: "A91 AP2V",
    addressCountry: "IE",
  },
  identifier: { "@type": "PropertyValue", name: "Company number", value: "762171" },
};

/** A standard content section: large headline, short body. */
function Section({
  id,
  title,
  children,
  className,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section aria-labelledby={id} className={cn(layout.section, className)}>
      <h2
        id={id}
        className="font-display text-2xl font-semibold tracking-tight md:text-3xl"
      >
        {title}
      </h2>
      <div className="text-muted-foreground mt-4 space-y-4 text-lg leading-relaxed">{children}</div>
    </section>
  );
}

const DIFFERENTIATORS = [
  {
    icon: Sparkles,
    title: "Meaningful matching",
    body: "We design for meaningful matches, not endless swiping - profiles centre on the details that help people find common ground.",
  },
  {
    icon: ShieldCheck,
    title: "Safety by design",
    body: "Verification, human review, clear standards, and simple tools to report or block are there from the moment you join.",
  },
  {
    icon: Lock,
    title: "Privacy by design",
    body: "We collect only what we need. Your precise location is never shown, and you can export or delete your data at any time.",
  },
  {
    icon: Cpu,
    title: "Responsible AI",
    body: "Automation helps flag content for review, but people - not algorithms - make the decisions that affect your account.",
  },
];

export default function AboutPage() {
  return (
    <PageShell width="reading">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(orgJsonLd) }}
      />

      {/* Hero */}
      <p className="text-primary-soft text-sm font-semibold tracking-[0.14em] uppercase">
        About Tirvea
      </p>
      <h1 className="font-display mt-4 text-4xl font-semibold tracking-tight text-balance md:text-6xl">
        Built for real connection.
      </h1>
      <p className="text-muted-foreground mt-6 max-w-2xl text-xl leading-relaxed">
        Tirvea is an international dating platform where verified people meet with intention. Fewer,
        better conversations - with safety and privacy built in from the start.
      </p>
      <div className="mt-8 flex flex-wrap gap-3">
        <Button size="lg" className="h-12 rounded-full px-6" asChild>
          <Link href="/login">Create your account</Link>
        </Button>
        <Button size="lg" variant="outline" className="h-12 rounded-full px-6" asChild>
          <Link href="/safety">Explore the Safety Centre</Link>
        </Button>
      </div>

      <Section id="who-we-are" title="Who we are">
        <p>
          Tirvea is operated by <strong>WiseWave Limited</strong>, an Irish technology company
          focused on building trusted digital experiences. We build carefully, with a single aim: a
          place where adults can meet genuinely, and feel safe doing it.
        </p>
      </Section>

      <Section id="why" title="Why Tirvea exists">
        <p>
          Online dating has drifted toward volume - endless swiping, unverified profiles,
          conversations that go nowhere. It should be the opposite. Tirvea exists to make meeting
          someone feel intentional, honest, and safe.
        </p>
      </Section>

      <Section id="mission-vision" title="Our mission and vision">
        <p>
          <strong>Our mission</strong> is to help adults meet genuinely - to make it easier to find
          a real connection, and safer to look for one.
        </p>
        <p>
          <strong>Our vision</strong> is a dating experience where trust is the default, not an
          afterthought.
        </p>
      </Section>

      {/* What makes Tirvea different - callouts */}
      <section aria-labelledby="different" className={layout.section}>
        <h2 id="different" className="font-display text-2xl font-semibold tracking-tight md:text-3xl">
          What makes Tirvea different
        </h2>
        <p className="text-muted-foreground mt-4 max-w-2xl text-lg leading-relaxed">
          Four ideas shape everything we build.
        </p>
        <ul className="mt-8 grid gap-4 sm:grid-cols-2">
          {DIFFERENTIATORS.map(({ icon: Icon, title, body }) => (
            <li key={title} className="border-border/70 rounded-3xl border p-6">
              <Icon className="text-primary-soft size-5" aria-hidden="true" />
              <h3 className="text-foreground mt-3 text-base font-semibold">{title}</h3>
              <p className="text-muted-foreground mt-2 text-sm leading-relaxed">{body}</p>
            </li>
          ))}
        </ul>
      </section>

      <Section id="verification" title="Verification you can rely on">
        <p>
          Knowing who is real changes everything. Tirvea offers{" "}
          <strong>identity verification</strong>, which checks a government ID through a trusted
          provider, and <strong>photo verification</strong>, which uses a short live video selfie to
          confirm a person matches their photos.
        </p>
        <p className="text-base">
          <Link href="/legal/identity-verification" className="text-foreground underline">
            Identity Verification
          </Link>{" "}
          ·{" "}
          <Link href="/legal/photo-verification" className="text-foreground underline">
            Photo Verification
          </Link>
        </p>
      </Section>

      <Section id="safety" title="Safety by design">
        <p>
          Safety is not a setting you switch on - it is part of how Tirvea is built. Verification,
          human review, clear community standards, and simple tools to report or block are there
          from the moment you join. Tirvea is not an emergency service; if you are in immediate
          danger, always contact your local emergency services.
        </p>
        <p className="text-base">
          <Link href="/safety" className="text-foreground underline">
            Visit the Safety Centre
          </Link>
        </p>
      </Section>

      <Section id="privacy" title="Privacy by design">
        <p>
          We collect what we need, and no more. Your precise location is never shown, your
          conversations are private, and you can export or delete your data whenever you choose.
        </p>
        <p className="text-base">
          <Link href="/legal/privacy" className="text-foreground underline">
            Privacy Policy
          </Link>{" "}
          ·{" "}
          <Link href="/legal/gdpr" className="text-foreground underline">
            Your data rights
          </Link>
        </p>
      </Section>

      <Section id="responsible-ai" title="Responsible AI">
        <p>
          We use automated tools to help keep Tirvea safe - for example, to help flag content for
          review. Automation can flag or temporarily hold content, but it never makes a permanent
          decision about your account on its own. A person makes those decisions, and you can
          appeal.
        </p>
        <p className="text-base">
          <Link href="/legal/ai-moderation" className="text-foreground underline">
            AI Moderation Policy
          </Link>{" "}
          ·{" "}
          <Link href="/legal/trust-safety" className="text-foreground underline">
            Trust &amp; Safety
          </Link>
        </p>
      </Section>

      <Section id="trust" title="Trust, earned through consistency">
        <p>
          We act on reports, we explain our decisions, and when we get something wrong, we offer a
          clear way to appeal. Our community standards apply to everyone, and we hold ourselves to
          them too.
        </p>
        <p className="text-base">
          <Link href="/legal/community-guidelines" className="text-foreground underline">
            Community Guidelines
          </Link>{" "}
          ·{" "}
          <Link href="/legal/appeals" className="text-foreground underline">
            Appeals
          </Link>
        </p>
      </Section>

      <Section id="technology" title="How Tirvea is built">
        <p>
          Tirvea is built to be modern, secure, and dependable. It runs on EU-based infrastructure,
          works in any modern browser, and installs as a progressive web app - with native iOS and
          Android apps planned. Your data is encrypted in transit, and access to sensitive systems
          is tightly controlled.
        </p>
        <p className="text-base">
          <Link href="/legal/security" className="text-foreground underline">
            Security Policy
          </Link>
        </p>
      </Section>

      {/* Principles */}
      <section aria-labelledby="principles" className={layout.section}>
        <h2 id="principles" className="font-display text-2xl font-semibold tracking-tight md:text-3xl">
          Our principles
        </h2>
        <ul className="mt-6 space-y-4">
          {[
            ["Authenticity", "Real people, real photos, real intentions."],
            ["Safety first", "We design for it, and we enforce it."],
            ["Privacy by design", "We collect only what we need; you stay in control of your data."],
            ["Human judgment", "People, not algorithms, make the decisions that matter."],
            ["Honesty", "We describe what the platform actually does, and flag what it does not."],
          ].map(([title, body]) => (
            <li key={title} className="flex gap-3">
              <BadgeCheck className="text-primary-soft mt-0.5 size-5 shrink-0" aria-hidden="true" />
              <p className="text-muted-foreground text-lg leading-relaxed">
                <strong className="text-foreground font-semibold">{title}.</strong> {body}
              </p>
            </li>
          ))}
        </ul>
      </section>

      <Section id="future" title="Growing with intention">
        <p>
          Tirvea is available today on the web and as a progressive web app, with native iOS and
          Android apps planned. We are building for people wherever they are; availability, features,
          and verification services may vary by country or region as we grow.
        </p>
      </Section>

      {/* Company information */}
      <section
        aria-labelledby="company"
        className={cn(layout.section, "border-border/60 border-t pt-10")}
      >
        <h2 id="company" className="text-muted-foreground text-xs font-semibold tracking-[0.14em] uppercase">
          Company information
        </h2>
        <div className="text-muted-foreground mt-4 space-y-2 text-sm leading-relaxed">
          <p className="text-foreground font-medium">WiseWave Limited</p>
          <p>Company number 762171 · Companies Registration Office (Ireland)</p>
          <p>Registered office: 39 Cooley Park, Dundalk, Co. Louth, A91 AP2V, Ireland</p>
          <p>
            <Scale className="mr-1.5 inline size-3.5 align-[-2px]" aria-hidden="true" />
            Governing law: Ireland - see the{" "}
            <Link href="/legal/terms" className="text-foreground underline">
              Terms of Service
            </Link>
            .
          </p>
          <p>
            Contact:{" "}
            <a href="mailto:info@tirvea.com" className="text-foreground underline">
              info@tirvea.com
            </a>{" "}
            · All policies in the{" "}
            <Link href="/legal" className="text-foreground underline">
              Legal Centre
            </Link>
          </p>
          <p className="text-foreground/70 pt-1">
            Headquartered in Ireland, serving members internationally. Availability may vary by
            country or region.
          </p>
        </div>
      </section>

      {/* Final CTA */}
      <section aria-labelledby="cta" className={cn(layout.section, "text-center")}>
        <h2 id="cta" className="font-display text-3xl font-semibold tracking-tight md:text-4xl">
          Ready when you are.
        </h2>
        <p className="text-muted-foreground mx-auto mt-4 max-w-xl text-lg leading-relaxed">
          Join Tirvea and meet people who are here for the same reason you are.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Button size="lg" className="h-12 rounded-full px-7" asChild>
            <Link href="/login">Create your account</Link>
          </Button>
          <Button size="lg" variant="outline" className="h-12 rounded-full px-7" asChild>
            <Link href="/contact">Contact us</Link>
          </Button>
        </div>
      </section>
    </PageShell>
  );
}
