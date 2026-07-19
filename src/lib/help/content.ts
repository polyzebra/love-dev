import { LEGAL_ROUTES, LEGAL_HUB } from "@/lib/legal/routes";
/**
 * Help Centre content (P1.3). Data-driven category + article architecture.
 * Every article is REPOSITORY-BACKED: it describes only behaviour the platform
 * actually implements (passwordless auth, verification, Stripe billing/refunds,
 * GDPR export/deletion, reporting/appeals) and links to the owning policy for
 * the formal wording. No invented capabilities, SLAs, or staffing.
 */

export type HelpBlock =
  | { kind: "p"; text: string }
  | { kind: "list"; items: string[] }
  | { kind: "links"; items: { href: string; label: string }[] };

export type HelpArticle = {
  slug: string;
  title: string;
  summary: string;
  blocks: HelpBlock[];
};

export type HelpCategory = {
  slug: string;
  title: string;
  summary: string;
  /** Existing policy/pages surfaced as further reading for the category. */
  resources: { href: string; label: string }[];
  articles: HelpArticle[];
};

export const HELP_CATEGORIES: HelpCategory[] = [
  {
    slug: "getting-started",
    title: "Getting started",
    summary: "Create your account, sign in, and understand how Tirvea works.",
    resources: [
      { href: "/about", label: "About Tirvea" },
      { href: "/safety", label: "Safety Centre" },
    ],
    articles: [
      {
        slug: "how-sign-in-works",
        title: "How signing in works",
        summary: "Tirvea is passwordless - you sign in with a one-time code or Google.",
        blocks: [
          {
            kind: "p",
            text: "Tirvea does not use passwords. You sign in with a one-time code sent to your email or phone, or with Google. There is nothing to remember and no password to reset.",
          },
          {
            kind: "list",
            items: [
              "Enter your email or phone number, or choose Google.",
              "We send a 6-digit code (for email or phone). Enter it to continue.",
              "New here? The same step creates your account - there is no separate sign-up.",
            ],
          },
          {
            kind: "p",
            text: "If you can't get in, use the account-recovery options rather than looking for a password reset.",
          },
          { kind: "links", items: [{ href: "/auth/recovery", label: "Trouble signing in" }] },
        ],
      },
      {
        slug: "creating-your-account",
        title: "Creating your account",
        summary: "You must be 18+, confirm your age, and accept the policies.",
        blocks: [
          {
            kind: "p",
            text: "Tirvea is for adults only. When you join, you confirm you are 18 or older and accept the Terms of Service, Privacy Policy, and Community Guidelines before you can use the app.",
          },
          {
            kind: "links",
            items: [
              { href: LEGAL_ROUTES.terms, label: "Terms of Service" },
              { href: LEGAL_ROUTES.communityGuidelines, label: "Community Guidelines" },
            ],
          },
        ],
      },
    ],
  },
  {
    slug: "account",
    title: "Account",
    summary: "Manage your account, sign-in methods, and deletion.",
    resources: [
      { href: LEGAL_ROUTES.accountDeletion, label: "Account Deletion Policy" },
      { href: LEGAL_ROUTES.accountSuspension, label: "Account Suspension Policy" },
    ],
    articles: [
      {
        slug: "delete-your-account",
        title: "Delete your account",
        summary: "How deletion works and what happens to your data.",
        blocks: [
          {
            kind: "p",
            text: "You can delete your account from Settings once signed in. Deletion is permanent after a short grace period, and your personal data is erased in line with our policies.",
          },
          {
            kind: "links",
            items: [
              { href: LEGAL_ROUTES.accountDeletion, label: "Account Deletion Policy" },
              { href: LEGAL_ROUTES.dataRetention, label: "Data Retention Policy" },
            ],
          },
        ],
      },
    ],
  },
  {
    slug: "verification",
    title: "Verification",
    summary: "Identity and photo verification, and what the badges mean.",
    resources: [
      { href: LEGAL_ROUTES.identityVerification, label: "Identity Verification Policy" },
      { href: LEGAL_ROUTES.photoVerification, label: "Photo Verification Policy" },
      { href: LEGAL_ROUTES.biometricData, label: "Biometric Information Policy" },
    ],
    articles: [
      {
        slug: "identity-vs-photo",
        title: "Identity vs photo verification",
        summary: "Two different checks that build trust in different ways.",
        blocks: [
          {
            kind: "p",
            text: "Identity verification checks a government ID to confirm a real person is behind an account. Photo verification uses a short live video selfie to confirm the person matches their photos. They are separate checks with their own badges.",
          },
          {
            kind: "links",
            items: [{ href: "/safety/face-check", label: "Photo verification, explained" }],
          },
        ],
      },
      {
        slug: "photo-verification-help",
        title: "Photo verification troubleshooting",
        summary: "If your video selfie didn't work, try these steps.",
        blocks: [
          {
            kind: "p",
            text: "Photo verification needs good lighting, a steady camera, and your face clearly in frame. If it fails, you can try again.",
          },
          {
            kind: "links",
            items: [{ href: "/help/photo-verification", label: "Full troubleshooting guide" }],
          },
        ],
      },
    ],
  },
  {
    slug: "billing",
    title: "Billing & subscriptions",
    summary: "Plans, payments, renewals, cancellation, and refunds.",
    resources: [
      { href: "/pricing", label: "Plans & pricing" },
      { href: LEGAL_ROUTES.subscriptionTerms, label: "Subscription Terms" },
      { href: LEGAL_ROUTES.refundPolicy, label: "Refund Policy" },
    ],
    articles: [
      {
        slug: "cancel-subscription",
        title: "Cancel your subscription",
        summary: "Cancelling stops future renewals; access continues to period end.",
        blocks: [
          {
            kind: "p",
            text: "You can cancel a paid plan at any time. Cancellation takes effect at the end of your current billing period - you keep your plan until then, and you are not charged again. When it ends, your plan reverts to the free tier.",
          },
          {
            kind: "links",
            items: [{ href: LEGAL_ROUTES.subscriptionTerms, label: "Subscription Terms" }],
          },
        ],
      },
      {
        slug: "refunds",
        title: "Refunds",
        summary: "When a refund may be available and how to ask for one.",
        blocks: [
          {
            kind: "p",
            text: "Refunds are handled case by case in line with the Refund Policy and your statutory rights. Cancelling is not itself a refund of the current period. To ask about a refund, contact us with your account email and the charge date.",
          },
          {
            kind: "links",
            items: [
              { href: LEGAL_ROUTES.refundPolicy, label: "Refund Policy" },
              { href: "/contact", label: "Request a refund" },
            ],
          },
        ],
      },
    ],
  },
  {
    slug: "privacy",
    title: "Privacy & security",
    summary: "Your data, your rights, and how we protect the platform.",
    resources: [
      { href: LEGAL_ROUTES.privacy, label: "Privacy Policy" },
      { href: LEGAL_ROUTES.gdpr, label: "Your data rights (GDPR)" },
      { href: LEGAL_ROUTES.cookies, label: "Cookie Policy" },
      { href: LEGAL_ROUTES.security, label: "Security Policy" },
    ],
    articles: [
      {
        slug: "export-or-delete-data",
        title: "Export or delete your data",
        summary: "You can download your data or erase your account.",
        blocks: [
          {
            kind: "p",
            text: "From Settings you can export your data (data portability) or delete your account (erasure). These rights are described in the Privacy Policy and the GDPR rights policy.",
          },
          {
            kind: "links",
            items: [
              { href: LEGAL_ROUTES.gdpr, label: "Your data rights" },
              { href: LEGAL_ROUTES.accountDeletion, label: "Account deletion" },
            ],
          },
        ],
      },
    ],
  },
  {
    slug: "safety",
    title: "Safety, reporting & appeals",
    summary: "Report a user, block someone, and appeal a decision.",
    resources: [
      { href: "/safety", label: "Safety Centre" },
      { href: LEGAL_ROUTES.trustSafety, label: "Trust & Safety Policy" },
      { href: LEGAL_ROUTES.communityGuidelines, label: "Community Guidelines" },
      { href: LEGAL_ROUTES.appeals, label: "Appeals Policy" },
    ],
    articles: [
      {
        slug: "report-a-user",
        title: "Report a user",
        summary: "How to report a profile or message, and what happens next.",
        blocks: [
          {
            kind: "p",
            text: "Use the report tool on a profile or a message. A person reviews reports, and serious reports are prioritised. You can report without the other person knowing. For anything involving immediate danger, contact your local emergency services (112).",
          },
          {
            kind: "links",
            items: [
              { href: "/safety", label: "Safety Centre" },
              { href: LEGAL_ROUTES.trustSafety, label: "How reports are handled" },
            ],
          },
        ],
      },
      {
        slug: "appeal-a-decision",
        title: "Appeal a decision",
        summary: "If your account was actioned, you can ask us to review it.",
        blocks: [
          {
            kind: "p",
            text: "If a moderation decision affected your account, you can appeal and ask a person to review it. The Appeals Policy explains the process and what to expect.",
          },
          {
            kind: "links",
            items: [
              { href: LEGAL_ROUTES.appeals, label: "Appeals Policy" },
              { href: LEGAL_ROUTES.accountSuspension, label: "Account suspension" },
            ],
          },
        ],
      },
    ],
  },
  {
    slug: "legal",
    title: "Legal",
    summary: "Every policy in one place.",
    resources: [{ href: LEGAL_HUB, label: "Browse the Legal Centre" }],
    articles: [],
  },
];

export function getHelpCategory(slug: string): HelpCategory | undefined {
  return HELP_CATEGORIES.find((c) => c.slug === slug);
}

export function getHelpArticle(
  categorySlug: string,
  articleSlug: string,
): { category: HelpCategory; article: HelpArticle } | undefined {
  const category = getHelpCategory(categorySlug);
  const article = category?.articles.find((a) => a.slug === articleSlug);
  if (!category || !article) return undefined;
  return { category, article };
}

/** Other articles in the same category (for the "related" rail). */
export function relatedArticles(categorySlug: string, exceptSlug: string): HelpArticle[] {
  const category = getHelpCategory(categorySlug);
  if (!category) return [];
  return category.articles.filter((a) => a.slug !== exceptSlug).slice(0, 4);
}
