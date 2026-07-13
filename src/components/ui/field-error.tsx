"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { DURATIONS, EASE_LUXE } from "@/lib/motion";
import { cn } from "@/lib/utils";

/**
 * Inline field-level error text - the ONLY sanctioned companion to a
 * red (aria-invalid) field. Renders nothing when there is no message,
 * so callers can keep it permanently mounted:
 *
 *   <Input aria-invalid={!!error} aria-describedby={error ? id : undefined} />
 *   <InlineFieldError id={id} message={error} />
 *
 * The message eases in (height + opacity, house curve) so the content
 * below settles instead of jumping; reduced motion swaps it instantly.
 */
function InlineFieldError({
  message,
  id,
  className,
}: {
  message?: string | null;
  id?: string;
  className?: string;
}) {
  const reduced = useReducedMotion();
  return (
    <AnimatePresence initial={false}>
      {message && (
        <motion.p
          key="field-error"
          initial={reduced ? false : { height: 0, opacity: 0 }}
          animate={{ height: "auto", opacity: 1 }}
          exit={reduced ? { opacity: 0 } : { height: 0, opacity: 0 }}
          transition={{ duration: DURATIONS.standard, ease: EASE_LUXE }}
          id={id}
          role="alert"
          className={cn("text-destructive overflow-hidden text-xs", className)}
        >
          {message}
        </motion.p>
      )}
    </AnimatePresence>
  );
}

export { InlineFieldError };
