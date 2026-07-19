import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/auth/url";
import { LEGAL_DOCS } from "@/lib/legal/registry";
import { isLegalDocSlug } from "@/lib/legal/doc-slugs";
import { loadLegalDocument } from "@/lib/legal/loader";
import { isIndexable } from "@/lib/legal/seo";
import { HELP_CATEGORIES } from "@/lib/help/content";

/**
 * L2.7 / P1.4 — sitemap for the public surface: the marketing/company pages,
 * the Help Centre (categories + articles), and every published legal route.
 * Excluded: auth/app/admin/api surfaces, the Blog placeholder (noindex), and
 * legal drafts under counsel review (noindex) - they appear automatically once
 * their frontmatter flips to published.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = siteUrl().replace(/\/$/, "");

  // Public marketing / company pages (indexable). Blog is excluded (noindex
  // placeholder); auth pages are never SEO landing pages.
  const MARKETING: { path: string; priority: number; changeFrequency: MetadataRoute.Sitemap[number]["changeFrequency"] }[] = [
    { path: "/", priority: 1.0, changeFrequency: "weekly" },
    { path: "/about", priority: 0.7, changeFrequency: "monthly" },
    { path: "/safety", priority: 0.7, changeFrequency: "monthly" },
    { path: "/help", priority: 0.7, changeFrequency: "monthly" },
    { path: "/contact", priority: 0.6, changeFrequency: "yearly" },
    { path: "/pricing", priority: 0.7, changeFrequency: "monthly" },
    { path: "/careers", priority: 0.4, changeFrequency: "monthly" },
    { path: "/press", priority: 0.4, changeFrequency: "monthly" },
  ];

  const entries: MetadataRoute.Sitemap = [
    ...MARKETING.map((m) => ({
      url: `${base}${m.path}`,
      changeFrequency: m.changeFrequency,
      priority: m.priority,
    })),
    { url: `${base}/legal`, changeFrequency: "monthly", priority: 0.5 },
  ];

  // Help Centre: category landings + articles.
  for (const category of HELP_CATEGORIES) {
    entries.push({
      url: `${base}/help/${category.slug}`,
      changeFrequency: "monthly",
      priority: 0.4,
    });
    for (const article of category.articles) {
      entries.push({
        url: `${base}/help/${category.slug}/${article.slug}`,
        changeFrequency: "yearly",
        priority: 0.3,
      });
    }
  }

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
      priority: doc.category === "Core Legal" ? 0.6 : 0.4,
    });
  }

  return entries;
}
