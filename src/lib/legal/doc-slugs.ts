/**
 * L2.7 - the canonical list of legal slugs that render from a `docs/` master
 * document (single source of truth) rather than hardcoded JSX. Kept in its own
 * module with NO server-only / fs imports so it is safe to import from both the
 * server loader (`loader.ts`) and the client chrome (`legal-chrome.tsx`).
 */
export const LEGAL_DOC_SLUGS = [
  "terms",
  "copyright",
  "privacy",
  "cookies",
  "community-guidelines",
  "acceptable-use",
  "trust-safety",
  "appeals",
  "account-suspension",
  "child-safety",
  "ai-moderation",
  "data-retention",
  "gdpr",
  "account-deletion",
  "cookie-preferences",
  "biometric-data",
  "photo-verification",
  "identity-verification",
  "subscription-terms",
  "refund-policy",
  "security",
  "vulnerability-disclosure",
  "law-enforcement",
  "transparency",
  "compliance",
] as const;

export type LegalDocSlug = (typeof LEGAL_DOC_SLUGS)[number];

export function isLegalDocSlug(slug: string): slug is LegalDocSlug {
  return (LEGAL_DOC_SLUGS as readonly string[]).includes(slug);
}
