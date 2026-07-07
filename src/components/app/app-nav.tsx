"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { Compass, Flame, Heart, MessageCircle, PanelLeftClose, PanelLeftOpen, UserRound } from "lucide-react";
import { cn } from "@/lib/utils";
import { Logo } from "@/components/shared/logo";

const NAV_ITEMS = [
  { href: "/discover", label: "Swipe", icon: Flame },
  { href: "/explore", label: "Explore", icon: Compass },
  { href: "/matches", label: "Likes", icon: Heart },
  { href: "/chat", label: "Chat", icon: MessageCircle },
  { href: "/profile", label: "Profile", icon: UserRound },
] as const;

/**
 * Floating glass navigation. Mobile: a levitating capsule tab bar with
 * a spring-animated active halo. Desktop (lg+): a frosted side rail.
 */
export function AppNav() {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);

  // Restore preference and expose rail width to the layout as a CSS var
  useEffect(() => {
    const saved = window.localStorage.getItem("virelsy:rail") === "collapsed";
    const id = window.setTimeout(() => setCollapsed(saved), 0);
    return () => window.clearTimeout(id);
  }, []);
  useEffect(() => {
    document.documentElement.style.setProperty("--rail-w", collapsed ? "7rem" : "17rem");
  }, [collapsed]);
  function toggle() {
    setCollapsed((c) => {
      window.localStorage.setItem("virelsy:rail", c ? "expanded" : "collapsed");
      return !c;
    });
  }

  return (
    <>
      {/* Mobile floating capsule */}
      <nav
        aria-label="Primary"
        className="fixed inset-x-4 bottom-[max(1rem,var(--safe-bottom))] z-40 mx-auto max-w-md lg:hidden"
      >
        <ul className="glass flex items-stretch justify-around rounded-full px-2 py-1.5 shadow-float">
          {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
            const active = pathname.startsWith(href);
            return (
              <li key={href} className="flex-1">
                <Link
                  href={href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "tap-target relative flex flex-col items-center justify-center gap-0.5 rounded-full py-1.5 text-[10px] font-medium transition-colors",
                    active ? "text-white" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {active && (
                    <motion.span
                      layoutId="app-nav-halo"
                      transition={{ type: "spring", stiffness: 380, damping: 32 }}
                      className="absolute inset-x-1 inset-y-0 rounded-full bg-primary/25 shadow-[0_0_18px_rgba(225,29,72,0.35)]"
                    />
                  )}
                  <Icon className={cn("relative size-5", active && "fill-primary/30")} aria-hidden="true" />
                  <span className="relative">{label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* Desktop frosted rail */}
      <aside className={cn("group/rail fixed bottom-4 left-4 top-4 z-40 hidden flex-col overflow-hidden rounded-[28px] border border-white/8 bg-card/50 backdrop-blur-2xl transition-[width] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] lg:flex", collapsed ? "w-[88px]" : "w-60")}>
        <div className={cn("flex items-center py-7", collapsed ? "justify-center px-0" : "justify-between px-6")}>
          {!collapsed && <Logo href="/discover" />}
          <button
            type="button"
            onClick={toggle}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className="tap-target flex items-center justify-center rounded-full p-2 text-muted-foreground transition-colors hover:bg-white/6 hover:text-foreground"
          >
            {collapsed ? <PanelLeftOpen className="size-5" /> : <PanelLeftClose className="size-5" />}
          </button>
        </div>
        <nav aria-label="Primary" className="flex-1 px-3">
          <ul className="space-y-1">
            {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
              const active = pathname.startsWith(href);
              return (
                <li key={href}>
                  <Link
                    href={href}
                    aria-current={active ? "page" : undefined}
                    title={collapsed ? label : undefined}
                    className={cn(
                      "relative flex items-center gap-3 rounded-2xl py-3 text-sm font-medium transition-colors",
                      collapsed ? "justify-center px-0" : "px-4",
                      active
                        ? "text-white"
                        : "text-muted-foreground hover:bg-white/5 hover:text-foreground",
                    )}
                  >
                    {active && (
                      <motion.span
                        layoutId="app-rail-halo"
                        transition={{ type: "spring", stiffness: 380, damping: 32 }}
                        className="absolute inset-0 rounded-2xl bg-primary/20 shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_0_20px_rgba(225,29,72,0.25)]"
                      />
                    )}
                    <Icon className="relative size-5 shrink-0" aria-hidden="true" />
                    <span className={cn("relative whitespace-nowrap transition-[opacity] duration-200", collapsed && "sr-only")}>{label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
        <p className={cn("px-6 py-6 text-xs text-muted-foreground", collapsed && "sr-only")}>Made with care</p>
      </aside>
    </>
  );
}
