"use client";

import { Fragment } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "motion/react";
import { Compass, Flame, Heart, MessageCircle, Settings, Shield, UserRound } from "lucide-react";
import { cn } from "@/lib/utils";
import { Logo } from "@/components/shared/logo";
import { NavLinkStatus, NavTransitionProvider } from "@/components/app/nav-progress";

const NAV_ITEMS = [
  { href: "/discover", label: "Swipe", icon: Flame },
  { href: "/explore", label: "Explore", icon: Compass },
  { href: "/matches", label: "Likes", icon: Heart },
  { href: "/chat", label: "Chat", icon: MessageCircle },
  { href: "/profile", label: "Profile", icon: UserRound },
] as const;

// Desktop-only: global account settings lives in the rail, below
// Profile. The mobile capsule stays at five items - settings remains
// reachable there via the profile card gear.
const RAIL_ITEMS = [
  ...NAV_ITEMS,
  { href: "/settings", label: "Settings", icon: Settings },
] as const;

// Staff-only rail entry (MODERATOR/ADMIN/SUPER_ADMIN). Rendering is decided
// by the server layout (isStaff on the session role) and flows in as a
// stable RSC prop - never a client fetch, so no hydration mismatch and the
// item is absent from a normal user's HTML entirely. Navigation only: the
// /admin layout enforces its own role gate on every request.
const ADMIN_ITEM = { href: "/admin", label: "Admin", icon: Shield } as const;

/**
 * Floating glass navigation. Mobile: a levitating capsule tab bar with
 * a spring-animated active halo. Desktop (lg+): a frosted side rail.
 * Route transitions keep the old page visible (no (app)/loading.tsx);
 * the NavTransitionProvider's 2px top bar is the only pending signal.
 *
 * `showAdmin` adds the staff Admin entry to the desktop rail (after a
 * subtle divider below Settings). The mobile capsule keeps its five fixed
 * slots - staff reach /admin on mobile via the Staff row on the settings
 * hub, which stays the mobile surface for this entry.
 */
export function AppNav({ showAdmin = false }: { showAdmin?: boolean }) {
  const pathname = usePathname();
  const railItems = showAdmin ? ([...RAIL_ITEMS, ADMIN_ITEM] as const) : RAIL_ITEMS;

  return (
    <NavTransitionProvider>
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
                    active ? "text-foreground" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {active && (
                    <motion.span
                      layoutId="app-nav-halo"
                      transition={{ type: "spring", stiffness: 380, damping: 32 }}
                      className="absolute inset-x-1 inset-y-0 rounded-full bg-primary/25 shadow-[0_0_18px_color-mix(in_srgb,var(--primary)_35%,transparent)]"
                    />
                  )}
                  <Icon className={cn("relative size-5", active && "fill-primary/30")} aria-hidden="true" />
                  <span className="relative">{label}</span>
                  <NavLinkStatus />
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* Desktop frosted rail */}
      <aside className="fixed bottom-4 left-4 top-4 z-40 hidden w-60 flex-col overflow-hidden rounded-xl border border-border bg-card/50 backdrop-blur-2xl lg:flex">
        <div className="px-6 py-7">
          <Logo href="/discover" />
        </div>
        <nav aria-label="Primary" className="flex-1 px-3">
          <ul className="space-y-1">
            {railItems.map(({ href, label, icon: Icon }) => {
              const active = pathname.startsWith(href);
              return (
                <Fragment key={href}>
                  {href === ADMIN_ITEM.href && (
                    <li aria-hidden="true" className="mx-4 my-2 border-t border-border/50" />
                  )}
                  <li>
                    <Link
                      href={href}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "relative flex items-center gap-3 rounded-2xl px-4 py-3 text-sm font-medium transition-colors",
                        active
                          ? "text-foreground"
                          : "text-muted-foreground hover:bg-foreground/5 hover:text-foreground",
                      )}
                    >
                      {active && (
                        <motion.span
                          layoutId="app-rail-halo"
                          transition={{ type: "spring", stiffness: 380, damping: 32 }}
                          // Calm active tint - the old inset glass-highlight
                          // painted a near-white 1px seam across the pill top
                          // in light mode, and the outer glow is decoration.
                          className="absolute inset-0 rounded-2xl bg-primary/15"
                        />
                      )}
                      <Icon className="relative size-5" aria-hidden="true" />
                      <span className="relative">{label}</span>
                      <NavLinkStatus />
                    </Link>
                  </li>
                </Fragment>
              );
            })}
          </ul>
        </nav>
        <p className="px-6 py-6 text-xs text-muted-foreground">Made with care</p>
      </aside>
    </NavTransitionProvider>
  );
}
