"use client";

import { Loader2 } from "lucide-react";
import { motion } from "motion/react";
import { Button } from "@/components/ui/button";
import { EASE_LUXE } from "@/lib/motion";
import { cn } from "@/lib/utils";

/**
 * The auth flow's primary CTA. While the request is in flight the
 * label crossfades with a spinner PLUS a visible pending label -
 * opacity only, both layers stay mounted, so nothing moves and
 * reduced-motion users simply see a very fast fade. A loading button
 * is never a bare spinner on a pill: the user always reads what is
 * happening ("Sending code...").
 */
export function AuthSubmitButton({
  pending,
  pendingLabel = "One moment...",
  className,
  children,
  disabled,
  ...props
}: React.ComponentProps<typeof Button> & {
  pending: boolean;
  /** Visible copy while in flight, e.g. "Sending code...". */
  pendingLabel?: string;
}) {
  return (
    <Button
      type="submit"
      size="lg"
      aria-busy={pending}
      className={cn("relative h-12 w-full rounded-full", className)}
      disabled={disabled}
      {...props}
    >
      <motion.span
        initial={false}
        animate={{ opacity: pending ? 0 : 1 }}
        transition={{ duration: 0.18, ease: EASE_LUXE }}
        aria-hidden={pending}
        className="inline-flex items-center justify-center gap-2"
      >
        {children}
      </motion.span>
      <motion.span
        initial={false}
        animate={{ opacity: pending ? 1 : 0 }}
        transition={{ duration: 0.18, ease: EASE_LUXE }}
        aria-hidden={!pending}
        className="absolute inset-0 flex items-center justify-center gap-2"
      >
        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        {pendingLabel}
      </motion.span>
    </Button>
  );
}
