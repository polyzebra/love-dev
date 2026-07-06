"use client";

import Link from "next/link";
import { motion, useMotionValueEvent, useScroll } from "motion/react";
import { useState } from "react";
import { Logo } from "@/components/shared/logo";
import { Button } from "@/components/ui/button";
import { Magnetic } from "@/components/fx/magnetic";
import { cn } from "@/lib/utils";

const LINKS = [
  { href: "/pricing", label: "Pricing" },
  { href: "/safety", label: "Safety" },
] as const;

/**
 * Floating glass capsule. Starts wide and airy over the hero; on scroll
 * it condenses — tighter padding, deeper blur, a visible edge.
 */
export function MarketingNavbar() {
  const { scrollY } = useScroll();
  const [condensed, setCondensed] = useState(false);
  useMotionValueEvent(scrollY, "change", (y) => setCondensed(y > 48));

  return (
    <header className="safe-top fixed inset-x-0 top-0 z-50 flex justify-center px-3 pt-3">
      <motion.nav
        aria-label="Main"
        layout
        transition={{ type: "spring", stiffness: 260, damping: 30 }}
        className={cn(
          "glass flex w-full max-w-5xl items-center justify-between gap-3 rounded-full pl-5 pr-2",
          condensed ? "py-1.5 shadow-float" : "py-2.5",
        )}
      >
        <Logo size={condensed ? "sm" : "md"} className="transition-all duration-300" />
        <div className="hidden items-center gap-1 md:flex">
          {LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="rounded-full px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-white/6 hover:text-foreground"
            >
              {link.label}
            </Link>
          ))}
        </div>
        <div className="flex items-center gap-1.5">
          <Button variant="ghost" className="rounded-full max-sm:hidden" asChild>
            <Link href="/login">Sign in</Link>
          </Button>
          <Magnetic strength={0.25}>
            <Button size="lg" className="h-11 rounded-full px-6" asChild>
              <Link href="/register">Join Amora</Link>
            </Button>
          </Magnetic>
        </div>
      </motion.nav>
    </header>
  );
}
