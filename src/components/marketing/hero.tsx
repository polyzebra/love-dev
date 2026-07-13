import { Aurora } from "@/components/fx/aurora";
import { cn } from "@/lib/utils";

/**
 * The one hero system for all marketing pages.
 *
 * Two compositions, one visual language:
 * - "split":  full-viewport, copy column + product visual (homepage)
 * - "center": editorial page opener (pricing, safety, ...)
 *
 * Entrances are CSS-only (`animate-rise`) so the LCP paints before
 * hydration on every page. Background treatment (aurora + grain) and
 * type hierarchy are fixed here - pages supply only content.
 */
export function MarketingHero({
  eyebrow,
  title,
  subtitle,
  actions,
  visual,
  align = "center",
  intensity,
  className,
}: {
  eyebrow?: string;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  /** CTA row - compose with <HeroCta>. */
  actions?: React.ReactNode;
  /** Right-hand product visual (split layout only). */
  visual?: React.ReactNode;
  align?: "split" | "center";
  intensity?: "hero" | "default" | "faint";
  className?: string;
}) {
  const split = align === "split";

  return (
    <section
      className={cn(
        "noise relative overflow-x-clip",
        split ? "flex min-h-dvh flex-col" : "pt-36 pb-4 md:pt-44",
        className,
      )}
    >
      <Aurora intensity={intensity ?? (split ? "hero" : "default")} />

      <div
        className={cn(
          "relative mx-auto w-full max-w-6xl px-6 md:px-10",
          split
            ? "grid flex-1 items-center gap-10 pt-28 pb-10 md:grid-cols-[0.95fr_1.05fr] md:gap-0"
            : "max-w-5xl",
        )}
      >
        <div
          className={cn(
            "relative z-10",
            split
              ? "space-y-7 text-center md:text-left"
              : "mx-auto max-w-2xl space-y-5 text-center",
          )}
        >
          {eyebrow && (
            <p className="animate-rise text-gold text-xs font-semibold tracking-[0.35em] uppercase">
              {eyebrow}
            </p>
          )}
          <h1
            className={cn(
              "animate-rise font-display font-medium tracking-tight text-balance [--rise-delay:80ms]",
              split
                ? "text-[clamp(2.9rem,8vw,6.8rem)] leading-[0.96]"
                : "text-[clamp(2.6rem,6vw,5rem)] leading-[1.02]",
            )}
          >
            {title}
          </h1>
          {subtitle && (
            <p
              className={cn(
                "animate-rise text-muted-foreground text-lg leading-relaxed [--rise-delay:160ms]",
                split ? "mx-auto max-w-md md:mx-0" : "mx-auto",
              )}
            >
              {subtitle}
            </p>
          )}
          {actions && (
            <div
              className={cn(
                "animate-rise flex flex-col items-center gap-4 [--rise-delay:240ms] sm:flex-row sm:justify-center",
                split && "md:items-start md:justify-start",
              )}
            >
              {actions}
            </div>
          )}
        </div>

        {split && visual && (
          /* The visual deliberately overlaps the copy column on desktop */
          <div className="md:-ml-10 lg:-ml-16">{visual}</div>
        )}
      </div>
    </section>
  );
}
