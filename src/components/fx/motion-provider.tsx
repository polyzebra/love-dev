"use client";

import { MotionConfig } from "motion/react";

/**
 * App-wide reduced-motion guard. The CSS kill-switch in globals.css only
 * stops CSS animations; this makes every motion/react `animate` respect
 * prefers-reduced-motion too (transforms are skipped, opacity is kept).
 * Hand-driven motion values (useSpring/useScroll) are NOT covered - those
 * components gate themselves with useReducedMotion().
 */
export function MotionProvider({ children }: { children: React.ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}
