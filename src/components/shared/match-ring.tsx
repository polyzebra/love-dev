"use client";

import { motion } from "motion/react";
import { EASE_LUXE } from "@/lib/motion";

/** Animated compatibility ring - fills to `value`% on mount. */
export function MatchRing({ value, size = "sm" }: { value: number; size?: "sm" | "md" }) {
  const r = 15;
  const c = 2 * Math.PI * r;
  const dims = size === "md" ? "size-8" : "size-6";
  return (
    <span className="glass-chip text-foreground flex items-center gap-2 rounded-full py-1 pr-3 pl-1.5 text-xs font-semibold">
      <svg viewBox="0 0 36 36" className={`${dims} -rotate-90`} aria-hidden="true">
        <circle
          cx="18"
          cy="18"
          r={r}
          fill="none"
          stroke="color-mix(in oklab, var(--foreground) 20%, transparent)"
          strokeWidth="3"
        />
        <motion.circle
          cx="18"
          cy="18"
          r={r}
          fill="none"
          stroke="var(--primary-soft)"
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray={c}
          initial={{ strokeDashoffset: c }}
          animate={{ strokeDashoffset: c * (1 - value / 100) }}
          transition={{ duration: 1.4, ease: EASE_LUXE, delay: 0.4 }}
        />
      </svg>
      {value}% match
    </span>
  );
}
