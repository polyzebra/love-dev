import type { Metadata } from "next";
import { PageShell, layout } from "@/components/layout/public";
import Link from "next/link";
import { Download } from "lucide-react";
import { buildMarketingMetadata } from "@/lib/marketing/seo";
import { LEGAL_HUB } from "@/lib/legal/routes";

export const metadata: Metadata = buildMarketingMetadata({
  title: "Press",
  description:
    "Press and media resources for Tirvea: company boilerplate, brand assets, brand guidelines, a fact sheet, and press contact. Operated by WiseWave Limited.",
  path: "/press",
});

function Section({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section aria-labelledby={id} className={layout.section}>
      <h2 id={id} className="font-display text-2xl font-semibold tracking-tight">
        {title}
      </h2>
      <div className="text-muted-foreground mt-3 space-y-3 leading-relaxed">{children}</div>
    </section>
  );
}

const ASSETS = [
  { href: "/logo.svg", label: "Tirvea logo (SVG)", note: "Primary mark, vector" },
  { href: "/logo-web.svg", label: "Tirvea logo, web (SVG)", note: "Optimised for web" },
  { href: "/og.png", label: "Social preview image (PNG)", note: "1200 × 630" },
];

export default function PressPage() {
  return (
    <PageShell width="reading">
      <h1 className="font-display text-4xl font-semibold tracking-tight md:text-5xl">Press</h1>
      <p className="text-muted-foreground mt-5 text-lg leading-relaxed">
        Resources for journalists and media. For interviews or enquiries, please get in touch - we
        respond as soon as we can.
      </p>

      <Section id="boilerplate" title="Company boilerplate">
        <p>
          Tirvea is a premium dating platform built around intention, authenticity, and safety. It
          combines identity and photo verification, moderation with human review, and clear
          community rules to help adults meet genuinely. Tirvea is a brand and platform operated by
          WiseWave Limited, a company registered in Ireland.
        </p>
      </Section>

      <Section id="fact-sheet" title="Fact sheet">
        <dl className="border-border grid grid-cols-1 gap-x-8 gap-y-2 rounded-2xl border p-5 text-sm sm:grid-cols-2">
          <Fact label="Product" value="Tirvea - premium dating platform" />
          <Fact label="Operator" value="WiseWave Limited" />
          <Fact label="Company number" value="762171 (Ireland)" />
          <Fact
            label="Registered office"
            value="39 Cooley Park, Dundalk, Co. Louth, A91 AP2V, Ireland"
          />
          <Fact label="Based in" value="Ireland (EU)" />
          <Fact label="Category" value="Online dating / social" />
          <Fact
            label="Key features"
            value="Identity & photo verification, private messaging, safety tools"
          />
          <Fact label="Press contact" value="info@tirvea.com" />
        </dl>
      </Section>

      <Section id="brand-assets" title="Brand assets">
        <p>Download the logo and social image for editorial use.</p>
        <ul className="mt-2 grid gap-3 sm:grid-cols-2">
          {ASSETS.map((a) => (
            <li key={a.href}>
              <a
                href={a.href}
                download
                className="border-border hover:border-foreground/25 focus-visible:ring-ring/60 flex items-center gap-3 rounded-2xl border p-4 transition-colors focus-visible:ring-2 focus-visible:outline-none"
              >
                <Download className="text-primary-soft size-4 shrink-0" aria-hidden="true" />
                <span>
                  <span className="text-foreground block text-sm font-medium">{a.label}</span>
                  <span className="text-muted-foreground block text-xs">{a.note}</span>
                </span>
              </a>
            </li>
          ))}
        </ul>
      </Section>

      <Section id="brand-guidelines" title="Brand guidelines">
        <ul className="list-disc space-y-1.5 pl-5">
          <li>
            The product is <strong>Tirvea</strong>; the operating company is{" "}
            <strong>WiseWave Limited</strong>. Please don&apos;t write &quot;Tirvea Ltd&quot; or
            &quot;Tirvea Limited&quot;.
          </li>
          <li>
            Use the supplied logo files; please don&apos;t recolour, stretch, or alter the mark.
          </li>
          <li>Leave clear space around the logo and keep it legible at small sizes.</li>
          <li>
            &quot;Tirvea&quot; is a trademark of WiseWave Limited; please use it as an adjective
            with the product name, not as a verb.
          </li>
        </ul>
      </Section>

      <Section id="press-contact" title="Press contact & media enquiries">
        <p>
          For interviews, quotes, or other media enquiries, email{" "}
          <a className="text-foreground underline" href="mailto:info@tirvea.com">
            info@tirvea.com
          </a>{" "}
          with &quot;Press&quot; in the subject. Please include your outlet, deadline, and what you
          need.
        </p>
        <p>
          For company and legal information, see the{" "}
          <Link href="/about" className="text-foreground underline">
            About page
          </Link>{" "}
          and the{" "}
          <Link href={LEGAL_HUB} className="text-foreground underline">
            Legal Centre
          </Link>
          .
        </p>
      </Section>
    </PageShell>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 sm:block">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-foreground">{value}</dd>
    </div>
  );
}
