"use client";

import { motion, useReducedMotion } from "motion/react";
import { EASE_LUXE } from "@/lib/motion";
import { cn } from "@/lib/utils";

/**
 * Scroll-into-view reveal. Children rise and settle with an expo-out
 * curve; `delay` staggers siblings. Respects prefers-reduced-motion.
 */
export function Reveal({
  children,
  className,
  delay = 0,
  y = 28,
  once = true,
}: {
  children: React.ReactNode;
  className?: string;
  delay?: number;
  y?: number;
  once?: boolean;
}) {
  const reduced = useReducedMotion();
  return (
    <motion.div
      initial={reduced ? false : { opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once, margin: "-80px" }}
      transition={{ duration: 0.9, ease: EASE_LUXE, delay }}
      className={cn(className)}
    >
      {children}
    </motion.div>
  );
}

/** Stagger container: reveals children with a 70ms cascade. */
export function RevealGroup({
  children,
  className,
  stagger = 0.07,
}: {
  children: React.ReactNode;
  className?: string;
  stagger?: number;
}) {
  const reduced = useReducedMotion();
  return (
    <motion.div
      initial={reduced ? false : "hidden"}
      whileInView="show"
      viewport={{ once: true, margin: "-80px" }}
      variants={{ hidden: {}, show: { transition: { staggerChildren: stagger } } }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

export function RevealItem({
  children,
  className,
  y = 24,
}: {
  children: React.ReactNode;
  className?: string;
  y?: number;
}) {
  // Own gate so a RevealItem misused outside RevealGroup still respects
  // reduced motion (the group's `initial=false` only covers its children).
  const reduced = useReducedMotion();
  return (
    <motion.div
      variants={{
        hidden: reduced ? {} : { opacity: 0, y },
        show: { opacity: 1, y: 0, transition: { duration: 0.8, ease: EASE_LUXE } },
      }}
      className={className}
    >
      {children}
    </motion.div>
  );
}
