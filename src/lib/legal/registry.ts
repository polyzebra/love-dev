/**
 * L2.1 - THE canonical legal-document registry. Single source of truth for the
 * Legal Centre hub, per-page navigation (breadcrumbs / prev / next / related),
 * document metadata, and the versioning framework. Legal COPY lives in each
 * page; this holds only structural metadata. Entity is always WiseWave Limited.
 */

export const LEGAL_COMPANY = {
  entity: "WiseWave Limited",
  brand: "Tirvea",
  companyNumber: "762171",
  registrar: "Companies Registration Office (Ireland)",
  address: ["39 Cooley Park", "Dundalk", "Co. Louth", "A91 AP2V", "Ireland"],
  email: "info@tirvea.com",
  jurisdictions: ["Ireland", "United Kingdom"],
} as const;

export type LegalCategory =
  | "Core Legal"
  | "Trust & Safety"
  | "Privacy & Data"
  | "Payments"
  | "Verification & Biometrics"
  | "Security & Compliance"
  | "Company & Support";

export type LegalDocStatus = "published" | "draft";

export type LegalDoc = {
  /** Canonical URL (source of truth). */
  path: string;
  title: string;
  summary: string;
  category: LegalCategory;
  /** Document metadata (Task 4 / 7). */
  version: string;
  effectiveDate: string;
  lastUpdated: string;
  revisionHistory: { version: string; date: string; note: string }[];
  language: "en";
  owner: string;
  /** Cross-references (Task 8) - related canonical paths. */
  related: string[];
  /** Versioning framework (Task 7): which consent key gates re-acceptance. */
  consentVersionKey?: "terms" | "privacy" | "community" | "biometric" | "cookies";
  requiresReconsent?: boolean;
  /** "draft" = structural placeholder, copy not yet finalised. */
  status: LegalDocStatus;
  /** External destination (Status page etc.). */
  external?: string;
};

const D = "2026-07-01";
const U = "2026-07-17";
const hist1 = [{ version: "1.0", date: D, note: "Initial version." }];

export const LEGAL_DOCS: LegalDoc[] = [
  // ---- Core ---------------------------------------------------------------
  {
    path: "/legal/terms",
    title: "Terms of Service",
    summary: "The contract between you and WiseWave Limited for using Tirvea.",
    category: "Core Legal",
    version: "1.0",
    effectiveDate: D,
    lastUpdated: U,
    revisionHistory: hist1,
    language: "en",
    owner: "Legal Counsel",
    related: ["/legal/privacy", "/legal/community-guidelines", "/legal/acceptable-use"],
    consentVersionKey: "terms",
    requiresReconsent: true,
    status: "draft",
  },
  {
    path: "/legal/privacy",
    title: "Privacy Policy",
    summary: "How WiseWave Limited, as data controller, processes your personal data.",
    category: "Core Legal",
    version: "1.0",
    effectiveDate: D,
    lastUpdated: U,
    revisionHistory: hist1,
    language: "en",
    owner: "Privacy Counsel / DPO",
    related: ["/legal/cookies", "/legal/data-retention", "/legal/gdpr", "/legal/biometric-data"],
    consentVersionKey: "privacy",
    status: "draft",
  },
  {
    path: "/legal/cookies",
    title: "Cookie Policy",
    summary: "The cookies and similar technologies Tirvea uses, and your choices.",
    category: "Core Legal",
    version: "1.0",
    effectiveDate: D,
    lastUpdated: U,
    revisionHistory: hist1,
    language: "en",
    owner: "Privacy Counsel / DPO",
    related: ["/legal/privacy", "/legal/cookie-preferences"],
    consentVersionKey: "cookies",
    status: "draft",
  },
  {
    path: "/legal/community-guidelines",
    title: "Community Guidelines",
    summary: "The behaviour we expect from everyone on Tirvea.",
    category: "Trust & Safety",
    version: "1.0",
    effectiveDate: D,
    lastUpdated: U,
    revisionHistory: hist1,
    language: "en",
    owner: "Trust & Safety Lead",
    related: ["/legal/acceptable-use", "/legal/trust-safety", "/legal/account-suspension"],
    consentVersionKey: "community",
    requiresReconsent: true,
    status: "draft",
  },
  {
    path: "/legal/acceptable-use",
    title: "Acceptable Use Policy",
    summary: "What you must not do on Tirvea.",
    category: "Trust & Safety",
    version: "1.0",
    effectiveDate: D,
    lastUpdated: U,
    revisionHistory: hist1,
    language: "en",
    owner: "Trust & Safety Lead",
    related: ["/legal/community-guidelines", "/legal/terms", "/legal/copyright"],
    status: "draft",
  },
  // ---- Trust & Safety -----------------------------------------------------
  {
    path: "/legal/trust-safety",
    title: "Trust & Safety Policy",
    summary: "Our framework for keeping the community safe, and how enforcement works.",
    category: "Trust & Safety",
    version: "1.0",
    effectiveDate: D,
    lastUpdated: U,
    revisionHistory: [{ version: "1.0", date: U, note: "Initial master draft." }],
    language: "en",
    owner: "Trust & Safety Lead",
    related: [
      "/legal/appeals",
      "/legal/account-suspension",
      "/legal/transparency",
      "/legal/ai-moderation",
      "/safety",
    ],
    status: "draft",
  },
  {
    path: "/legal/appeals",
    title: "Appeals Policy",
    summary: "How to challenge a moderation or enforcement decision.",
    category: "Trust & Safety",
    version: "1.0",
    effectiveDate: D,
    lastUpdated: U,
    revisionHistory: [{ version: "1.0", date: U, note: "Initial master draft." }],
    language: "en",
    owner: "Trust & Safety Lead",
    related: [
      "/legal/trust-safety",
      "/legal/account-suspension",
      "/legal/community-guidelines",
      "/legal/acceptable-use",
      "/legal/privacy",
    ],
    status: "draft",
  },
  {
    path: "/legal/account-suspension",
    title: "Account Suspension Policy",
    summary: "When and how accounts are limited, suspended, or terminated.",
    category: "Trust & Safety",
    version: "1.0",
    effectiveDate: D,
    lastUpdated: U,
    revisionHistory: [{ version: "1.0", date: U, note: "Initial master draft." }],
    language: "en",
    owner: "Trust & Safety Lead",
    related: [
      "/legal/community-guidelines",
      "/legal/appeals",
      "/legal/account-deletion",
      "/legal/trust-safety",
      "/legal/acceptable-use",
    ],
    status: "draft",
  },
  {
    path: "/legal/child-safety",
    title: "Child Safety Policy",
    summary: "Strict 18+ access and zero tolerance for child sexual abuse material.",
    category: "Trust & Safety",
    version: "1.0",
    effectiveDate: D,
    lastUpdated: U,
    revisionHistory: [{ version: "1.0", date: U, note: "Initial master draft." }],
    language: "en",
    owner: "Trust & Safety Lead",
    related: [
      "/legal/community-guidelines",
      "/legal/trust-safety",
      "/legal/account-suspension",
      "/legal/law-enforcement",
      "/legal/appeals",
    ],
    status: "draft",
  },
  {
    path: "/legal/ai-moderation",
    title: "AI Moderation Policy",
    summary: "How automated tools assist human moderation, with a route to review.",
    category: "Trust & Safety",
    version: "1.0",
    effectiveDate: D,
    lastUpdated: U,
    revisionHistory: [{ version: "1.0", date: U, note: "Initial master draft." }],
    language: "en",
    owner: "Trust & Safety Lead",
    related: [
      "/legal/trust-safety",
      "/legal/community-guidelines",
      "/legal/appeals",
      "/legal/privacy",
      "/legal/transparency",
    ],
    status: "draft",
  },
  {
    path: "/legal/transparency",
    title: "Transparency Report",
    summary: "How we moderate, give reasons, and report on enforcement.",
    category: "Trust & Safety",
    version: "1.0",
    effectiveDate: D,
    lastUpdated: U,
    revisionHistory: hist1,
    language: "en",
    owner: "Trust & Safety Lead",
    related: ["/legal/community-guidelines", "/legal/appeals", "/legal/ai-moderation"],
    status: "draft",
  },
  {
    path: "/legal/law-enforcement",
    title: "Law Enforcement Guidelines",
    summary: "How authorities can request information, and our legal process.",
    category: "Trust & Safety",
    version: "1.0",
    effectiveDate: D,
    lastUpdated: U,
    revisionHistory: hist1,
    language: "en",
    owner: "Legal Counsel",
    related: ["/legal/privacy", "/legal/data-retention", "/legal/child-safety"],
    status: "draft",
  },
  // ---- Privacy & Data -----------------------------------------------------
  {
    path: "/legal/gdpr",
    title: "GDPR & Your Rights",
    summary: "Your data-subject rights and how to exercise them (DSAR).",
    category: "Privacy & Data",
    version: "0.1",
    effectiveDate: D,
    lastUpdated: U,
    revisionHistory: [{ version: "0.1", date: U, note: "Structural placeholder." }],
    language: "en",
    owner: "Privacy Counsel / DPO",
    related: ["/legal/privacy", "/legal/data-retention", "/legal/account-deletion"],
    status: "draft",
  },
  {
    path: "/legal/data-retention",
    title: "Data Retention Policy",
    summary: "How long we keep personal data and when we delete it.",
    category: "Privacy & Data",
    version: "1.0",
    effectiveDate: D,
    lastUpdated: U,
    revisionHistory: hist1,
    language: "en",
    owner: "Privacy Counsel / DPO",
    related: ["/legal/privacy", "/legal/account-deletion", "/legal/biometric-data"],
    status: "draft",
  },
  {
    path: "/legal/account-deletion",
    title: "Account Deletion Policy",
    summary: "How to delete your account and what happens to your data.",
    category: "Privacy & Data",
    version: "0.1",
    effectiveDate: D,
    lastUpdated: U,
    revisionHistory: [{ version: "0.1", date: U, note: "Structural placeholder." }],
    language: "en",
    owner: "Privacy Counsel / DPO",
    related: ["/legal/data-retention", "/legal/gdpr"],
    status: "draft",
  },
  {
    path: "/legal/cookie-preferences",
    title: "Cookie Preferences",
    summary: "Review and change your cookie choices.",
    category: "Privacy & Data",
    version: "0.1",
    effectiveDate: D,
    lastUpdated: U,
    revisionHistory: [{ version: "0.1", date: U, note: "Structural placeholder." }],
    language: "en",
    owner: "Privacy Counsel / DPO",
    related: ["/legal/cookies", "/legal/privacy"],
    consentVersionKey: "cookies",
    status: "draft",
  },
  // ---- Payments -----------------------------------------------------------
  {
    path: "/legal/subscription-terms",
    title: "Subscription Terms",
    summary: "Plans, automatic renewal, cancellation, and cooling-off.",
    category: "Payments",
    version: "1.0",
    effectiveDate: D,
    lastUpdated: U,
    revisionHistory: hist1,
    language: "en",
    owner: "Legal Counsel",
    related: ["/legal/refund-policy", "/legal/terms"],
    status: "draft",
  },
  {
    path: "/legal/refund-policy",
    title: "Refund Policy",
    summary: "Your withdrawal rights and how refunds work.",
    category: "Payments",
    version: "1.0",
    effectiveDate: D,
    lastUpdated: U,
    revisionHistory: hist1,
    language: "en",
    owner: "Legal Counsel",
    related: ["/legal/subscription-terms"],
    status: "draft",
  },
  // ---- Verification -------------------------------------------------------
  {
    path: "/legal/identity-verification",
    title: "Identity Verification Policy",
    summary: "How identity checks work and what we store.",
    category: "Verification & Biometrics",
    version: "1.0",
    effectiveDate: D,
    lastUpdated: U,
    revisionHistory: hist1,
    language: "en",
    owner: "Privacy Counsel + Trust & Safety",
    related: ["/legal/photo-verification", "/legal/privacy"],
    status: "draft",
  },
  {
    path: "/legal/photo-verification",
    title: "Photo Verification Policy",
    summary: "Confirming your profile photos belong to you.",
    category: "Verification & Biometrics",
    version: "1.0",
    effectiveDate: D,
    lastUpdated: U,
    revisionHistory: hist1,
    language: "en",
    owner: "Privacy Counsel + Trust & Safety",
    related: ["/legal/biometric-data", "/legal/identity-verification"],
    status: "draft",
  },
  {
    path: "/legal/biometric-data",
    title: "Biometric Information Policy",
    summary: "How biometric data for photo verification is handled and deleted.",
    category: "Verification & Biometrics",
    version: "1.0",
    effectiveDate: D,
    lastUpdated: U,
    revisionHistory: hist1,
    language: "en",
    owner: "Privacy Counsel + Trust & Safety",
    related: ["/legal/photo-verification", "/legal/privacy", "/legal/data-retention"],
    consentVersionKey: "biometric",
    requiresReconsent: true,
    status: "draft",
  },
  // ---- Security & Compliance ---------------------------------------------
  {
    path: "/legal/security",
    title: "Security Policy",
    summary: "How we protect the platform and your data.",
    category: "Security & Compliance",
    version: "1.0",
    effectiveDate: D,
    lastUpdated: U,
    revisionHistory: hist1,
    language: "en",
    owner: "Security Lead",
    related: ["/legal/vulnerability-disclosure", "/legal/compliance"],
    status: "draft",
  },
  {
    path: "/legal/vulnerability-disclosure",
    title: "Vulnerability Disclosure Policy",
    summary: "How to report a security vulnerability responsibly.",
    category: "Security & Compliance",
    version: "1.0",
    effectiveDate: D,
    lastUpdated: U,
    revisionHistory: hist1,
    language: "en",
    owner: "Security Lead",
    related: ["/legal/security"],
    status: "draft",
  },
  {
    path: "/legal/copyright",
    title: "Copyright Policy",
    summary: "Respecting IP rights and how to report infringement (DMCA).",
    category: "Security & Compliance",
    version: "1.0",
    effectiveDate: D,
    lastUpdated: U,
    revisionHistory: hist1,
    language: "en",
    owner: "Legal Counsel",
    related: ["/legal/acceptable-use", "/legal/terms"],
    status: "draft",
  },
  {
    path: "/legal/compliance",
    title: "Compliance Statement",
    summary: "Our operating entity and the regimes we comply with.",
    category: "Security & Compliance",
    version: "1.0",
    effectiveDate: D,
    lastUpdated: U,
    revisionHistory: hist1,
    language: "en",
    owner: "Legal Counsel",
    related: ["/legal/privacy", "/legal/transparency", "/legal/child-safety"],
    status: "draft",
  },
  // ---- Company & Support --------------------------------------------------
  {
    path: "/legal/contact",
    title: "Legal Contact",
    summary: "How to reach WiseWave Limited about legal or privacy matters.",
    category: "Company & Support",
    version: "0.1",
    effectiveDate: D,
    lastUpdated: U,
    revisionHistory: [{ version: "0.1", date: U, note: "Structural placeholder." }],
    language: "en",
    owner: "Company",
    related: ["/about", "/legal/compliance"],
    status: "draft",
  },
  {
    path: "/legal/status",
    title: "System Status",
    summary: "Live platform status and incident history.",
    category: "Company & Support",
    version: "0.1",
    effectiveDate: D,
    lastUpdated: U,
    revisionHistory: [{ version: "0.1", date: U, note: "Structural placeholder." }],
    language: "en",
    owner: "Operations",
    related: ["/legal/security"],
    status: "draft",
    external: "https://status.tirvea.com",
  },
];

export const LEGAL_CATEGORY_ORDER: LegalCategory[] = [
  "Core Legal",
  "Trust & Safety",
  "Privacy & Data",
  "Payments",
  "Verification & Biometrics",
  "Security & Compliance",
  "Company & Support",
];

export function legalDocByPath(path: string): LegalDoc | undefined {
  return LEGAL_DOCS.find((d) => d.path === path);
}

export function legalDocsByCategory(): { category: LegalCategory; docs: LegalDoc[] }[] {
  return LEGAL_CATEGORY_ORDER.map((category) => ({
    category,
    docs: LEGAL_DOCS.filter((d) => d.category === category),
  })).filter((g) => g.docs.length > 0);
}

/** Prev/next in flat registry order (for per-page navigation). */
export function legalDocNeighbours(path: string): { prev?: LegalDoc; next?: LegalDoc } {
  const i = LEGAL_DOCS.findIndex((d) => d.path === path);
  if (i === -1) return {};
  return { prev: LEGAL_DOCS[i - 1], next: LEGAL_DOCS[i + 1] };
}

export type LegalFooterLink = { href: string; label: string; external?: boolean };

/**
 * L2.9 - registry-backed footer groups. The single source for every legal link
 * in the site footer, so the footer can never drift from the registry. External
 * entries (e.g. the status page) link out; everything else links to its route.
 */
export function legalFooterGroups(): { category: LegalCategory; links: LegalFooterLink[] }[] {
  return LEGAL_CATEGORY_ORDER.map((category) => ({
    category,
    links: LEGAL_DOCS.filter((d) => d.category === category).map((d) => ({
      href: d.external ?? d.path,
      label: d.title,
      external: Boolean(d.external),
    })),
  })).filter((group) => group.links.length > 0);
}
