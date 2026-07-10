"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { EASE_LUXE } from "@/lib/motion";

/**
 * Frame for LOGIN-flow steps (/login/phone, /login/phone/verify,
 * /auth/recovery) - AuthShell's geometry and slide transition without
 * the 5-step progress dots, which belong to the signup ladder only.
 * The (auth) layout still provides the chrome (dvh, safe areas, aurora,
 * glass card); steps put their CTA last with mt-auto so it stays near
 * the thumb and above the keyboard.
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
  return (
    <div className="flex min-h-[62dvh] flex-col sm:min-h-105">
      <div className="mb-8 flex items-center">
        {backHref ? (
          <Link
            href={backHref}
            className="tap-target -m-2 inline-flex min-h-9 items-center gap-1.5 rounded-full p-2 text-sm text-muted-foreground transition-colors outline-none hover:bg-foreground/5 hover:text-foreground focus-visible:ring-2 focus-visible:ring-foreground/20"
          >
            <ArrowLeft className="size-5" aria-hidden="true" />
            {backLabel !== "Back" && <span>{backLabel}</span>}
            {backLabel === "Back" && <span className="sr-only">Back</span>}
          </Link>
        ) : (
          <span aria-hidden="true" className="min-h-9" />
        )}
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
