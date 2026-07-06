"use client";

import Image from "next/image";
import { motion, useMotionValue, useReducedMotion, useSpring, useTransform } from "motion/react";
import { BadgeCheck, Heart, MapPin, Sparkles } from "lucide-react";

const EASE_LUXE = [0.16, 1, 0.3, 1] as const;

const CARDS = [
  {
    name: "Saoirse, 29",
    city: "Dublin · 2 km",
    photo:
      "https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=480&q=75&auto=format&fit=crop",
    tags: ["Sea swims", "Galleries"],
    match: 96,
  },
  {
    name: "Cian, 31",
    city: "Galway · 5 km",
    photo:
      "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=480&q=75&auto=format&fit=crop",
    tags: ["Trad music", "Cycling"],
    match: 91,
  },
  {
    name: "Amelia, 27",
    city: "Manchester · 3 km",
    photo:
      "https://images.unsplash.com/photo-1524504388940-b1c1722653e1?w=480&q=75&auto=format&fit=crop",
    tags: ["Parkrun", "Coffee"],
    match: 89,
  },
] as const;

function MatchRing({ value }: { value: number }) {
  const r = 15;
  const c = 2 * Math.PI * r;
  return (
    <span className="glass-chip flex items-center gap-2 rounded-full py-1 pl-1.5 pr-3 text-xs font-semibold text-white">
      <svg viewBox="0 0 36 36" className="size-6 -rotate-90" aria-hidden="true">
        <circle cx="18" cy="18" r={r} fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth="3" />
        <motion.circle
          cx="18"
          cy="18"
          r={r}
          fill="none"
          stroke="#fb7185"
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray={c}
          initial={{ strokeDashoffset: c }}
          animate={{ strokeDashoffset: c * (1 - value / 100) }}
          transition={{ duration: 1.6, ease: EASE_LUXE, delay: 0.8 }}
        />
      </svg>
      {value}% match
    </span>
  );
}

function HeroCard({
  card,
  index,
  front,
}: {
  card: (typeof CARDS)[number];
  index: number;
  front: boolean;
}) {
  return (
    <div className="relative h-full w-full overflow-hidden rounded-[28px] border border-white/12 bg-card shadow-float">
      <Image
        src={card.photo}
        alt=""
        fill
        sizes="(max-width: 768px) 70vw, 360px"
        priority={front}
        className="object-cover"
      />
      {/* Cinematic grade */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/15 to-transparent" />
      <div className="absolute inset-0 rounded-[28px] shadow-[inset_0_1px_0_rgba(255,255,255,0.15)]" />

      {/* Top badges */}
      <div className="absolute inset-x-3.5 top-3.5 flex items-center justify-between">
        <MatchRing value={card.match} />
        <span className="glass-chip flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium text-white">
          <span className="relative flex size-2">
            <span className="absolute inline-flex h-full w-full animate-ping-soft rounded-full bg-emerald-400" />
            <span className="relative inline-flex size-2 rounded-full bg-emerald-400" />
          </span>
          Online
        </span>
      </div>

      {/* Identity */}
      <div className="absolute inset-x-0 bottom-0 space-y-2 p-5">
        <p className="flex items-center gap-2 text-xl font-semibold tracking-tight text-white">
          {card.name}
          <motion.span
            initial={{ scale: 0, rotate: -30 }}
            animate={{ scale: 1, rotate: 0 }}
            transition={{ type: "spring", stiffness: 300, damping: 15, delay: 1 + index * 0.15 }}
          >
            <BadgeCheck
              className="size-5 fill-sky-400 text-white"
              aria-label="Photo verified"
            />
          </motion.span>
        </p>
        <p className="flex items-center gap-1.5 text-xs text-white/75">
          <MapPin className="size-3" aria-hidden="true" />
          {card.city}
        </p>
        <div className="flex gap-1.5">
          {card.tags.map((tag) => (
            <span key={tag} className="glass-chip rounded-full px-2.5 py-1 text-[11px] text-white/90">
              {tag}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * A physical deck of profile cards floating in the hero — pointer
 * parallax on desktop, slow levitation everywhere, spring entrances.
 */
export function HeroCards() {
  const reduced = useReducedMotion();
  const mx = useMotionValue(0.5);
  const my = useMotionValue(0.5);
  const spring = { stiffness: 60, damping: 20 };
  const backX = useSpring(useTransform(mx, [0, 1], [14, -14]), spring);
  const backY = useSpring(useTransform(my, [0, 1], [10, -10]), spring);
  const midX = useSpring(useTransform(mx, [0, 1], [-10, 10]), spring);
  const midY = useSpring(useTransform(my, [0, 1], [-6, 6]), spring);
  const frontX = useSpring(useTransform(mx, [0, 1], [-22, 22]), spring);
  const frontY = useSpring(useTransform(my, [0, 1], [-14, 14]), spring);

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (e.pointerType !== "mouse") return;
    const rect = e.currentTarget.getBoundingClientRect();
    mx.set((e.clientX - rect.left) / rect.width);
    my.set((e.clientY - rect.top) / rect.height);
  }

  const enter = (delay: number) =>
    reduced
      ? {}
      : {
          initial: { opacity: 0, y: 60, scale: 0.92 },
          animate: { opacity: 1, y: 0, scale: 1 },
          transition: { duration: 1.1, ease: EASE_LUXE, delay },
        };

  return (
    <div
      onPointerMove={onPointerMove}
      className="relative mx-auto h-[420px] w-[300px] sm:h-[480px] sm:w-[340px]"
      aria-label="Example member profiles"
    >
      {/* Ambient glow behind the deck */}
      <div
        aria-hidden="true"
        className="absolute left-1/2 top-1/2 size-[26rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(closest-side,rgba(225,29,72,0.28),transparent_70%)] blur-2xl"
      />

      {/* Back card */}
      <motion.div {...enter(0.35)} style={{ x: backX, y: backY }} className="absolute inset-0">
        <div className="animate-float-slower absolute inset-0 -translate-x-14 rotate-[-9deg] scale-[0.88] opacity-70 [--float-rotate:-9deg] sm:-translate-x-20">
          <HeroCard card={CARDS[2]} index={2} front={false} />
        </div>
      </motion.div>

      {/* Middle card */}
      <motion.div {...enter(0.2)} style={{ x: midX, y: midY }} className="absolute inset-0">
        <div className="animate-float-slow absolute inset-0 translate-x-14 rotate-[8deg] scale-[0.93] opacity-85 [--float-rotate:8deg] sm:translate-x-20">
          <HeroCard card={CARDS[1]} index={1} front={false} />
        </div>
      </motion.div>

      {/* Front card */}
      <motion.div {...enter(0.05)} style={{ x: frontX, y: frontY }} className="absolute inset-0">
        <div className="animate-float-slow absolute inset-0">
          <HeroCard card={CARDS[0]} index={0} front />
        </div>
      </motion.div>

      {/* Drifting light particles */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        {[
          ["left-[-8%]", "top-[18%]", "size-1.5", "7s", "0s"],
          ["right-[-6%]", "top-[38%]", "size-1", "9s", "1.2s"],
          ["left-[6%]", "bottom-[8%]", "size-1", "8s", "0.6s"],
          ["right-[10%]", "bottom-[-4%]", "size-1.5", "10s", "2s"],
          ["left-[45%]", "top-[-6%]", "size-1", "11s", "1.6s"],
        ].map(([x, y, s, dur, delay], i) => (
          <span
            key={i}
            className={`absolute ${x} ${y} ${s} animate-float-slow rounded-full bg-rose-200/40 blur-[1px]`}
            style={{ animationDuration: dur as string, animationDelay: delay as string }}
          />
        ))}
      </div>

      {/* Floating like bubble */}
      <motion.div
        initial={reduced ? false : { opacity: 0, scale: 0 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ type: "spring", stiffness: 260, damping: 14, delay: 1.4 }}
        className="glass-chip absolute -right-3 top-16 flex size-12 items-center justify-center rounded-full sm:-right-8"
        aria-hidden="true"
      >
        <Heart className="size-5 fill-rose-500 text-rose-500" />
      </motion.div>

      {/* Live conversation preview */}
      <motion.div
        initial={reduced ? false : { opacity: 0, y: 24, scale: 0.9 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: "spring", stiffness: 220, damping: 18, delay: 1.9 }}
        className="glass absolute -bottom-7 -right-2 w-52 rounded-2xl rounded-br-md p-3 text-left shadow-float sm:-right-12"
        aria-hidden="true"
      >
        <p className="text-[11px] font-semibold text-white/90">Saoirse</p>
        <p className="mt-0.5 text-xs leading-snug text-white/75">
          The Forty Foot at 7am — you in?
        </p>
        <span className="mt-2 flex items-center gap-1">
          {[0, 1, 2].map((i) => (
            <motion.span
              key={i}
              className="size-1.5 rounded-full bg-rose-300/80"
              animate={{ opacity: [0.3, 1, 0.3], y: [0, -2, 0] }}
              transition={{ duration: 1.1, repeat: Infinity, delay: i * 0.18 }}
            />
          ))}
          <span className="ml-1.5 text-[10px] text-white/50">you&apos;re typing…</span>
        </span>
      </motion.div>
      <motion.div
        initial={reduced ? false : { opacity: 0, scale: 0 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ type: "spring", stiffness: 260, damping: 14, delay: 1.65 }}
        className="glass-chip absolute -left-4 bottom-44 flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium text-white sm:-left-10"
        aria-hidden="true"
      >
        <Sparkles className="size-3.5 text-gold" />
        It&apos;s a match
      </motion.div>
    </div>
  );
}
