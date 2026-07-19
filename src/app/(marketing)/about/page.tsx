import type { Metadata } from "next";
import Link from "next/link";
import { buildMarketingMetadata } from "@/lib/marketing/seo";

export const metadata: Metadata = buildMarketingMetadata({
  title: "About Tirvea",
  description:
    "Tirvea is a premium dating platform built around intention, authenticity, and safety, operated by WiseWave Limited in Ireland.",
  path: "/about",
});

// Organization structured data. Only verifiable facts - no fabricated socials,
// awards, funding, or team.
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

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={id} className="mt-10">
      <h2 id={id} className="font-display text-2xl font-semibold tracking-tight">
        {title}
      </h2>
      <div className="text-muted-foreground mt-3 space-y-3 leading-relaxed">{children}</div>
    </section>
  );
}

export default function AboutPage() {
  return (
    <main className="mx-auto max-w-3xl px-5 pt-36 pb-20 md:px-8 md:pt-44">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(orgJsonLd) }}
      />

      <h1 className="font-display text-4xl font-semibold tracking-tight md:text-5xl">
        About Tirvea
      </h1>
      <p className="text-muted-foreground mt-5 text-lg leading-relaxed">
        Tirvea is a dating platform built around intention and authenticity - real people, real
        photos, and the small details that help people connect.
      </p>

      <Section id="mission" title="Our mission">
        <p>
          To help adults meet genuinely - to make it easier to find a real connection, and safer to
          look for one. We focus on quality over volume: fewer, better interactions with people who
          are who they say they are.
        </p>
      </Section>

      <Section id="vision" title="Our vision">
        <p>
          A dating experience where trust is the default, not an afterthought - where verification,
          clear rules, and thoughtful design let people be themselves and connect with intention.
        </p>
      </Section>

      <Section id="meaningful-matching" title="Meaningful matching">
        <p>
          We design for meaningful matches rather than endless swiping. Profiles centre on the
          details that help people find common ground, and we encourage conversations that go
          somewhere. Our aim is depth and relevance, not just reach.
        </p>
      </Section>

      <Section id="safety" title="Safety philosophy">
        <p>
          Safety is a baseline, not a feature. We combine identity and photo verification,
          moderation with human review, and clear community rules, and we give you practical tools
          to report and block. We are honest about what we can and cannot do: Tirvea is not an
          emergency service, and for immediate danger you should always contact your local emergency
          services.
        </p>
        <p>
          <Link href="/safety" className="text-foreground underline">
            Visit the Safety Centre
          </Link>{" "}
          for practical guidance.
        </p>
      </Section>

      <Section id="verification" title="Verification">
        <p>
          Verification helps you know who is real. Identity verification checks a government ID to
          confirm a real person is behind an account, and photo verification uses a short live video
          selfie to confirm a person matches their photos. Verification data is handled carefully
          and described in our policies.
        </p>
        <p>
          <Link href="/legal/identity-verification" className="text-foreground underline">
            Identity Verification
          </Link>{" "}
          ·{" "}
          <Link href="/legal/photo-verification" className="text-foreground underline">
            Photo Verification
          </Link>{" "}
          ·{" "}
          <Link href="/legal/biometric-data" className="text-foreground underline">
            Biometric Information
          </Link>
        </p>
      </Section>

      <Section id="trust" title="Trust">
        <p>
          Trust is built through consistency: verified identities, private conversations, and clear,
          enforced rules. We act on reports, we explain our decisions, and we offer an appeals
          process when we get something wrong.
        </p>
      </Section>

      <Section id="values" title="Our values">
        <ul className="list-disc space-y-1.5 pl-5">
          <li>
            <strong>Authenticity</strong> - real people, real photos, real intentions.
          </li>
          <li>
            <strong>Safety first</strong> - we design for it and enforce it.
          </li>
          <li>
            <strong>Privacy by design</strong> - we collect what we need and no more, and you stay
            in control of your data.
          </li>
          <li>
            <strong>Honesty</strong> - we describe what the platform actually does, and flag what it
            does not.
          </li>
        </ul>
      </Section>

      <Section id="technology" title="Technology">
        <p>
          Tirvea runs on modern, EU-hosted infrastructure. Traffic is encrypted in transit, your
          precise location is never shown, and access to sensitive systems is tightly controlled.
          Our security practices are described in the{" "}
          <Link href="/legal/security" className="text-foreground underline">
            Security Policy
          </Link>
          .
        </p>
      </Section>

      <Section id="responsible-ai" title="Responsible AI">
        <p>
          We use automated tools to help keep the platform safe - for example, to help flag content
          for review. Automation can flag or temporarily hold content, but it does not make
          permanent decisions about your account on its own: a person makes those decisions, with an
          appeal available. How this works is described in our moderation and trust policies.
        </p>
        <p>
          <Link href="/legal/ai-moderation" className="text-foreground underline">
            AI Moderation Policy
          </Link>{" "}
          ·{" "}
          <Link href="/legal/trust-safety" className="text-foreground underline">
            Trust &amp; Safety Policy
          </Link>
        </p>
      </Section>

      <Section id="company" title="Company information">
        <p>
          Tirvea is a brand and platform operated by <strong>WiseWave Limited</strong>, a company
          registered in Ireland (company number 762171), with its registered office at 39 Cooley
          Park, Dundalk, Co. Louth, A91 AP2V, Ireland.
        </p>
        <p>
          Get in touch at{" "}
          <a className="text-foreground underline" href="mailto:info@tirvea.com">
            info@tirvea.com
          </a>
          . For all policies, see the{" "}
          <Link href="/legal" className="text-foreground underline">
            Legal Centre
          </Link>{" "}
          and our{" "}
          <Link href="/legal/privacy" className="text-foreground underline">
            Privacy Policy
          </Link>
          .
        </p>
      </Section>
    </main>
  );
}
