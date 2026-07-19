import type { Metadata } from "next";
import { PageShell } from "@/components/layout/public";
import Link from "next/link";
import { buildMarketingMetadata } from "@/lib/marketing/seo";
import {
  Flag,
  Ban,
  ShieldAlert,
  UserX,
  MessageSquareWarning,
  Baby,
  BadgeCheck,
  Camera,
  Scale,
  Lock,
  Landmark,
  LifeBuoy,
} from "lucide-react";

export const metadata: Metadata = buildMarketingMetadata({
  title: "Safety Centre",
  description:
    "Practical safety help for Tirvea: how to report and block, handle scams, harassment and threats, verification, appeals, privacy, and emergencies.",
  path: "/safety",
});

type SafetyLink = { href: string; label: string };
type SafetySection = {
  id: string;
  icon: typeof Flag;
  title: string;
  body: string;
  links: SafetyLink[];
};

const SECTIONS: SafetySection[] = [
  {
    id: "report",
    icon: Flag,
    title: "Report a user",
    body: "Report a profile or a single message using the report tool in the app. A person reviews reports, and serious reports are prioritised. You can report without the other person knowing.",
    links: [
      { href: "/legal/trust-safety", label: "How reports are handled" },
      { href: "/legal/community-guidelines", label: "Community Guidelines" },
      { href: "/contact", label: "Contact the safety team" },
    ],
  },
  {
    id: "block",
    icon: Ban,
    title: "Block someone",
    body: "Blocking stops someone from seeing you, matching with you, or messaging you. Use Block from a profile or a chat. Blocking is separate from reporting - you can do both.",
    links: [{ href: "/legal/community-guidelines", label: "What's not allowed" }],
  },
  {
    id: "scams",
    icon: ShieldAlert,
    title: "Scams & fraud",
    body: "Never send money, gift cards, or crypto to someone you have not met. Be wary of anyone who quickly asks to move off Tirvea, professes love fast, or asks for financial help. Report and block them.",
    links: [
      { href: "/legal/community-guidelines", label: "Prohibited behaviour" },
      { href: "/contact", label: "Report a scam" },
    ],
  },
  {
    id: "fake-profiles",
    icon: UserX,
    title: "Fake profiles",
    body: "Verification helps you know who is real. Look for verification badges, and report profiles that seem fake or use someone else's photos.",
    links: [
      { href: "/legal/identity-verification", label: "Identity verification" },
      { href: "/safety/face-check", label: "Photo verification, explained" },
    ],
  },
  {
    id: "harassment",
    icon: MessageSquareWarning,
    title: "Harassment & threats",
    body: "Harassment, hate, and threats are not allowed. Report and block anyone who behaves this way. If a threat makes you fear for your safety, treat it as an emergency (below) and contact your local authorities.",
    links: [
      { href: "/legal/community-guidelines", label: "Community Guidelines" },
      { href: "/legal/trust-safety", label: "Trust & Safety Policy" },
      { href: "/contact", label: "Report harassment" },
    ],
  },
  {
    id: "child-safety",
    icon: Baby,
    title: "Child safety",
    body: "Tirvea is strictly for adults (18+). We do not tolerate any content or behaviour that sexualises or endangers minors. Reports of child endangerment are treated with the highest priority and we cooperate with the appropriate authorities.",
    links: [{ href: "/legal/child-safety", label: "Child Safety Policy" }],
  },
  {
    id: "identity-verification",
    icon: BadgeCheck,
    title: "Identity verification",
    body: "Identity verification checks a government ID to confirm a real person is behind an account. It is used for trust and safety.",
    links: [{ href: "/legal/identity-verification", label: "Identity Verification Policy" }],
  },
  {
    id: "photo-verification",
    icon: Camera,
    title: "Photo verification",
    body: "Photo verification uses a short live video selfie to confirm the person matches their photos. Learn how it works and how your data is handled.",
    links: [
      { href: "/safety/face-check", label: "Photo verification, explained" },
      { href: "/legal/photo-verification", label: "Photo Verification Policy" },
      { href: "/help/photo-verification", label: "Troubleshooting" },
    ],
  },
  {
    id: "appeals",
    icon: Scale,
    title: "Appeals & account suspension",
    body: "If a decision affected your account, you can ask us to review it. Learn what suspension means and how to appeal.",
    links: [
      { href: "/legal/appeals", label: "Appeals Policy" },
      { href: "/legal/account-suspension", label: "Account Suspension Policy" },
    ],
  },
  {
    id: "privacy",
    icon: Lock,
    title: "Privacy & your data",
    body: "Your precise location is never shown. You control your visibility, and you can export or delete your data at any time.",
    links: [
      { href: "/legal/privacy", label: "Privacy Policy" },
      { href: "/legal/gdpr", label: "Your data rights" },
      { href: "/legal/account-deletion", label: "Delete your account" },
    ],
  },
  {
    id: "law-enforcement",
    icon: Landmark,
    title: "Law enforcement",
    body: "Information for authorities making a lawful request for data, and how we respond.",
    links: [{ href: "/legal/law-enforcement", label: "Law Enforcement Guidelines" }],
  },
];

const TIPS = [
  "Keep chatting inside Tirvea until you trust someone - scammers push to move to other apps fast.",
  "Meet the first few times in a public place, and tell a friend where you'll be.",
  "Never send money, gift cards, or crypto to someone you met online.",
  "Don't share your home address, financial details, or one-time codes.",
  "Trust your instincts - if something feels off, stop, block, and report.",
];

export default function SafetyPage() {
  return (
    <PageShell width="wide">
      <header className="max-w-2xl">
        <p className="text-primary-soft text-sm font-semibold tracking-wide uppercase">
          Trust &amp; safety
        </p>
        <h1 className="font-display mt-3 text-4xl font-semibold tracking-tight md:text-5xl">
          Safety Centre
        </h1>
        <p className="text-muted-foreground mt-4 leading-relaxed">
          Practical help for staying safe on Tirvea - how to report and block, spot scams, handle
          harassment, verify who you&apos;re talking to, and control your privacy. For the formal
          rules, see the{" "}
          <Link href="/legal/trust-safety" className="text-foreground underline">
            Trust &amp; Safety Policy
          </Link>
          .
        </p>
      </header>

      {/* Emergency guidance - honest about what this platform can and cannot do. */}
      <div className="border-destructive/40 bg-destructive/10 mt-8 flex items-start gap-3 rounded-3xl border p-5">
        <LifeBuoy className="text-destructive mt-0.5 size-5 shrink-0" aria-hidden="true" />
        <div>
          <h2 className="text-foreground font-semibold">In immediate danger?</h2>
          <p className="text-muted-foreground mt-1 text-sm leading-relaxed">
            Call <strong>112</strong> or your local emergency number. Tirvea is not an emergency
            service and cannot dispatch help. If you are not in immediate danger but need us, report
            in the app or{" "}
            <Link href="/contact" className="text-foreground underline">
              contact the safety team
            </Link>
            .
          </p>
        </div>
      </div>

      <div className="mt-10 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {SECTIONS.map(({ id, icon: Icon, title, body, links }) => (
          <section
            key={id}
            id={id}
            aria-labelledby={`${id}-title`}
            className="border-border rounded-3xl border p-6"
          >
            <Icon className="text-primary-soft size-5" aria-hidden="true" />
            <h2 id={`${id}-title`} className="text-foreground mt-3 text-lg font-semibold">
              {title}
            </h2>
            <p className="text-muted-foreground mt-2 text-sm leading-relaxed">{body}</p>
            <ul className="mt-4 space-y-1.5">
              {links.map((link) => (
                <li key={link.href + link.label}>
                  <Link
                    href={link.href}
                    className="text-foreground/80 hover:text-foreground focus-visible:ring-ring/60 rounded-sm text-sm underline underline-offset-4 focus-visible:ring-2 focus-visible:outline-none"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>

      <section aria-labelledby="tips-title" className="mt-12">
        <h2 id="tips-title" className="font-display text-2xl font-semibold tracking-tight">
          Dating safety tips
        </h2>
        <ul className="text-muted-foreground mt-4 grid gap-3 sm:grid-cols-2">
          {TIPS.map((tip) => (
            <li key={tip} className="border-border rounded-2xl border p-4 text-sm leading-relaxed">
              {tip}
            </li>
          ))}
        </ul>
      </section>
    </PageShell>
  );
}
