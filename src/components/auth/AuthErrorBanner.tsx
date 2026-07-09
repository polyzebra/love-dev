"use client";

import { motion } from "motion/react";
import { EASE_LUXE } from "@/lib/motion";
import { cn } from "@/lib/utils";

/**
 * The ONLY destructive-tinted element in the auth flow - a quiet
 * inline banner reserved for real server errors (wrong code, expired,
 * too many attempts). Renders nothing without a message so steps keep
 * it permanently mounted. Never used for validation hints.
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
  if (!message) return null;
  return (
    <motion.div
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: EASE_LUXE }}
      id={id}
      role="alert"
      className={cn(
        "rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive",
        className,
      )}
    >
      {message}
    </motion.div>
  );
}
