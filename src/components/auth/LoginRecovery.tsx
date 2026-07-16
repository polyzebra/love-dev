"use client";

import { useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { ArrowRight, Loader2 } from "lucide-react";
import { motion } from "motion/react";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/shared/logo";
import { AuthCard } from "@/components/auth/AuthCard";
import { signOutEverywhere } from "@/components/auth/sign-out";
import { EASE_LUXE } from "@/lib/motion";
import { useEntranceAnimatable } from "@/components/fx/use-entrance";

/**
 * /login for an ALREADY-authenticated visitor. The front door must never
 * trap a partially onboarded account: instead of silently bouncing them
 * back into the setup ladder (the old behaviour that made the login
 * chooser unreachable), it offers a calm recovery screen -
 *
 *   - Continue setup / Continue to Tirvea  (the deliberate forward path)
 *   - Use a different account              (sign out -> the method chooser)
 *
 * "Use a different account" ends the current Supabase session and hard-
 * navigates to /login; with no session, resolveLoginView() then renders
 * the full method chooser, so email/Google/phone are always reachable.
 */
export function LoginRecovery({
  continueHref,
  setupComplete,
}: {
  /** Where "Continue" goes: the pending setup rung, or into the app. */
  continueHref: string;
  /** True once every setup rung is satisfied - only the CTA copy differs. */
  setupComplete: boolean;
}) {
  const [signingOut, setSigningOut] = useState(false);
  const animatable = useEntranceAnimatable();

  async function useAnotherAccount() {
    if (signingOut) return;
    setSigningOut(true);
    try {
      // Ends the Supabase session (clears the sb-* auth cookies) and hard-
      // navigates so all client state resets; /login then shows the chooser.
      await signOutEverywhere("/login");
    } catch {
      setSigningOut(false);
      toast.error("Couldn't sign out. Please try again.");
    }
  }

  return (
    <AuthCard>
      <motion.div
        data-debug="login-recovery"
        initial={animatable ? { y: 12 } : false}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: EASE_LUXE }}
        className="flex flex-col"
      >
        <div className="mb-9 flex flex-col items-center gap-5 text-center">
          <Logo size="lg" />
          <div className="space-y-2">
            <h1 className="font-display text-2xl font-semibold tracking-tight text-balance">
              {setupComplete ? "You're already signed in" : "Continue setting up your account"}
            </h1>
            <p className="text-muted-foreground text-sm text-pretty">
              {setupComplete
                ? "You can jump back into Tirvea, or switch to a different account."
                : "You're signed in but haven't finished setting up your account. Pick up where you left off, or switch to a different account."}
            </p>
          </div>
        </div>

        <div className="grid gap-3">
          <Button
            asChild
            className="min-h-[52px] w-full rounded-full text-[0.9375rem] font-medium active:scale-[0.98]"
            disabled={signingOut}
          >
            <Link href={continueHref}>
              <span className="inline-flex items-center justify-center gap-2">
                {setupComplete ? "Continue to Tirvea" : "Continue setup"}
                <ArrowRight className="size-4" aria-hidden="true" />
              </span>
            </Link>
          </Button>

          <Button
            type="button"
            variant="outline"
            className="relative min-h-[52px] w-full rounded-full text-[0.9375rem] font-medium active:scale-[0.98]"
            disabled={signingOut}
            onClick={useAnotherAccount}
          >
            <span className={signingOut ? "opacity-0" : "opacity-100"}>
              Use a different account
            </span>
            {signingOut && (
              <span
                className="absolute inset-0 flex items-center justify-center"
                aria-hidden="true"
              >
                <Loader2 className="size-4 animate-spin" />
              </span>
            )}
          </Button>
        </div>

        <p className="text-muted-foreground mt-6 text-center text-xs leading-relaxed">
          Using a different account signs you out here first. It never deletes your current account.
        </p>
      </motion.div>
    </AuthCard>
  );
}
