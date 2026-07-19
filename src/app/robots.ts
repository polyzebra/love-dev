import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/auth/url";

/**
 * P1.4 - robots directives. Public marketing + published legal pages are
 * crawlable; app, admin, API, auth, and account surfaces are disallowed.
 * Per-page `noindex` (legal drafts, the Blog placeholder) is handled in each
 * page's metadata rather than here, so crawlers can still follow their links.
 */
export default function robots(): MetadataRoute.Robots {
  const base = siteUrl().replace(/\/$/, "");
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          "/admin",
          "/api/",
          "/settings",
          "/account",
          "/account-blocked",
          "/onboarding",
          "/auth/",
          "/login",
          "/register",
          "/forgot-password",
          "/reset-password",
          "/discover",
          "/chat",
          "/matches",
        ],
      },
    ],
    sitemap: `${base}/sitemap.xml`,
    host: base,
  };
}
