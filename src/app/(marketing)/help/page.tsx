import type { Metadata } from "next";
import Link from "next/link";
import { HELP_CATEGORIES } from "@/lib/help/content";
import { buildMarketingMetadata } from "@/lib/marketing/seo";

export const metadata: Metadata = buildMarketingMetadata({
  title: "Help Centre",
  description:
    "Find help with your Tirvea account, verification, billing, privacy, safety, reporting, and appeals.",
  path: "/help",
});

// P1.3 - public Help Centre landing. Category-driven; reachable by logged-out
// visitors (unauthenticated (marketing) group). Search-ready structure with
// deep-linkable categories and articles.
export default function HelpPage() {
  return (
    <main className="mx-auto max-w-5xl px-5 pt-36 pb-20 md:px-8 md:pt-44">
      <header className="max-w-2xl">
        <h1 className="font-display text-4xl font-semibold tracking-tight md:text-5xl">
          Help Centre
        </h1>
        <p className="text-muted-foreground mt-4 leading-relaxed">
          Browse a topic below, or{" "}
          <Link href="/contact" className="text-foreground underline">
            contact us
          </Link>{" "}
          and a person will reply by email. For safety help, see the{" "}
          <Link href="/safety" className="text-foreground underline">
            Safety Centre
          </Link>
          .
        </p>
      </header>

      <div className="mt-10 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {HELP_CATEGORIES.map((category) => (
          <Link
            key={category.slug}
            href={`/help/${category.slug}`}
            className="border-border hover:border-foreground/25 focus-visible:ring-ring/60 group rounded-3xl border p-6 transition-colors focus-visible:ring-2 focus-visible:outline-none"
          >
            <h2 className="text-foreground text-lg font-semibold">{category.title}</h2>
            <p className="text-muted-foreground mt-2 text-sm leading-relaxed">{category.summary}</p>
            <span className="text-primary-soft mt-4 inline-block text-sm font-medium">
              Open {category.articles.length > 0 ? `(${category.articles.length})` : ""} →
            </span>
          </Link>
        ))}
      </div>

      <div className="border-border mt-10 rounded-3xl border p-6">
        <h2 className="text-foreground text-lg font-semibold">Still need help?</h2>
        <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
          <Link href="/contact" className="text-foreground underline">
            Send us a message
          </Link>{" "}
          and a person will read it. This inbox is not monitored for emergencies - if you or someone
          else is in immediate danger, call 112 or your local emergency number.
        </p>
      </div>
    </main>
  );
}
