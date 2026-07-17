import Link from "next/link";
import { ChevronDown } from "lucide-react";

/**
 * Premium SaaS footer / Legal Centre.
 *  - Desktop (>=1024px): a static, permanently-expanded 5-column grid. No JS,
 *    no accordion, every link in the HTML.
 *  - Mobile (<1024px): CSS-only collapsible sections (a focusable checkbox +
 *    :has() + a grid-rows 0fr->1fr height animation, ~200ms, no layout shift,
 *    chevron rotates). Links stay in the DOM (SEO + a11y), never lazy-rendered.
 * Zero client JavaScript.
 */
type FooterLink = { href: string; label: string; external?: boolean };

const GROUPS: { title: string; id: string; links: FooterLink[] }[] = [
  {
    title: "Product",
    id: "footer-product",
    links: [
      { href: "/safety", label: "Safety Centre" },
      { href: "/login", label: "Create Account" },
      { href: "/login", label: "Sign In" },
      { href: "/settings/support", label: "Help" },
    ],
  },
  {
    title: "Legal",
    id: "footer-legal",
    links: [
      { href: "/legal/terms", label: "Terms of Service" },
      { href: "/legal/privacy", label: "Privacy Policy" },
      { href: "/legal/cookies", label: "Cookie Policy" },
      { href: "/legal/refund-policy", label: "Refund Policy" },
      { href: "/legal/subscription-terms", label: "Subscription Terms" },
    ],
  },
  {
    title: "Safety & Compliance",
    id: "footer-safety",
    links: [
      { href: "/legal/community-guidelines", label: "Community Guidelines" },
      { href: "/safety", label: "Trust & Safety" },
      { href: "/legal/identity-verification", label: "Identity Verification Policy" },
      { href: "/legal/photo-verification", label: "Photo Verification Policy" },
      { href: "/legal/biometric-data", label: "Biometric Information Policy" },
      { href: "/legal/ai-moderation", label: "AI Moderation Policy" },
      { href: "/legal/security", label: "Security Policy" },
      { href: "/legal/child-safety", label: "Child Safety Policy" },
      { href: "/legal/data-retention", label: "Data Retention Policy" },
      { href: "/legal/transparency", label: "Transparency Report" },
      { href: "/legal/compliance", label: "Compliance Statement" },
      { href: "/legal/law-enforcement", label: "Law Enforcement Guidelines" },
      { href: "/legal/copyright", label: "Copyright Policy" },
      { href: "/legal/vulnerability-disclosure", label: "Vulnerability Disclosure Policy" },
    ],
  },
  {
    title: "Company",
    id: "footer-company",
    links: [
      { href: "/about", label: "About" },
      { href: "mailto:info@tirvea.com", label: "Contact", external: true },
      { href: "/careers", label: "Careers" },
      { href: "/blog", label: "Blog" },
      { href: "/press", label: "Press" },
    ],
  },
];

const LINK_CLASS =
  "text-foreground/75 hover:text-foreground text-[15px] leading-6 underline-offset-4 transition-colors hover:underline";

function FooterLinks({ links }: { links: FooterLink[] }) {
  return (
    <ul className="space-y-3 pt-1 pb-5 lg:pt-4 lg:pb-0">
      {links.map((link) =>
        link.external ? (
          <li key={`${link.href}-${link.label}`}>
            <a href={link.href} className={LINK_CLASS}>
              {link.label}
            </a>
          </li>
        ) : (
          <li key={`${link.href}-${link.label}`}>
            <Link href={link.href} className={LINK_CLASS}>
              {link.label}
            </Link>
          </li>
        ),
      )}
    </ul>
  );
}

function FooterSection({ title, id, links }: (typeof GROUPS)[number]) {
  return (
    <nav aria-label={title} className="group/sec border-border border-b lg:border-none">
      {/* Focusable checkbox drives the mobile-only CSS accordion. Hidden on
          desktop so it is not a stray tab stop (desktop is always expanded). */}
      <input type="checkbox" id={id} className="peer sr-only lg:hidden" />
      <label
        htmlFor={id}
        className="peer-focus-visible:ring-ring/60 flex cursor-pointer items-center justify-between rounded-md py-4 select-none peer-focus-visible:ring-2 peer-focus-visible:ring-offset-2 lg:pointer-events-none lg:py-0"
      >
        <span className="text-muted-foreground text-xs font-semibold tracking-[0.12em] uppercase">
          {title}
        </span>
        <ChevronDown
          aria-hidden="true"
          className="text-muted-foreground size-4 shrink-0 duration-200 group-has-[:checked]/sec:rotate-180 motion-safe:transition-transform lg:hidden"
        />
      </label>
      <div className="grid grid-rows-[0fr] duration-200 ease-out group-has-[:checked]/sec:grid-rows-[1fr] motion-safe:transition-[grid-template-rows] lg:grid-rows-[1fr]">
        <div className="overflow-hidden">
          <FooterLinks links={links} />
        </div>
      </div>
    </nav>
  );
}

export function MarketingFooter() {
  return (
    <footer className="border-border border-t">
      <div className="mx-auto grid max-w-6xl grid-cols-1 gap-x-10 gap-y-1 px-6 py-14 md:px-10 md:py-20 lg:grid-cols-[1.6fr_1fr_1fr_1.5fr_1fr] lg:items-start lg:gap-8">
        {/* Branding block */}
        <div className="mb-6 max-w-xs lg:mb-0">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/logo-web.svg"
            alt="Tirvea"
            width={134}
            height={32}
            className="h-8 w-auto select-none"
            draggable={false}
          />
          <p className="text-muted-foreground mt-4 text-sm leading-relaxed">
            Dating, designed with intention.
            <br />
            Wherever you are.
          </p>
          <p className="text-muted-foreground mt-4 text-sm leading-relaxed">
            Verified identities.
            <br />
            Private conversations.
            <br />
            Built for meaningful connections.
          </p>
        </div>

        {GROUPS.map((group) => (
          <FooterSection key={group.id} {...group} />
        ))}
      </div>

      {/* Bottom */}
      <div className="border-border border-t">
        <p className="text-muted-foreground mx-auto max-w-6xl px-6 py-6 text-xs md:px-10">
          © {new Date().getFullYear()} WiseWave Limited. All rights reserved.
        </p>
      </div>
    </footer>
  );
}
