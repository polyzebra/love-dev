import { loadLegalDocument } from "@/lib/legal/loader";
import { buildLegalJsonLd } from "@/lib/legal/seo";
import { renderMarkdown } from "@/lib/legal/markdown";

/**
 * L2.7/L2.8 - the reusable legal renderer. A thin `/legal/<slug>` page delegates
 * here; there is no legal text in any React component. It renders, from the
 * canonical `docs/` master: JSON-LD structured data, the document title, and the
 * legal body (markdown → React). The surrounding enterprise reading shell
 * (`LegalChrome`) supplies breadcrumbs, the metadata / action bar, the sticky
 * table of contents, related policies, and revision history - uniformly for
 * every legal page.
 */
export async function LegalDocument({ slug }: { slug: string }) {
  const { meta, body } = await loadLegalDocument(slug);
  const jsonLd = buildLegalJsonLd(meta, slug);

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <h1>{meta.title}</h1>
      {renderMarkdown(body)}
    </>
  );
}
