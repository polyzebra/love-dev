"use client";

import Link from "next/link";
import { motion } from "motion/react";
import {
  Coffee, UtensilsCrossed, Headphones, Leaf, Plane, PawPrint, Dumbbell,
  Gamepad2, Palette, Camera, BookOpen, Clapperboard, Car, Cpu,
  HeartHandshake, Gem, Church, Users, Sparkles, MoonStar, CalendarHeart,
  CupSoda, Footprints, UtensilsCrossed as Dinner, Snail, Zap, Mountain,
  Sunrise, Moon, MapPin, GraduationCap, Baby, Dog, type LucideIcon,
} from "lucide-react";
import { SPRING } from "@/lib/motion";

const ICONS: Record<string, LucideIcon> = {
  coffee: Coffee, food: UtensilsCrossed, music: Headphones, nature: Leaf,
  travel: Plane, pets: PawPrint, gym: Dumbbell, gaming: Gamepad2,
  creative: Palette, photo: Camera, reading: BookOpen, movies: Clapperboard,
  cars: Car, tech: Cpu, "long-term": HeartHandshake, ring: Gem,
  marriage: Church, friends: Users, casual: Sparkles, tonight: MoonStar,
  weekend: CalendarHeart, "coffee-now": CupSoda, walk: Footprints,
  dinner: Dinner, introvert: Snail, extrovert: Zap, adventure: Mountain,
  "early-bird": Sunrise, "night-owl": Moon, "map-ie": MapPin, "map-uk": MapPin,
  expat: Plane, student: GraduationCap, parent: Baby, "dog-lover": Dog,
};

/**
 * Glossy 3D-style object built from layered gradients + a specular
 * highlight. `imageUrl` (real rendered assets) swaps in transparently
 * when the category provides one.
 */
export function ExploreCard3DVisual({
  iconKey, imageUrl, from, to, title,
}: { iconKey: string; imageUrl?: string | null; from: string; to: string; title: string }) {
  if (imageUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={imageUrl} alt="" className="size-24 object-contain drop-shadow-[0_16px_24px_rgba(0,0,0,0.45)]" />;
  }
  const Icon = ICONS[iconKey] ?? Sparkles;
  return (
    <span
      aria-hidden="true"
      className="animate-float-slow relative flex size-24 items-center justify-center rounded-[30%]"
      style={{
        background: `radial-gradient(120% 120% at 30% 20%, ${from} 0%, ${to} 62%, color-mix(in oklab, ${to} 55%, black) 100%)`,
        boxShadow: `inset 0 2px 6px rgba(255,255,255,0.5), inset 0 -10px 18px rgba(0,0,0,0.35), 0 18px 30px -12px color-mix(in oklab, ${to} 60%, black)`,
      }}
    >
      {/* specular highlight */}
      <span className="absolute left-3 top-2 h-5 w-10 rounded-full bg-white/45 blur-[6px]" />
      <Icon className="relative size-11 text-white drop-shadow-[0_4px_8px_rgba(0,0,0,0.35)]" strokeWidth={1.8} aria-label={title} />
    </span>
  );
}

export type ExploreCardData = {
  slug: string; title: string; description?: string | null; iconKey: string;
  imageUrl?: string | null; gradientFrom: string; gradientTo: string;
  count: number; saved: boolean;
};

export function ExploreCard({ card }: { card: ExploreCardData }) {
  return (
    <motion.div whileTap={{ scale: 0.97 }} transition={SPRING.snappy}>
      <Link
        href={`/explore/${card.slug}`}
        className="group relative flex h-[230px] flex-col overflow-hidden rounded-3xl border border-white/10 bg-card/80 shadow-card transition-shadow hover:shadow-float"
        aria-label={`${card.title}, ${card.count} people`}
      >
        {/* ambient category tint */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 opacity-25 transition-opacity duration-300 group-hover:opacity-40"
          style={{ background: `radial-gradient(140% 100% at 50% 0%, ${card.gradientFrom}66, transparent 65%)` }}
        />
        <div className="relative flex flex-1 items-center justify-center pt-4">
          <ExploreCard3DVisual iconKey={card.iconKey} imageUrl={card.imageUrl} from={card.gradientFrom} to={card.gradientTo} title={card.title} />
        </div>
        <div className="relative flex items-end justify-between p-4">
          <span className="text-base font-semibold tracking-tight">{card.title}</span>
          <span className="glass-chip rounded-full px-2.5 py-0.5 text-xs font-medium tabular-nums text-foreground/90">
            {card.count}
          </span>
        </div>
      </Link>
    </motion.div>
  );
}
