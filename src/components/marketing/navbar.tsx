"use client";

import Link from "next/link";
import { motion, useMotionValueEvent, useScroll } from "motion/react";
import { useState } from "react";
import { Menu } from "lucide-react";
import { Logo } from "@/components/shared/logo";
import { Button } from "@/components/ui/button";
import { Magnetic } from "@/components/fx/magnetic";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerTrigger,
  DrawerTitle,
  DrawerDescription,
} from "@/components/ui/drawer";
import { cn } from "@/lib/utils";
import { layout } from "@/components/layout/public";

// Both auth CTAs resolve to /login - the unified entry handles new AND
// returning people (there is no separate password/registration flow).
const NAV_LINKS = [
  { href: "/", label: "Home" },
  { href: "/about", label: "About" },
  { href: "/safety", label: "Safety" },
  { href: "/help", label: "Help" },
  { href: "/pricing", label: "Pricing" },
] as const;

/**
 * Floating glass capsule. Desktop shows the marketing nav + auth CTAs; on
 * scroll it condenses. Mobile collapses the nav into an accessible drawer
 * (vaul: focus trap, Escape to close, labelled).
 */
export function MarketingNavbar() {
  const { scrollY } = useScroll();
  const [condensed, setCondensed] = useState(false);
  const [open, setOpen] = useState(false);
  useMotionValueEvent(scrollY, "change", (y) => setCondensed(y > 48));

  return (
    <header className="safe-top fixed inset-x-0 top-0 z-50 flex justify-center px-3 pt-3">
      <motion.nav
        aria-label="Main"
        layout
        transition={{ type: "spring", stiffness: 260, damping: 30 }}
        className={cn(
          "glass flex w-full items-center justify-between gap-3 rounded-full pr-2 pl-5",
          layout.wide,
          condensed ? "shadow-float py-1.5" : "py-2.5",
        )}
      >
        <Logo size={condensed ? "sm" : "md"} className="transition-all duration-300" />

        {/* Desktop nav */}
        <ul className="text-foreground/75 hidden items-center gap-1 md:flex">
          {NAV_LINKS.map((link) => (
            <li key={link.href}>
              <Link
                href={link.href}
                className="hover:text-foreground focus-visible:ring-ring/60 rounded-full px-3 py-2 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:outline-none"
              >
                {link.label}
              </Link>
            </li>
          ))}
        </ul>

        {/* Desktop auth CTAs */}
        <div className="hidden items-center gap-1.5 md:flex">
          <Button variant="ghost" className="h-10 rounded-full px-4" asChild>
            <Link href="/login">Sign in</Link>
          </Button>
          <Magnetic strength={0.25}>
            <Button className="h-10 rounded-full px-5" asChild>
              <Link href="/login" aria-label="Create your Tirvea account">
                Create account
              </Link>
            </Button>
          </Magnetic>
        </div>

        {/* Mobile: drawer trigger */}
        <div className="md:hidden">
          <Drawer open={open} onOpenChange={setOpen} direction="top">
            <DrawerTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-11 w-11 rounded-full"
                aria-label="Open menu"
              >
                <Menu className="size-5" aria-hidden="true" />
              </Button>
            </DrawerTrigger>
            <DrawerContent className="p-6">
              <DrawerTitle className="sr-only">Menu</DrawerTitle>
              <DrawerDescription className="sr-only">
                Site navigation and account links
              </DrawerDescription>
              <nav aria-label="Mobile">
                <ul className="space-y-1">
                  {NAV_LINKS.map((link) => (
                    <li key={link.href}>
                      <DrawerClose asChild>
                        <Link
                          href={link.href}
                          className="text-foreground hover:bg-muted focus-visible:ring-ring/60 block rounded-xl px-4 py-3 text-base font-medium focus-visible:ring-2 focus-visible:outline-none"
                        >
                          {link.label}
                        </Link>
                      </DrawerClose>
                    </li>
                  ))}
                </ul>
              </nav>
              <div className="mt-4 grid gap-2">
                <DrawerClose asChild>
                  <Button variant="outline" className="h-12 rounded-full" asChild>
                    <Link href="/login">Sign in</Link>
                  </Button>
                </DrawerClose>
                <DrawerClose asChild>
                  <Button className="h-12 rounded-full" asChild>
                    <Link href="/login">Create account</Link>
                  </Button>
                </DrawerClose>
              </div>
            </DrawerContent>
          </Drawer>
        </div>
      </motion.nav>
    </header>
  );
}
