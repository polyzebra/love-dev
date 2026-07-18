import type { Metadata } from "next";
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
    <main className="mx-auto max-w-5xl px-5 pt-36 pb-20 md:px-8 md:pt-44">
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

      {/* Company information */}
      <section
        aria-label="Company information"
        className="border-border text-muted-foreground mt-8 rounded-xl border p-5 text-sm leading-relaxed md:p-6"
      >
        <h2 className="text-foreground text-sm font-semibold">{LEGAL_COMPANY.entity}</h2>
        <dl className="mt-3 grid gap-x-8 gap-y-2 sm:grid-cols-2">
          <div>
            <dt className="text-foreground/70 text-xs uppercase">Company number</dt>
            <dd>
              {LEGAL_COMPANY.companyNumber} · {LEGAL_COMPANY.registrar}
            </dd>
          </div>
          <div>
            <dt className="text-foreground/70 text-xs uppercase">Registered office</dt>
            <dd>
              <address className="not-italic">{LEGAL_COMPANY.address.join(", ")}</address>
            </dd>
          </div>
          <div>
            <dt className="text-foreground/70 text-xs uppercase">Contact</dt>
            <dd>
              <a
                href={`mailto:${LEGAL_COMPANY.email}`}
                className="hover:text-foreground underline underline-offset-4"
              >
                {LEGAL_COMPANY.email}
              </a>
            </dd>
          </div>
          <div>
            <dt className="text-foreground/70 text-xs uppercase">Operating regions</dt>
            <dd>{LEGAL_COMPANY.jurisdictions.join(" · ")}</dd>
          </div>
        </dl>
      </section>

      <LegalCentreDocs docs={docs} categories={categories} />
    </main>
  );
}
