import type { Metadata } from "next";
import { PageShell } from "@/components/layout/public";
import { LEGAL_COMPANY, LEGAL_CATEGORY_ORDER, legalDocsByCategory } from "@/lib/legal/registry";
import { isLegalDocSlug } from "@/lib/legal/doc-slugs";
import { loadLegalDocument } from "@/lib/legal/loader";
import { readingMinutes } from "@/lib/legal/markdown";
import { LegalCentreDocs, type HubDoc } from "@/components/legal/legal-centre-docs";

export const metadata: Metadata = {
  title: "Legal Centre",
  description:
    "Tirvea's Legal Centre - terms, privacy, safety, verification, and compliance policies operated by WiseWave Limited.",
  alternates: { canonical: "/legal" },
};

export default async function LegalCentrePage() {
  const groups = legalDocsByCategory();
  const flat = groups.flatMap((g) => g.docs);

  // Reading time for doc-backed pages (computed from the canonical master).
  const docs: HubDoc[] = await Promise.all(
    flat.map(async (d): Promise<HubDoc> => {
      const slug = d.path.replace("/legal/", "");
      let readingMin: number | undefined;
      if (isLegalDocSlug(slug)) {
        try {
          const { body } = await loadLegalDocument(slug);
          readingMin = readingMinutes(body);
        } catch {
          /* fall through - card renders without reading time */
        }
      }
      return {
        path: d.path,
        title: d.title,
        summary: d.summary,
        category: d.category,
        version: d.version,
        lastUpdated: d.lastUpdated,
        status: d.status,
        external: d.external,
        readingMin,
      };
    }),
  );

  const categories = LEGAL_CATEGORY_ORDER.filter((c) => flat.some((d) => d.category === c));

  return (
    <PageShell width="wide">
      <header className="max-w-2xl">
        <p className="text-muted-foreground text-xs font-semibold tracking-[0.14em] uppercase">
          Legal Centre
        </p>
        <h1 className="font-display mt-2 text-4xl font-semibold tracking-tight">
          Policies & terms for Tirvea
        </h1>
        <p className="text-muted-foreground mt-4 leading-relaxed">
          The policies and terms that govern your use of Tirvea. Tirvea is a platform operated by{" "}
          {LEGAL_COMPANY.entity}. Search or browse by category below.
        </p>
      </header>

      {/* Company & platform availability - aligned documentation metadata,
          not a card. Labels are secondary; values lead. */}
      <section
        aria-label="Company information"
        className="border-border/50 mt-10 border-t pt-8 text-sm"
      >
        <dl className="grid gap-y-5 sm:grid-cols-[10rem_1fr] sm:gap-x-8 sm:gap-y-4">
          <div className="sm:contents">
            <dt className="text-muted-foreground text-xs tracking-wide uppercase">Company</dt>
            <dd className="text-foreground mt-1 font-medium sm:mt-0">{LEGAL_COMPANY.entity}</dd>
          </div>
          <div className="sm:contents">
            <dt className="text-muted-foreground text-xs tracking-wide uppercase">CRO number</dt>
            <dd className="text-foreground/90 mt-1 sm:mt-0">
              {LEGAL_COMPANY.companyNumber} · {LEGAL_COMPANY.registrar}
            </dd>
          </div>
          <div className="sm:contents">
            <dt className="text-muted-foreground text-xs tracking-wide uppercase">
              Registered office
            </dt>
            <dd className="text-foreground/90 mt-1 sm:mt-0">
              <address className="not-italic">{LEGAL_COMPANY.address.join(", ")}</address>
            </dd>
          </div>
          <div className="sm:contents">
            <dt className="text-muted-foreground text-xs tracking-wide uppercase">Contact</dt>
            <dd className="mt-1 sm:mt-0">
              <a
                href={`mailto:${LEGAL_COMPANY.email}`}
                className="text-foreground/90 hover:text-foreground underline underline-offset-4"
              >
                {LEGAL_COMPANY.email}
              </a>
            </dd>
          </div>
          <div className="sm:contents">
            <dt className="text-muted-foreground text-xs tracking-wide uppercase">
              Platform availability
            </dt>
            <dd className="text-foreground/90 mt-1 max-w-2xl leading-relaxed sm:mt-0">
              {LEGAL_COMPANY.availabilityStatement}
            </dd>
          </div>
        </dl>
      </section>

      <LegalCentreDocs docs={docs} categories={categories} />
    </PageShell>
  );
}
