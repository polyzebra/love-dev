"use client";

import { Loader2 } from "lucide-react";
import { motion } from "motion/react";
import { Button } from "@/components/ui/button";
import { EASE_LUXE } from "@/lib/motion";
import { cn } from "@/lib/utils";

/**
 * The auth flow's primary CTA. While the request is in flight the
 * label crossfades with a centred spinner - opacity only, both layers
 * stay mounted, so nothing moves and reduced-motion users simply see
 * a very fast fade (the global reduce rule zeroes CSS durations; this
 * fade is 180ms of pure opacity, imperceptible as "animation").
 * The label keeps its space, so the button never changes size.
 */
export function AuthSubmitButton({
  pending,
  className,
  children,
  disabled,
  ...props
}: React.ComponentProps<typeof Button> & { pending: boolean }) {
  return (
    <Button
      type="submit"
      size="lg"
      className={cn("relative h-12 w-full rounded-full", className)}
      disabled={disabled}
      {...props}
    >
      <motion.span
        initial={false}
        animate={{ opacity: pending ? 0 : 1 }}
        transition={{ duration: 0.18, ease: EASE_LUXE }}
        className="inline-flex items-center justify-center gap-2"
      >
        {children}
      </motion.span>
      <motion.span
        initial={false}
        animate={{ opacity: pending ? 1 : 0 }}
        transition={{ duration: 0.18, ease: EASE_LUXE }}
        className="absolute inset-0 flex items-center justify-center"
        aria-hidden="true"
      >
        <Loader2 className="size-4 animate-spin" />
      </motion.span>
    </Button>
  );
}
