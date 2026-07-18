import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/auth/url";
import { LEGAL_DOCS } from "@/lib/legal/registry";
import { isLegalDocSlug } from "@/lib/legal/doc-slugs";
import { loadLegalDocument } from "@/lib/legal/loader";
import { isIndexable } from "@/lib/legal/seo";

/**
 * L2.7 — sitemap integration for the Legal Centre. Lists the hub and every
 * non-external legal route. Doc-backed pages that are still draft / under
 * counsel review are `noindex`, so they are excluded here to keep the sitemap
 * consistent with the robots directives; they appear automatically once their
 * frontmatter flips to published.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = siteUrl().replace(/\/$/, "");
  const entries: MetadataRoute.Sitemap = [
    { url: `${base}/legal`, changeFrequency: "monthly", priority: 0.5 },
  ];

  for (const doc of LEGAL_DOCS) {
    if (doc.external) continue;
    const slug = doc.path.replace("/legal/", "");
    if (isLegalDocSlug(slug)) {
      const { meta } = await loadLegalDocument(slug);
      if (!isIndexable(meta)) continue;
    }
    entries.push({
      url: `${base}${doc.path}`,
      lastModified: doc.lastUpdated,
      changeFrequency: "yearly",
      priority: doc.category === "Core" ? 0.6 : 0.4,
    });
  }

  return entries;
}
