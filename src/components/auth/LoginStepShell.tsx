"use client";

import { BackButton } from "./BackButton";
import { AnimatePresence, motion } from "motion/react";
import { EASE_LUXE } from "@/lib/motion";
import { useEntranceAnimatable } from "@/components/fx/use-entrance";

/**
 * Frame for LOGIN-flow steps (/login/phone, /login/phone/verify,
 * /auth/recovery) - AuthShell's geometry and slide transition without
 * the 5-step progress dots, which belong to the signup ladder only.
 * The (auth) layout still provides the chrome (dvh, safe areas, aurora,
 * glass card).
 *
 * The card is CONTENT-DRIVEN. An earlier iteration stretched this shell
 * to min-h-[62dvh] so steps could push their CTA down with mt-auto
 * ("near the thumb"); that design is deliberately REVERSED - it opened
 * a viewport-dependent gulf between the input and its button. Steps lay
 * out on AuthFormStack's fixed rhythm and the card grows with content.
 */
export function LoginStepShell({
  title,
  subtitle,
  backHref,
  backLabel = "Back",
  stepKey,
  children,
}: {
  title: string;
  subtitle?: React.ReactNode;
  /** Where the back arrow goes; omit it where backing out makes no sense. */
  backHref?: string;
  /** Accessible name AND visible text for the back link ("Change number"). */
  backLabel?: string;
  /** Change this to slide old content out and new in (in-page state swaps). */
  stepKey?: string;
  children: React.ReactNode;
}) {
  // Hard loads must paint the step fully visible - the entrance only
  // animates for post-hydration mounts (client navs, step swaps).
  const animatable = useEntranceAnimatable();
  return (
    <div>
      <div className="mb-8 flex items-center">
        {backHref ? (
          <BackButton href={backHref} label={backLabel} />
        ) : (
          <span aria-hidden="true" className="min-h-11" />
        )}
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
    </div>
  );
}
