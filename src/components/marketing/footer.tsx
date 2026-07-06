import Link from "next/link";

const GROUPS = [
  {
    title: "Product",
    links: [
      { href: "/pricing", label: "Pricing" },
      { href: "/safety", label: "Safety Centre" },
      { href: "/register", label: "Create account" },
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
      { href: "mailto:hello@amora.app", label: "Contact" },
    ],
  },
] as const;

export function MarketingFooter() {
  return (
    <footer className="relative overflow-hidden border-t border-white/8">
      <div className="mx-auto grid max-w-6xl gap-12 px-6 py-20 md:grid-cols-[1.4fr_1fr_1fr_1fr] md:px-10">
        <div className="space-y-4">
          <p className="font-display text-3xl font-semibold tracking-tight">Amora</p>
          <p className="max-w-xs text-sm leading-relaxed text-muted-foreground">
            Dating, designed with intention.
            <br />
            Made for Ireland &amp; the UK.
          </p>
        </div>
        {GROUPS.map((group) => (
          <nav key={group.title} aria-label={group.title}>
            <h3 className="mb-4 text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              {group.title}
            </h3>
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

      {/* Giant editorial wordmark sinking below the fold (decorative) */}
      <svg
        aria-hidden="true"
        viewBox="0 0 600 150"
        className="pointer-events-none mx-auto -mb-[2%] block w-full max-w-6xl select-none px-6"
      >
        <text
          x="50%"
          y="115"
          textAnchor="middle"
          className="font-display"
          fontSize="150"
          fontWeight="600"
          fill="rgba(255,255,255,0.045)"
        >
          Amora
        </text>
      </svg>

      <div className="border-t border-white/8">
        <p className="mx-auto max-w-6xl px-6 py-6 text-xs text-muted-foreground md:px-10">
          © {new Date().getFullYear()} Amora Ltd. Registered in Ireland. All rights reserved.
        </p>
      </div>
    </footer>
  );
}
