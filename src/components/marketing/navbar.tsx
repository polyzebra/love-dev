import Link from "next/link";
import { Logo } from "@/components/shared/logo";
import { Button } from "@/components/ui/button";

const LINKS = [
  { href: "/pricing", label: "Pricing" },
  { href: "/safety", label: "Safety" },
] as const;

export function MarketingNavbar() {
  return (
    <header className="glass safe-top sticky top-0 z-50 border-b">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-5 md:px-8">
        <Logo />
        <nav aria-label="Marketing" className="hidden items-center gap-1 md:flex">
          {LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="rounded-full px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              {link.label}
            </Link>
          ))}
        </nav>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="lg" className="rounded-full" asChild>
            <Link href="/login">Sign in</Link>
          </Button>
          <Button size="lg" className="rounded-full" asChild>
            <Link href="/register">Join Amora</Link>
          </Button>
        </div>
      </div>
    </header>
  );
}
