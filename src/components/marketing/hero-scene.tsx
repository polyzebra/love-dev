"use client";

import Image from "next/image";
import { motion, useMotionValue, useReducedMotion, useSpring, useTransform } from "motion/react";
import { EASE_LUXE } from "@/lib/motion";
import { BadgeCheck, Check, Coffee, Heart, MapPin, Sparkles } from "lucide-react";

const PHOTO_SAOIRSE =
  "https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=480&q=75&auto=format&fit=crop";
const PHOTO_CIAN =
  "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=240&q=75&auto=format&fit=crop";
const PHOTO_AMELIA =
  "https://images.unsplash.com/photo-1524504388940-b1c1722653e1?w=240&q=75&auto=format&fit=crop";

function enter(reduced: boolean, delay: number) {
  return reduced
    ? {}
    : {
        initial: { opacity: 0, y: 44, scale: 0.94 },
        animate: { opacity: 1, y: 0, scale: 1 },
        transition: { duration: 1, ease: EASE_LUXE, delay },
      };
}

/** Small animated compatibility ring used inside the scene. */
function Ring({ value, delay }: { value: number; delay: number }) {
  const r = 15;
  const c = 2 * Math.PI * r;
  return (
    <svg viewBox="0 0 36 36" className="size-7 -rotate-90" aria-hidden="true">
      <circle cx="18" cy="18" r={r} fill="none" stroke="rgba(255,255,255,0.18)" strokeWidth="3.5" />
      <motion.circle
        cx="18"
        cy="18"
        r={r}
        fill="none"
        stroke="#fb7185"
        strokeWidth="3.5"
        strokeLinecap="round"
        strokeDasharray={c}
        initial={{ strokeDashoffset: c }}
        animate={{ strokeDashoffset: c * (1 - value / 100) }}
        transition={{ duration: 1.6, ease: EASE_LUXE, delay }}
      />
    </svg>
  );
}

/**
 * The living hero — one cinematic composition of the actual product.
 * Three parallax depth layers (back card · main card · floating UI),
 * everything breathing, nothing static, nothing empty.
 */
export function HeroScene() {
  const reduced = useReducedMotion();
  const mx = useMotionValue(0.5);
  const my = useMotionValue(0.5);
  const spring = { stiffness: 55, damping: 18 };
  // Depth layers move at different rates — closer moves more
  const backX = useSpring(useTransform(mx, [0, 1], [10, -10]), spring);
  const backY = useSpring(useTransform(my, [0, 1], [8, -8]), spring);
  const midX = useSpring(useTransform(mx, [0, 1], [-16, 16]), spring);
  const midY = useSpring(useTransform(my, [0, 1], [-10, 10]), spring);
  const rotY = useSpring(useTransform(mx, [0, 1], [4, -4]), spring);
  const frontX = useSpring(useTransform(mx, [0, 1], [-30, 30]), spring);
  const frontY = useSpring(useTransform(my, [0, 1], [-18, 18]), spring);

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (e.pointerType !== "mouse") return;
    const rect = e.currentTarget.getBoundingClientRect();
    mx.set((e.clientX - rect.left) / rect.width);
    my.set((e.clientY - rect.top) / rect.height);
  }

  return (
    <div
      onPointerMove={onPointerMove}
      className="perspective-stage relative mx-auto h-[560px] w-full max-w-[420px] sm:h-[600px]"
      aria-label="A preview of Virelsy: profiles, matching and conversations"
    >
      {/* Ambient key light + drifting particles */}
      <div
        aria-hidden="true"
        className="absolute left-1/2 top-1/2 size-[24rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(closest-side,rgba(225,29,72,0.26),transparent_70%)] blur-2xl"
      />
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        {[
          ["left-[2%]", "top-[16%]", "7s", "0s"],
          ["right-[0%]", "top-[34%]", "9s", "1.1s"],
          ["left-[10%]", "bottom-[12%]", "8s", "0.5s"],
          ["right-[14%]", "bottom-[4%]", "10s", "1.8s"],
          ["left-[48%]", "top-[2%]", "11s", "1.4s"],
          ["right-[30%]", "top-[8%]", "9.5s", "2.3s"],
        ].map(([x, y, dur, delay], i) => (
          <span
            key={i}
            className={`absolute ${x} ${y} size-1.5 animate-float-slow rounded-full bg-rose-200/40 blur-[1px]`}
            style={{ animationDuration: dur as string, animationDelay: delay as string }}
          />
        ))}
      </div>

      {/* ── BACK LAYER · a second profile waiting in the deck ── */}
      <motion.div
        {...enter(!!reduced, 0.4)}
        style={{ x: backX, y: backY }}
        className="absolute inset-x-8 top-6 h-[440px]"
        aria-hidden="true"
      >
        <div className="animate-float-slower absolute inset-0 -translate-x-16 rotate-[-8deg] scale-[0.86] overflow-hidden rounded-[26px] border border-white/10 opacity-60 [--float-rotate:-8deg]">
          <Image src={PHOTO_AMELIA.replace("w=240", "w=480")} alt="" fill sizes="300px" className="object-cover" />
          <div className="absolute inset-0 bg-black/45" />
          <span className="glass-chip absolute right-3 top-3 flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-medium text-white/90">
            <span className="size-1.5 rounded-full bg-emerald-400" /> Online
          </span>
        </div>
      </motion.div>

      {/* ── MID LAYER · the Discover card, alive ── */}
      <motion.div
        {...enter(!!reduced, 0.1)}
        style={{ x: midX, y: midY, rotateY: rotY }}
        className="preserve-3d absolute inset-x-8 top-6 h-[440px]"
      >
        <div className="animate-float-slow relative h-full w-full overflow-hidden rounded-[28px] border border-white/12 shadow-float">
          <Image src={PHOTO_SAOIRSE} alt="" fill priority sizes="(max-width:768px) 80vw, 340px" className="object-cover" />
          <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/15 to-transparent" />
          <div className="absolute inset-0 rounded-[28px] shadow-[inset_0_1px_0_rgba(255,255,255,0.16)]" />

          {/* Compatibility + why */}
          <div className="absolute left-3.5 top-3.5 space-y-1.5">
            <span className="glass-chip flex w-fit items-center gap-2 rounded-full py-1 pl-1.5 pr-3 text-xs font-semibold text-white">
              <Ring value={96} delay={0.9} /> 96% match
            </span>
            {["3 shared interests", "Both in Dublin"].map((reason, i) => (
              <motion.span
                key={reason}
                initial={reduced ? false : { opacity: 0, x: -12 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 1.3 + i * 0.35, type: "spring", stiffness: 300, damping: 26 }}
                className="glass-chip block w-fit rounded-full px-2.5 py-0.5 text-[10px] font-medium text-white/90"
              >
                {reason}
              </motion.span>
            ))}
          </div>
          <span className="glass-chip absolute right-3.5 top-3.5 flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium text-white">
            <span className="relative flex size-2" aria-hidden="true">
              <span className="absolute inline-flex h-full w-full animate-ping-soft rounded-full bg-emerald-400" />
              <span className="relative inline-flex size-2 rounded-full bg-emerald-400" />
            </span>
            Online
          </span>

          {/* Identity */}
          <div className="absolute inset-x-0 bottom-0 space-y-2 p-5">
            <p className="flex items-center gap-2 text-2xl font-semibold tracking-tight text-white">
              Saoirse, 29
              <motion.span
                role="img"
                aria-label="Photo verified"
                initial={reduced ? false : { scale: 0, rotate: -30 }}
                animate={{ scale: 1, rotate: 0 }}
                transition={{ type: "spring", stiffness: 300, damping: 15, delay: 1.1 }}
                className="relative flex items-center justify-center"
              >
                <span className="absolute size-6 animate-ping-soft rounded-full bg-sky-400/25" />
                <BadgeCheck className="relative size-5 fill-sky-400 text-white" />
              </motion.span>
            </p>
            <p className="flex items-center gap-1.5 text-xs text-white/75">
              <MapPin className="size-3" aria-hidden="true" /> Dublin · 2 km · Long-term
            </p>
            <div className="flex gap-1.5">
              {["Sea swims", "Live music", "Galleries"].map((tag, i) => (
                <motion.span
                  key={tag}
                  initial={reduced ? false : { opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 1 + i * 0.12, type: "spring", stiffness: 350, damping: 24 }}
                  className={`glass-chip rounded-full px-2.5 py-1 text-[11px] font-medium text-white ${i === 0 ? "border-rose-300/40 bg-rose-500/25" : ""}`}
                >
                  {i === 0 && <Sparkles className="mr-1 inline size-3 text-rose-200" aria-hidden="true" />}
                  {tag}
                </motion.span>
              ))}
            </div>
          </div>
        </div>
      </motion.div>

      {/* ── FRONT LAYER · the product happening ── */}
      <motion.div style={{ x: frontX, y: frontY }} className="absolute inset-0">
        {/* Live conversation */}
        <motion.div
          {...enter(!!reduced, 0.9)}
          className="glass absolute -right-2 bottom-16 w-60 rounded-[22px] rounded-br-lg p-3.5 shadow-float sm:-right-6"
        >
          <div className="mb-2 flex items-center gap-2">
            <span className="relative size-6 overflow-hidden rounded-full border border-white/20">
              <Image src={PHOTO_SAOIRSE.replace("w=480", "w=96")} alt="" fill sizes="24px" className="object-cover" />
            </span>
            <p className="text-[11px] font-semibold text-white/90">Saoirse</p>
            <span className="ml-auto text-[9px] uppercase tracking-widest text-white/40">now</span>
          </div>
          <p className="rounded-2xl rounded-bl-md bg-white/8 px-3 py-2 text-xs leading-snug text-white/85">
            The Forty Foot at 7am — you in?
          </p>
          <p className="ml-auto mt-1.5 w-fit rounded-2xl rounded-br-md bg-linear-160 from-[#f43f5e] to-[#be123c] px-3 py-2 text-xs leading-snug text-white shadow-[0_4px_14px_rgba(225,29,72,0.3)]">
            Only if breakfast follows ☕
          </p>
          <span className="mt-2 flex items-center gap-1" aria-hidden="true">
            {[0, 1, 2].map((i) => (
              <motion.span
                key={i}
                className="size-1.5 rounded-full bg-rose-300/80"
                animate={{ opacity: [0.3, 1, 0.3], y: [0, -2, 0] }}
                transition={{ duration: 1.1, repeat: Infinity, delay: i * 0.18 }}
              />
            ))}
          </span>
          {/* Date suggestion inside the conversation */}
          <motion.p
            initial={reduced ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 2, duration: 0.6, ease: EASE_LUXE }}
            className="mt-2 flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] text-gold"
          >
            <Coffee className="size-3" aria-hidden="true" /> A sea swim, then breakfast?
          </motion.p>
        </motion.div>

        {/* Match moment */}
        <motion.div
          initial={reduced ? false : { opacity: 0, scale: 0.6, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ type: "spring", stiffness: 240, damping: 16, delay: 1.5 }}
          className="glass absolute -left-3 top-1/3 flex items-center gap-2.5 rounded-full py-1.5 pl-1.5 pr-4 shadow-float sm:-left-8"
        >
          <span className="flex -space-x-2">
            {[PHOTO_CIAN, PHOTO_AMELIA].map((p, i) => (
              <span key={i} className="relative size-7 overflow-hidden rounded-full border-2 border-[#171114]">
                <Image src={p} alt="" fill sizes="28px" className="object-cover" />
              </span>
            ))}
          </span>
          <span className="text-xs font-semibold text-white">
            It&apos;s a match
            <motion.span
              className="ml-1.5 inline-block"
              initial={reduced ? false : { scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ type: "spring", stiffness: 400, damping: 12, delay: 1.9 }}
            >
              <Heart className="inline size-3.5 fill-rose-500 text-rose-500" aria-hidden="true" />
            </motion.span>
          </span>
        </motion.div>

        {/* Verification moment */}
        <motion.div
          {...enter(!!reduced, 1.7)}
          className="glass-chip absolute right-0 top-24 flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-medium text-white sm:-right-4"
        >
          <span className="flex size-4 items-center justify-center rounded-full bg-sky-400">
            <Check className="size-2.5 text-white" aria-hidden="true" />
          </span>
          Verification approved
        </motion.div>

        {/* Premium hint */}
        <motion.div
          {...enter(!!reduced, 2.1)}
          className="glass-chip absolute -left-2 bottom-6 flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-medium text-gold sm:-left-6"
        >
          <Sparkles className="size-3.5" aria-hidden="true" />
          Premium · see who likes you
        </motion.div>
      </motion.div>
    </div>
  );
}
