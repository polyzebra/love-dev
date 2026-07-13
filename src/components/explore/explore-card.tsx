"use client";

import Link from "next/link";
import { motion } from "motion/react";
import {
  ArrowRight,
  CalendarDays,
  Clapperboard,
  Clover,
  Coffee,
  Compass,
  Crown,
  CupSoda,
  Dumbbell,
  Footprints,
  Gamepad2,
  Gem,
  Globe,
  Heart,
  Music,
  Palette,
  Sparkles,
  TreePine,
  Users,
  UtensilsCrossed,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { SPRING } from "@/lib/motion";

/** Keyed by the Lucide icon names used in src/lib/discovery/taxonomy.ts. */
const ICONS: Record<string, LucideIcon> = {
  Sparkles,
  CupSoda,
  Footprints,
  CalendarDays,
  Heart,
  Gem,
  Zap,
  Users,
  Compass,
  Coffee,
  UtensilsCrossed,
  Music,
  TreePine,
  Dumbbell,
  Gamepad2,
  Clapperboard,
  Palette,
  Clover,
  Crown,
  Globe,
};

/**
 * Glossy 3D-style object built from layered gradients + a specular
 * highlight. `imageUrl` (real rendered assets) swaps in transparently
 * when the category provides one.
 */
export function ExploreCard3DVisual({
  iconKey,
  imageUrl,
  from,
  to,
  title,
  size = "lg",
}: {
  iconKey: string;
  imageUrl?: string | null;
  from: string;
  to: string;
  title: string;
  size?: "md" | "lg";
}) {
  const box = size === "lg" ? "size-24" : "size-20";
  if (imageUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={imageUrl}
        alt=""
        className={`${box} object-contain drop-shadow-[0_16px_24px_rgba(0,0,0,0.45)]`}
      />
    );
  }
  const Icon = ICONS[iconKey] ?? Sparkles;
  return (
    <span
      aria-hidden="true"
      className={`animate-float-slow relative flex ${box} items-center justify-center rounded-[30%]`}
      style={{
        background: `radial-gradient(120% 120% at 30% 20%, ${from} 0%, ${to} 62%, color-mix(in oklab, ${to} 55%, black) 100%)`,
        boxShadow: `inset 0 2px 6px rgba(255,255,255,0.5), inset 0 -10px 18px rgba(0,0,0,0.35), 0 18px 30px -12px color-mix(in oklab, ${to} 60%, black)`,
      }}
    >
      {/* specular highlight */}
      <span className="absolute top-2 left-3 h-5 w-10 rounded-full bg-white/45 blur-[6px]" />
      <Icon
        className={`relative ${size === "lg" ? "size-11" : "size-9"} text-white drop-shadow-[0_4px_8px_rgba(0,0,0,0.35)]`}
        strokeWidth={1.8}
        aria-label={title}
      />
    </span>
  );
}

export type ExploreCardData = {
  slug: string;
  title: string;
  description?: string | null;
  iconKey: string;
  imageUrl?: string | null;
  gradientFrom: string;
  gradientTo: string;
  count: number;
  onlineCount: number;
  saved: boolean;
};

export function ExploreCard({ card }: { card: ExploreCardData }) {
  const empty = card.count === 0;
  return (
    <motion.div whileTap={{ scale: 0.97 }} transition={SPRING.snappy} className="h-full">
      <div className="group border-border bg-card/80 shadow-card hover:shadow-float relative flex h-full min-h-[248px] flex-col overflow-hidden rounded-3xl border transition-shadow">
        {/* Whole-card link, stretched under the content */}
        <Link
          href={`/explore/${card.slug}`}
          className="absolute inset-0 z-[1] rounded-3xl"
          aria-label={
            empty
              ? `${card.title}, be the first - see people`
              : `${card.title}, ${card.count} people${card.onlineCount > 0 ? `, ${card.onlineCount} online` : ""} - see people`
          }
        />
        {/* ambient category tint */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 opacity-25 transition-opacity duration-300 group-hover:opacity-40"
          style={{
            background: `radial-gradient(140% 100% at 50% 0%, ${card.gradientFrom}66, transparent 65%)`,
          }}
        />
        {card.saved && (
          <span className="glass-chip text-gold pointer-events-none absolute top-3 right-3 z-[2] rounded-full px-2.5 py-0.5 text-[10px] font-semibold tracking-[0.14em] uppercase">
            Yours
          </span>
        )}
        <div className="pointer-events-none relative flex flex-1 items-center justify-center pt-5">
          <ExploreCard3DVisual
            iconKey={card.iconKey}
            imageUrl={card.imageUrl}
            from={card.gradientFrom}
            to={card.gradientTo}
            title={card.title}
            size="md"
          />
        </div>
        <div className="pointer-events-none relative space-y-1 p-4 pt-3">
          <p className="truncate text-base font-semibold tracking-tight" title={card.title}>
            {card.title}
          </p>
          {card.description && (
            <p className="text-muted-foreground truncate text-xs" title={card.description}>
              {card.description}
            </p>
          )}
          <div className="flex items-end justify-between gap-3 pt-2">
            {empty ? (
              <span className="flex min-w-0 flex-col text-xs">
                <span className="text-muted-foreground">Be the first</span>
                <Link
                  href="/profile"
                  className="text-gold/80 pointer-events-auto relative z-[2] truncate font-medium underline-offset-4 hover:underline"
                >
                  Add this to your profile
                </Link>
              </span>
            ) : (
              <span className="text-muted-foreground flex min-w-0 items-center gap-2.5 text-xs">
                <span className="text-foreground/90 font-medium tabular-nums">
                  {card.count} {card.count === 1 ? "person" : "people"}
                </span>
                {card.onlineCount > 0 && (
                  <span className="text-success flex items-center gap-1">
                    <span aria-hidden="true" className="bg-success size-1.5 rounded-full" />
                    <span className="tabular-nums">{card.onlineCount} online</span>
                  </span>
                )}
              </span>
            )}
            <span className="text-gold flex shrink-0 items-center gap-1 text-xs font-medium">
              See people
              <ArrowRight
                aria-hidden="true"
                className="size-3.5 transition-transform duration-200 group-hover:translate-x-0.5"
              />
            </span>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
