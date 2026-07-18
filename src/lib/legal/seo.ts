import "server-only";
import type { Metadata } from "next";
import { siteUrl } from "@/lib/auth/url";
import { loadLegalDocument, type LegalDocMeta } from "./loader";

/**
 * L2.7 - automatic SEO for legal pages, derived entirely from the document
 * frontmatter. A document that is still a draft or requires counsel review is
 * marked `noindex` so unapproved legal text is never indexed; it becomes
 * indexable automatically once frontmatter flips to published + no review.
 */

export function isIndexable(meta: LegalDocMeta): boolean {
  return meta.status === "published" && !meta.requiresCounselReview;
}

export function legalCanonicalPath(slug: string): string {
  return `/legal/${slug}`;
}

export function legalAbsoluteUrl(slug: string): string {
  return `${siteUrl().replace(/\/$/, "")}/legal/${slug}`;
}

/** Build Next.js Metadata for a legal page from its frontmatter. */
export async function buildLegalMetadata(slug: string): Promise<Metadata> {
  const { meta } = await loadLegalDocument(slug);
  const canonical = legalCanonicalPath(slug);
  const indexable = isIndexable(meta);
  return {
    title: meta.title,
    description: meta.description,
    alternates: { canonical },
    openGraph: {
      title: meta.title,
      description: meta.description,
      url: legalAbsoluteUrl(slug),
      type: "article",
      siteName: "Tirvea",
    },
    robots: indexable
      ? { index: true, follow: true }
      : { index: false, follow: true, googleBot: { index: false, follow: true } },
  };
}

/** schema.org structured data for a legal document. */
export function buildLegalJsonLd(meta: LegalDocMeta, slug: string): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "WebPage",
    name: meta.title,
    description: meta.description,
    url: legalAbsoluteUrl(slug),
    inLanguage: "en",
    version: meta.version,
    dateModified: meta.lastUpdated,
    ...(meta.effectiveDate ? { datePublished: meta.effectiveDate } : {}),
    publisher: {
      "@type": "Organization",
      name: "WiseWave Limited",
      identifier: "762171",
      email: "info@tirvea.com",
    },
  };
}
