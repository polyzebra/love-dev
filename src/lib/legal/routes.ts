import { LEGAL_DOC_SLUGS, type LegalDocSlug } from "./doc-slugs";

/**
 * THE canonical Legal Navigation registry (single source of truth for legal
 * URLs). Every legal href in the product resolves from here - no component,
 * page, or layout may hardcode a "/legal/..." string. Enforced by
 * tests/legal-navigation-governance.test.ts.
 *
 * DERIVED, not duplicated: the keys/paths are generated from LEGAL_DOC_SLUGS
 * (doc-slugs.ts) - the same list the loader, registry, and sitemap use - so
 * LEGAL_ROUTES can never drift from the actual routes.
 *
 * Public legal documents live at /legal/<slug> (route group (marketing)/legal),
 * are static, indexable-by-policy, and reachable while logged out and before
 * registration. Navigation is via <a>/<Link href> only - never router.push.
 */

/**
 * Legal documents that render from JSX (not a `docs/` markdown master), so they
 * are NOT in LEGAL_DOC_SLUGS but ARE canonical legal routes present in the
 * registry (LEGAL_DOCS). Keeping them here means LEGAL_ROUTES covers EVERY legal
 * document route. tests/legal-navigation-governance.test.ts asserts LEGAL_ROUTES
 * matches the registry exactly, so this can never silently drift.
 */
export const EXTRA_LEGAL_SLUGS = ["copyright"] as const;
type ExtraLegalSlug = (typeof EXTRA_LEGAL_SLUGS)[number];
type AnyLegalSlug = LegalDocSlug | ExtraLegalSlug;

/** kebab-case slug -> camelCase key (e.g. "community-guidelines" -> "communityGuidelines"). */
type CamelCase<S extends string> = S extends `${infer H}-${infer T}`
  ? `${H}${Capitalize<CamelCase<T>>}`
  : S;

export type LegalRouteKey = CamelCase<AnyLegalSlug>;
export type LegalRoute = `/legal/${AnyLegalSlug}`;

function toCamel(slug: string): string {
  return slug.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
}

/** The Legal Centre hub (index of all documents). Not a document itself. */
export const LEGAL_HUB = "/legal" as const;

/** The href for a legal slug. The ONE place a legal URL is constructed. */
export function legalHref(slug: AnyLegalSlug): LegalRoute {
  return `/legal/${slug}`;
}

const ALL_LEGAL_SLUGS: readonly AnyLegalSlug[] = [...LEGAL_DOC_SLUGS, ...EXTRA_LEGAL_SLUGS];

/**
 * LEGAL_ROUTES.communityGuidelines === "/legal/community-guidelines", etc.
 * Import this (never a string literal) for every legal link.
 */
export const LEGAL_ROUTES = Object.fromEntries(
  ALL_LEGAL_SLUGS.map((slug) => [toCamel(slug), legalHref(slug)]),
) as { readonly [K in LegalRouteKey]: LegalRoute };

/** Reverse lookup for governance/analytics: is this href a canonical legal route? */
export function isLegalRoute(href: string): href is LegalRoute {
  return ALL_LEGAL_SLUGS.some((s) => href === `/legal/${s}`);
}
