"use client";

import { AnimatePresence, motion } from "motion/react";
import { EASE_LUXE } from "@/lib/motion";
import { useEntranceAnimatable } from "@/components/fx/use-entrance";
import { cn } from "@/lib/utils";

/**
 * The ONLY destructive-tinted element in the auth flow - a quiet
 * inline banner reserved for real server errors (wrong code, expired,
 * too many attempts). Renders nothing without a message so steps keep
 * it permanently mounted - AnimatePresence rises it in and fades it
 * back out instead of popping. Never used for validation hints.
 */
export function AuthErrorBanner({
  message,
  id,
  className,
}: {
  message?: string | null;
  id?: string;
  className?: string;
}) {
  // A server-rendered error (?error=...) must be readable on first
  // paint - never inline-hidden until hydration.
  const animatable = useEntranceAnimatable();
  return (
    <AnimatePresence>
      {message && (
        <motion.div
          initial={animatable ? { opacity: 0, y: -4 } : false}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.25, ease: EASE_LUXE }}
          id={id}
          role="alert"
          className={cn(
            "border-destructive/30 bg-destructive/10 text-destructive rounded-xl border px-4 py-3 text-sm",
            className,
          )}
        >
          {message}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
