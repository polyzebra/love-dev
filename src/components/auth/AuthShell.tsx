"use client";

import { AuthCard } from "./AuthCard";
import { BackButton } from "./BackButton";
import { AnimatePresence, motion } from "motion/react";
import { EASE_LUXE } from "@/lib/motion";
import { useEntranceAnimatable } from "@/components/fx/use-entrance";
import { cn } from "@/lib/utils";

/**
 * Frame for the Tinder-style step auth flow - ONE task per screen.
 *
 * The (auth) route-group layout already provides the full-screen chrome:
 * min-h-dvh, safe-area padding, aurora, the Tirvea logo up top, the
 * glass card (max-w-md centered) and the legal line in the footer. This
 * shell owns everything inside the card: back button, progress dots,
 * the big display title + one-line subtitle, and the slide transition
 * between steps.
 *
 * The card is CONTENT-DRIVEN. An earlier iteration stretched this shell
 * to min-h-[62dvh] so each step could push its CTA to the bottom with
 * mt-auto ("near the thumb"); that design is deliberately REVERSED -
 * it opened a viewport-dependent gulf between the input and its button.
 * Steps now lay out on AuthFormStack's fixed rhythm and the card simply
 * grows with its content; only the page shell around it may size to the
 * viewport.
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
  // Hard loads must paint the step fully visible - the entrance only
  // animates for post-hydration mounts (client navs, step swaps).
  const animatable = useEntranceAnimatable();
  return (
    <AuthCard>
      <div className="mb-8 grid grid-cols-[2.75rem_1fr_2.75rem] items-center">
        {backHref ? (
          <BackButton href={backHref} />
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
                i + 1 === step ? "bg-foreground w-6" : "bg-foreground/20 w-1.5",
              )}
            />
          ))}
        </div>
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          data-debug="auth-motion-shell"
          key={stepKey ?? "step"}
          // Slide ONLY - the freshly routed step must be readable from its
          // first committed frame; an opacity fade re-blanks the card
          // right after the segment loading state unmounts.
          initial={animatable ? { x: 28 } : false}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -28 }}
          transition={{ duration: 0.5, ease: EASE_LUXE }}
        >
          <div className="mb-8 space-y-2">
            <h1 className="font-display text-3xl font-semibold tracking-tight text-balance">
              {title}
            </h1>
            {subtitle != null && <div className="text-muted-foreground text-sm">{subtitle}</div>}
          </div>
          {children}
        </motion.div>
      </AnimatePresence>
    </AuthCard>
  );
}
