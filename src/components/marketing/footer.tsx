import Link from "next/link";
import { ChevronDown } from "lucide-react";
import { legalFooterGroups, type LegalFooterLink } from "@/lib/legal/registry";
import { layout } from "@/components/layout/public";
import { cn } from "@/lib/utils";
import { LEGAL_HUB } from "@/lib/legal/routes";

/**
 * Premium SaaS footer / Legal Centre.
 *  - Desktop (>=1024px): a static, permanently-expanded grid. No JS, no
 *    accordion, every link in the HTML.
 *  - Mobile (<1024px): CSS-only collapsible sections (a focusable checkbox +
 *    :has() + a grid-rows 0fr->1fr height animation, ~200ms, no layout shift,
 *    chevron rotates). Links stay in the DOM (SEO + a11y), never lazy-rendered.
 * Zero client JavaScript.
 *
 * L2.9: every legal link is derived from the canonical registry
 * (`legalFooterGroups`), so the footer can never drift from the Legal Centre.
 * Only the non-legal Product and Company columns are curated here.
 */
type FooterLink = LegalFooterLink;

const MARKETING_GROUPS: { title: string; id: string; links: FooterLink[] }[] = [
  {
    title: "Product",
    id: "footer-product",
    links: [
      { href: "/safety", label: "Safety Centre" },
      { href: "/login", label: "Create Account" },
      { href: "/login", label: "Sign In" },
      { href: "/help", label: "Help" },
    ],
  },
  {
    title: "Company",
    id: "footer-company",
    links: [
      { href: "/about", label: "About" },
      { href: "/contact", label: "Contact" },
      { href: "/careers", label: "Careers" },
      { href: "/blog", label: "Blog" },
      { href: "/press", label: "Press" },
    ],
  },
];

const LINK_CLASS =
  "text-foreground/75 hover:text-foreground text-[15px] leading-6 underline-offset-4 transition-colors hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 rounded-sm";

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

function FooterSection({ title, id, links }: { title: string; id: string; links: FooterLink[] }) {
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

function categoryId(category: string): string {
  return (
    "footer-legal-" +
    category
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
  );
}

export function MarketingFooter() {
  const legalGroups = legalFooterGroups();
  return (
    <footer className="border-border border-t">
      <div className={cn("mx-auto py-14 md:py-20", layout.wide, layout.paddingX)}>
        {/* Top: branding + marketing columns */}
        <div className="grid grid-cols-1 gap-x-10 gap-y-1 lg:grid-cols-[1.8fr_1fr_1fr] lg:items-start lg:gap-8">
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

          {MARKETING_GROUPS.map((group) => (
            <FooterSection key={group.id} {...group} />
          ))}
        </div>

        {/* Legal Centre: every link derived from the registry */}
        <div className="border-border mt-10 border-t pt-10">
          <div className="mb-2 flex items-baseline justify-between lg:mb-6">
            <h2 className="text-foreground text-sm font-semibold">Legal Centre</h2>
            <Link
              href={LEGAL_HUB}
              className="text-muted-foreground hover:text-foreground focus-visible:ring-ring/60 rounded-sm text-xs underline-offset-4 transition-colors hover:underline focus-visible:ring-2 focus-visible:outline-none"
            >
              View all
            </Link>
          </div>
          <div className="grid grid-cols-1 gap-x-8 gap-y-0 sm:grid-cols-2 lg:grid-cols-4 lg:gap-y-8">
            {legalGroups.map((group) => (
              <FooterSection
                key={group.category}
                title={group.category}
                id={categoryId(group.category)}
                links={group.links}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Bottom */}
      <div className="border-border border-t">
        <p
          className={cn("text-muted-foreground mx-auto py-6 text-xs", layout.wide, layout.paddingX)}
        >
          © {new Date().getFullYear()} WiseWave Limited. All rights reserved.
        </p>
      </div>
    </footer>
  );
}
