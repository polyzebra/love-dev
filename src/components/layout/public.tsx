import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * L5.2 - THE single source of truth for public-page layout architecture.
 *
 * No public page may define its own max-width, horizontal padding, page top/
 * bottom padding, section rhythm, or grid gap. Every public page composes the
 * primitives below, which read from this one token map. Change a value here and
 * it changes across the entire public surface - so pages, the hero, the reading
 * shell, grids, the nav and the footer can never drift apart.
 *
 * Widths:
 *   reading (max-w-3xl / 48rem) - long-form prose: About, policies, articles.
 *   wide    (max-w-5xl / 64rem) - hubs, grids, navigation, footer, landing.
 * Both share one horizontal padding and one vertical rhythm, so nav, hero,
 * content and footer align to the same left/right edges on every viewport.
 */
export const layout = {
  reading: "max-w-3xl",
  wide: "max-w-5xl",
  /** Landing archetype (homepage): a wider frame with roomier padding. Still a
   *  token, so the homepage inherits from this one source, never hardcodes. */
  landing: "max-w-6xl",
  hero: "max-w-4xl",
  paddingX: "px-5 md:px-8",
  landingPaddingX: "px-6 md:px-10",
  heroPaddingX: "px-6",
  paddingTop: "pt-36 md:pt-44",
  paddingBottom: "pb-20 md:pb-24",
  section: "mt-20 md:mt-28",
  gridGap: "gap-4",
} as const;

export type LayoutWidth = "reading" | "wide";

/**
 * The public page container. The semantic <main> is owned by the marketing
 * layout, so this renders a <div> (avoids nested <main> landmarks). Provides
 * mx-auto centring, the width token, horizontal padding, and the page top/
 * bottom padding that clears the floating navbar.
 */
export function PageShell({
  width = "wide",
  className,
  children,
}: {
  width?: LayoutWidth;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "mx-auto",
        layout[width],
        layout.paddingX,
        layout.paddingTop,
        layout.paddingBottom,
        className,
      )}
    >
      {children}
    </div>
  );
}

/**
 * A width-constrained, horizontally-padded container WITHOUT the page top/
 * bottom padding - for the navbar, footer, and landing sections that own their
 * vertical spacing. Same width + padding tokens, so edges align with PageShell.
 */
export function Container({
  width = "wide",
  className,
  children,
}: {
  width?: LayoutWidth;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("mx-auto", layout[width], layout.paddingX, className)}>{children}</div>
  );
}

/** A content section carrying the shared vertical rhythm. */
export function Section({
  id,
  labelledBy,
  className,
  children,
}: {
  id?: string;
  labelledBy?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={labelledBy} className={cn(layout.section, className)}>
      {children}
    </section>
  );
}

/** Card grid with the shared gap. `cols` picks 2- or 3-up on large viewports. */
export function CardGrid({
  cols = 3,
  className,
  children,
}: {
  cols?: 2 | 3;
  className?: string;
  children: ReactNode;
}) {
  return (
    <ul
      className={cn(
        "grid grid-cols-1",
        layout.gridGap,
        cols === 2 ? "sm:grid-cols-2" : "sm:grid-cols-2 lg:grid-cols-3",
        className,
      )}
    >
      {children}
    </ul>
  );
}

/** CTA button row with the shared spacing. */
export function CTAGroup({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return <div className={cn("mt-8 flex flex-wrap gap-3", className)}>{children}</div>;
}
