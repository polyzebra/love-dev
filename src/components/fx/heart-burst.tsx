"use client";

import { motion } from "motion/react";
import { Heart } from "lucide-react";

/**
 * Celebration: a soft burst of hearts rising and fading. Purely
 * decorative, transform/opacity only, plays once per mount.
 */
export function HeartBurst({ count = 14 }: { count?: number }) {
  // Deterministic pseudo-random spread — stable across renders
  const hearts = Array.from({ length: count }, (_, i) => {
    const t = (i * 137.508) % 360; // golden angle
    return {
      x: Math.sin((t * Math.PI) / 180) * (60 + (i % 5) * 28),
      delay: (i % 7) * 0.08,
      scale: 0.5 + ((i * 37) % 60) / 100,
      duration: 1.6 + ((i * 53) % 80) / 100,
    };
  });

  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
      {hearts.map((h, i) => (
        <motion.span
          key={i}
          className="absolute bottom-1/3 left-1/2"
          initial={{ opacity: 0, y: 0, x: 0, scale: 0 }}
          animate={{ opacity: [0, 1, 0], y: -260 - h.scale * 120, x: h.x, scale: h.scale }}
          transition={{ duration: h.duration, delay: h.delay, ease: "easeOut" }}
        >
          <Heart className="size-6 fill-rose-500/80 text-rose-500/80" />
        </motion.span>
      ))}
    </div>
  );
}
