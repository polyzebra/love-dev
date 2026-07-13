import Link from "next/link";

const GROUPS = [
  {
    title: "Product",
    links: [
      { href: "/safety", label: "Safety Centre" },
      { href: "/login", label: "Create account" },
    ],
  },
  {
    title: "Legal",
    links: [
      { href: "/legal/terms", label: "Terms of Service" },
      { href: "/legal/privacy", label: "Privacy Policy" },
      { href: "/legal/community-guidelines", label: "Community Guidelines" },
    ],
  },
  {
    title: "Company",
    links: [
      { href: "/safety", label: "Trust & Safety" },
      { href: "mailto:hello@tirvea.app", label: "Contact" },
    ],
  },
] as const;

export function MarketingFooter() {
  return (
    <footer className="relative overflow-hidden border-t border-border">
      <div className="mx-auto grid max-w-6xl gap-12 px-6 py-20 md:grid-cols-[1.4fr_1fr_1fr_1fr] md:px-10">
        <div className="space-y-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/logo-web.svg"
            alt="Tirvea"
            width={134}
            height={32}
            className="h-8 w-auto select-none"
            draggable={false}
          />
          <p className="max-w-xs text-sm leading-relaxed text-muted-foreground">
            Dating, designed with intention.
            <br />
            Wherever you are.
          </p>
        </div>
        {GROUPS.map((group) => (
          <nav key={group.title} aria-label={group.title}>
            {/* h2, not h3: pages like /pricing have no body h2, and an
                h1->h3 jump breaks the heading outline. */}
            <h2 className="mb-4 text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              {group.title}
            </h2>
            <ul className="space-y-3">
              {group.links.map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className="text-sm text-foreground/80 transition-colors hover:text-foreground"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </div>

      {/* Giant brand watermark sinking below the fold (decorative).
          The real logo asset; explicit intrinsic dimensions keep the
          box stable before the SVG loads - no layout shift. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/logo-web.svg"
        alt=""
        aria-hidden="true"
        width={1084}
        height={259}
        draggable={false}
        className="pointer-events-none mx-auto -mb-[2%] block w-full max-w-6xl select-none px-6 opacity-5"
      />

      <div className="border-t border-border">
        <p className="mx-auto max-w-6xl px-6 py-6 text-xs text-muted-foreground md:px-10">
          © {new Date().getFullYear()} Tirvea Ltd. All rights reserved.
        </p>
      </div>
    </footer>
  );
}
