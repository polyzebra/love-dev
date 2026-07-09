"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { EASE_LUXE } from "@/lib/motion";
import { cn } from "@/lib/utils";

/**
 * Frame for the Tinder-style step auth flow - ONE task per screen.
 *
 * The (auth) route-group layout already provides the full-screen chrome:
 * min-h-dvh, safe-area padding, aurora, the Tirvea logo up top, the
 * glass card (max-w-md centered) and the legal line in the footer. This
 * shell owns everything inside the card: back button, progress dots,
 * the big display title + one-line subtitle, and the slide transition
 * between steps. On mobile it stretches so the CTA (whatever the step
 * renders last / with mt-auto) sits near the thumb and stays with the
 * fields when the keyboard opens.
 */

const TOTAL_STEPS = 5;

export function AuthShell({
  step,
  title,
  subtitle,
  backHref,
  stepKey,
  children,
}: {
  /** 1-based position in the 5-step journey (email, code, phone, 18+, legal). */
  step: 1 | 2 | 3 | 4 | 5;
  title: string;
  subtitle?: React.ReactNode;
  /** Where the back arrow goes; omit it where backing out makes no sense. */
  backHref?: string;
  /** Change this to slide the old content out and the new in (in-page state swaps). */
  stepKey?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-[62dvh] flex-col sm:min-h-105">
      <div className="mb-8 grid grid-cols-[2.25rem_1fr_2.25rem] items-center">
        {backHref ? (
          <Link
            href={backHref}
            aria-label="Back"
            className="tap-target -m-2 inline-flex size-9 items-center justify-center rounded-full p-2 text-muted-foreground transition-colors outline-none hover:bg-foreground/5 hover:text-foreground focus-visible:ring-2 focus-visible:ring-foreground/20"
          >
            <ArrowLeft className="size-5" aria-hidden="true" />
          </Link>
        ) : (
          <span aria-hidden="true" />
        )}
        <div
          className="flex items-center justify-center gap-1.5"
          role="img"
          aria-label={`Step ${step} of ${TOTAL_STEPS}`}
        >
          {Array.from({ length: TOTAL_STEPS }, (_, i) => (
            <span
              key={i}
              className={cn(
                "h-1.5 rounded-full transition-all duration-500",
                i + 1 === step
                  ? "w-6 bg-foreground"
                  : "w-1.5 bg-foreground/20",
              )}
            />
          ))}
        </div>
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={stepKey ?? "step"}
          initial={{ opacity: 0, x: 28 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -28 }}
          transition={{ duration: 0.5, ease: EASE_LUXE }}
          className="flex min-h-0 flex-1 flex-col"
        >
          <div className="mb-8 space-y-2">
            <h1 className="font-display text-3xl font-semibold tracking-tight text-balance">
              {title}
            </h1>
            {subtitle != null && (
              <div className="text-sm text-muted-foreground">{subtitle}</div>
            )}
          </div>
          {children}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
