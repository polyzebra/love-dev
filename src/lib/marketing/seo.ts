import type { Metadata } from "next";

/**
 * Per-page metadata for public marketing pages (P1.4). Adds a unique
 * description, a canonical URL, and Open Graph / Twitter overrides on top of
 * the root defaults (title template, site OG image). `index: false` marks a
 * page noindex (still followable) - used for placeholders like the Blog.
 * Canonical/OG url are root-relative; Next resolves them against
 * `metadataBase` set in the root layout.
 */
export function buildMarketingMetadata(opts: {
  title: string;
  description: string;
  path: string;
  index?: boolean;
}): Metadata {
  const { title, description, path, index = true } = opts;
  const ogTitle = `${title} · Tirvea`;
  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: {
      title: ogTitle,
      description,
      url: path,
      type: "website",
      siteName: "Tirvea",
    },
    twitter: { card: "summary_large_image", title: ogTitle, description },
    ...(index ? {} : { robots: { index: false, follow: true } }),
  };
}
