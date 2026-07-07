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
  count: number; online: number; saved: boolean;
  preview: { name: string; photoUrl: string | null }[];
};

/** Up-to-3 overlapping member avatars - real people behind the card. */
function AvatarStack({ preview }: { preview: ExploreCardData["preview"] }) {
  if (preview.length === 0) return null;
  return (
    <span className="flex -space-x-2.5" aria-hidden="true">
      {preview.map((p, i) =>
        p.photoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img key={i} src={p.photoUrl} alt="" className="size-7 rounded-full border-2 border-[#171114] object-cover" />
        ) : (
          <span key={i} className="flex size-7 items-center justify-center rounded-full border-2 border-[#171114] bg-white/12 text-[10px] font-semibold text-white/80">
            {p.name[0]}
          </span>
        ),
      )}
    </span>
  );
}

export function ExploreCard({ card }: { card: ExploreCardData }) {
  return (
    <motion.div whileTap={{ scale: 0.97 }} transition={SPRING.snappy}>
      <Link
        href={`/explore/${card.slug}`}
        className="group relative flex h-[236px] w-full flex-col snap-start overflow-hidden rounded-3xl border border-white/10 bg-card/80 shadow-card transition-shadow hover:shadow-float"
        aria-label={`${card.title}, ${card.count} people`}
      >
        {/* ambient category tint */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 opacity-25 transition-opacity duration-300 group-hover:opacity-40"
          style={{ background: `radial-gradient(140% 100% at 50% 0%, ${card.gradientFrom}66, transparent 65%)` }}
        />
        <div className="relative flex items-start justify-between p-4 pb-0">
          <div className="scale-[0.62] origin-top-left -mb-8">
            <ExploreCard3DVisual iconKey={card.iconKey} imageUrl={card.imageUrl} from={card.gradientFrom} to={card.gradientTo} title={card.title} />
          </div>
          <AvatarStack preview={card.preview} />
        </div>
        <div className="relative mt-auto space-y-1.5 p-4">
          <p className="text-base font-semibold tracking-tight">{card.title}</p>
          {card.description && (
            <p className="line-clamp-1 text-xs text-muted-foreground">{card.description}</p>
          )}
          <div className="flex items-center justify-between pt-1">
            <span className="flex items-center gap-2 text-xs tabular-nums text-muted-foreground">
              {card.count} people
              {card.online > 0 && (
                <span className="flex items-center gap-1 text-emerald-400">
                  <span className="relative flex size-1.5">
                    <span className="absolute h-full w-full animate-ping-soft rounded-full bg-emerald-400" />
                    <span className="relative size-1.5 rounded-full bg-emerald-400" />
                  </span>
                  {card.online} online
                </span>
              )}
            </span>
            <span className="glass-chip rounded-full px-3 py-1 text-[11px] font-semibold text-foreground/90 transition-colors group-hover:bg-primary/25 group-hover:text-white">
              See people
            </span>
          </div>
        </div>
      </Link>
    </motion.div>
  );
}
