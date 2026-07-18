import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseFrontmatter } from "./markdown";
import { LEGAL_DOC_SLUGS, type LegalDocSlug, isLegalDocSlug } from "./doc-slugs";

/**
 * L2.7 - the legal document loader. The single point at which a `/legal/<slug>`
 * route is bound to its canonical `docs/` master. It reads the markdown, parses
 * and validates frontmatter (throwing on any missing required field), and
 * extracts the publishable legal body - the "## 3. Output - Complete/Full ..."
 * section, i.e. only the legal text, never the internal drafting scaffolding
 * (Document control, consistency reviews, checklists, review notes).
 */

/** slug → canonical master file under docs/. The ONLY place this mapping lives. */
export const LEGAL_DOC_FILES: Record<LegalDocSlug, string> = {
  terms: "L2.2-TERMS-OF-SERVICE-DRAFT.md",
  privacy: "L2.3-PRIVACY-POLICY-DRAFT.md",
  cookies: "L2.4-COOKIE-POLICY-DRAFT.md",
  "community-guidelines": "L2.5-COMMUNITY-GUIDELINES-DRAFT.md",
  "acceptable-use": "L2.6-ACCEPTABLE-USE-POLICY-DRAFT.md",
  "trust-safety": "L3.1-TRUST-AND-SAFETY-POLICY-DRAFT.md",
  appeals: "L3.2-APPEALS-POLICY-DRAFT.md",
  "account-suspension": "L3.3-ACCOUNT-SUSPENSION-POLICY-DRAFT.md",
  "child-safety": "L3.4-CHILD-SAFETY-POLICY-DRAFT.md",
  "ai-moderation": "L3.5-AI-MODERATION-POLICY-DRAFT.md",
  "data-retention": "L4.1-DATA-RETENTION-POLICY-DRAFT.md",
  gdpr: "L4.2-GDPR-RIGHTS-POLICY-DRAFT.md",
  "account-deletion": "L4.3-ACCOUNT-DELETION-POLICY-DRAFT.md",
  "cookie-preferences": "L4.4-COOKIE-PREFERENCES-POLICY-DRAFT.md",
  "biometric-data": "L5.1-BIOMETRIC-INFORMATION-POLICY-DRAFT.md",
  "photo-verification": "L5.2-PHOTO-VERIFICATION-POLICY-DRAFT.md",
  "identity-verification": "L5.3-IDENTITY-VERIFICATION-POLICY-DRAFT.md",
  "subscription-terms": "L6.1-SUBSCRIPTION-TERMS-DRAFT.md",
  "refund-policy": "L6.2-REFUND-POLICY-DRAFT.md",
};

export type LegalDocMeta = {
  title: string;
  slug: string;
  category: string;
  version: string;
  effectiveDate: string;
  lastUpdated: string;
  status: "draft" | "published";
  owner: string;
  requiresCounselReview: boolean;
  requiresReConsent: boolean;
  relatedPolicies: string[];
  description: string;
  consentVersion?: string;
};

const REQUIRED_FIELDS = [
  "title",
  "slug",
  "category",
  "version",
  "effectiveDate",
  "lastUpdated",
  "status",
  "owner",
  "requiresCounselReview",
  "requiresReConsent",
  "relatedPolicies",
  "description",
] as const;

export { LEGAL_DOC_SLUGS, isLegalDocSlug };
export type { LegalDocSlug };

export function hasLegalDocument(slug: string): slug is LegalDocSlug {
  return isLegalDocSlug(slug);
}

/** Load, validate, and return the metadata + publishable body for a slug. */
export async function loadLegalDocument(
  slug: string,
): Promise<{ meta: LegalDocMeta; body: string }> {
  if (!hasLegalDocument(slug)) {
    throw new Error(`[legal] no canonical document is registered for slug "${slug}"`);
  }
  const file = LEGAL_DOC_FILES[slug];
  const fullPath = path.join(process.cwd(), "docs", file);
  const raw = await readFile(fullPath, "utf8");

  const { data } = parseFrontmatter(raw);
  const missing = REQUIRED_FIELDS.filter((k) => !(k in data));
  if (missing.length > 0) {
    throw new Error(`[legal] ${file} is missing required frontmatter: ${missing.join(", ")}`);
  }
  if (data.slug !== slug) {
    throw new Error(`[legal] frontmatter slug "${String(data.slug)}" ≠ route "${slug}" in ${file}`);
  }
  if (data.status !== "draft" && data.status !== "published") {
    throw new Error(`[legal] ${file} has invalid status "${String(data.status)}"`);
  }

  const body = extractBody(raw, file);
  if (!body) {
    throw new Error(`[legal] ${file} produced an empty legal body`);
  }

  return { meta: data as unknown as LegalDocMeta, body };
}

/**
 * The publishable legal text is the "## 3. Output - Complete/Full ..." section,
 * bounded by the next "## 4. Output - ..." heading. Everything else in the
 * master (Document control, TOC, architecture, consistency/DSA reviews, legal
 * review notes, readiness checklist) is internal drafting scaffolding and MUST
 * NOT be published.
 */
function extractBody(raw: string, file: string): string {
  const lines = raw.replace(/\r\n/g, "\n").split("\n");
  // The publishable body is the "## N. Output - Complete/Full <Doc>" section,
  // bounded by the next "## N. Output ..." heading. It is located by that
  // heading rather than a fixed number, so documents that carry extra outputs
  // (e.g. a repository audit before the body) still extract correctly.
  const start = lines.findIndex((l) => /^## \d+\. Output\b.*\b(Complete|Full)\b/i.test(l));
  if (start === -1) {
    throw new Error(`[legal] cannot locate the "## N. Output - Complete/Full ..." body in ${file}`);
  }
  const relEnd = lines.slice(start + 1).findIndex((l) => /^## \d+\. Output\b/.test(l));
  const end = relEnd === -1 ? lines.length : start + 1 + relEnd;
  return lines
    .slice(start + 1, end)
    .join("\n")
    .trim();
}
