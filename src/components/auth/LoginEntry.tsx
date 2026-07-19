"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Loader2, Mail, Smartphone } from "lucide-react";
import { motion } from "motion/react";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/shared/logo";
import { AuthCard } from "@/components/auth/AuthCard";
import { EASE_LUXE } from "@/lib/motion";
import { useEntranceAnimatable } from "@/components/fx/use-entrance";
import { appleLoginEnabled } from "@/lib/auth/apple";
import { supabaseBrowser } from "@/lib/supabase/client";
import { authRedirectUrl } from "@/lib/auth/url";

/**
 * /login - the front door. One calm column of full-width providers:
 * Apple (feature-flagged), Google (prompt=select_account so switching
 * accounts is always explicit), Email (-> the /login/email OTP flow) and phone
 * (server-rendered availability - the page omits it when
 * PHONE_LOGIN_ENABLED is off; never a dead button).
 *
 * Only the provider whose action is running gets disabled + a spinner
 * (crossfade over the label - both layers stay mounted, the button never
 * changes size); the others stay visually idle but clicks no-op while
 * an OAuth redirect is in flight.
 */

export function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-5" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M23.5 12.3c0-.9-.1-1.8-.2-2.6H12v4.9h6.5a5.6 5.6 0 0 1-2.4 3.7v3h3.9c2.3-2.1 3.5-5.2 3.5-9Z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.2 0 6-1.1 8-2.9l-3.9-3c-1.1.7-2.5 1.2-4.1 1.2-3.1 0-5.8-2.1-6.7-5H1.2v3.1A12 12 0 0 0 12 24Z"
      />
      <path fill="#FBBC05" d="M5.3 14.3a7.2 7.2 0 0 1 0-4.6V6.6H1.2a12 12 0 0 0 0 10.8l4.1-3.1Z" />
      <path
        fill="#EA4335"
        d="M12 4.8c1.8 0 3.3.6 4.6 1.8L20 3.2A12 12 0 0 0 1.2 6.6l4.1 3.1c.9-2.9 3.6-4.9 6.7-4.9Z"
      />
    </svg>
  );
}

export function AppleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-5 fill-current" aria-hidden="true">
      <path d="M17.05 20.28c-.98.95-2.05.86-3.08.38-1.09-.5-2.08-.48-3.24 0-1.44.62-2.2.44-3.06-.38C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.53 4.08ZM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25Z" />
    </svg>
  );
}

/**
 * Bounded recovery for a launch that never navigates. OAuth normally
 * redirects the tab in well under a second; this is only the backstop that
 * guarantees the button can never spin forever.
 */
const OAUTH_LAUNCH_TIMEOUT_MS = 8000;

/** Shared face for every entry row - link or action, same geometry. */
const ENTRY_BUTTON_CLASS =
  "min-h-[52px] w-full rounded-full text-[0.9375rem] font-medium active:scale-[0.98]";

/** OAuth row: spinner crossfades over the label, size never changes. */
function ProviderActionButton({
  pending,
  onClick,
  icon,
  children,
}: {
  pending: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Button
      type="button"
      variant="outline"
      className={`relative ${ENTRY_BUTTON_CLASS}`}
      disabled={pending}
      onClick={onClick}
    >
      <motion.span
        initial={false}
        animate={{ opacity: pending ? 0 : 1 }}
        transition={{ duration: 0.18, ease: EASE_LUXE }}
        className="inline-flex items-center justify-center gap-2.5"
      >
        {icon}
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

/** Navigation row: same face as the OAuth buttons, but a plain link. */
function ProviderLink({
  href,
  icon,
  children,
}: {
  href: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Button asChild variant="outline" className={ENTRY_BUTTON_CLASS}>
      <Link href={href}>
        <span className="inline-flex items-center justify-center gap-2.5">
          {icon}
          {children}
        </span>
      </Link>
    </Button>
  );
}

/** Clean copy for callback redirect errors (?error=...) - never raw codes. */
const CALLBACK_ERROR_MESSAGES: Record<string, string> = {
  OAuthCallbackError: "The sign-in with your provider didn't complete. Please try again.",
  LinkExpired: "That sign-in link has expired or was already used. Request a fresh one.",
  SessionRequired: "Please sign in to continue.",
  AccountBlocked:
    "This account can no longer be used. Contact support if you believe this is a mistake.",
  AccountConflict: "This email is attached to another account. Contact support to resolve it.",
};

export function LoginEntry({
  phoneEnabled,
  callbackUrl = "/discover",
  errorCode,
}: {
  /** Server-rendered PHONE_LOGIN_ENABLED - off means the row is OMITTED. */
  phoneEnabled: boolean;
  callbackUrl?: string;
  /** ?error=... from /auth/callback redirects, resolved by the server page. */
  errorCode?: string;
}) {
  // `pending` is ONLY the "this provider's OAuth launch is in flight" state -
  // it starts null on every mount, spins just the tapped button, and is a
  // transient launch flag, never a persisted or availability signal. The
  // buttons themselves render from server/build-known config (props + the
  // NEXT_PUBLIC apple flag), so a provider never disappears behind a check.
  const [pending, setPending] = useState<"google" | "apple" | null>(null);
  const appleEnabled = appleLoginEnabled();
  // Hard loads must paint the card fully visible - the entrance only
  // animates for post-hydration mounts (client-side navigations).
  const animatable = useEntranceAnimatable();
  // The bounded launch-recovery timer (see startOAuth); cleared on unmount.
  const launchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!errorCode) return;
    toast.error(CALLBACK_ERROR_MESSAGES[errorCode] ?? "Sign-in failed. Please try again.");
  }, [errorCode]);

  // Self-healing launch state. signInWithOAuth navigates the WHOLE tab away;
  // if the user comes back without completing (canceled the Google screen,
  // browser Back, or iOS Safari restoring this page from the BFCache), the
  // document can be resurrected with `pending` frozen true - the stuck
  // spinner that only a manual refresh cleared. Reset it on every "the user
  // is looking at this page again" signal so the button recovers on its own.
  useEffect(() => {
    const clearPending = () => {
      if (launchTimer.current) {
        clearTimeout(launchTimer.current);
        launchTimer.current = null;
      }
      setPending(null);
    };
    // pageshow.persisted === true is the definitive BFCache-restore signal.
    const onPageShow = (e: PageTransitionEvent) => {
      if (e.persisted) clearPending();
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") clearPending();
    };
    window.addEventListener("pageshow", onPageShow);
    window.addEventListener("focus", clearPending);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("pageshow", onPageShow);
      window.removeEventListener("focus", clearPending);
      document.removeEventListener("visibilitychange", onVisible);
      if (launchTimer.current) clearTimeout(launchTimer.current);
    };
  }, []);

  // Supabase browser client OAuth; prompt=select_account forces the
  // account chooser so switching accounts is always explicit.
  async function startOAuth(provider: "google" | "apple") {
    if (pending) return;
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
      // Plain language for the visitor; the env-var detail belongs in
      // the console, not the UI.
      console.error(
        "Sign-in is not configured: set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY (see .env.example).",
      );
      toast.error("Sign-in isn't available right now. Please try again later.");
      return;
    }
    setPending(provider);
    // Safety net: signInWithOAuth should redirect the tab within a moment.
    // If it hasn't (call hung, redirect swallowed, blocked), un-stick the
    // button so the launch state can never be permanent even if the
    // visibility handlers above never fire.
    if (launchTimer.current) clearTimeout(launchTimer.current);
    launchTimer.current = setTimeout(() => {
      launchTimer.current = null;
      setPending(null);
    }, OAUTH_LAUNCH_TIMEOUT_MS);

    const { error } = await (
      await supabaseBrowser()
    ).auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: `${authRedirectUrl("/auth/callback")}?next=${encodeURIComponent(callbackUrl)}`,
        queryParams: provider === "google" ? { prompt: "select_account" } : undefined,
      },
    });
    if (error) {
      if (launchTimer.current) {
        clearTimeout(launchTimer.current);
        launchTimer.current = null;
      }
      setPending(null);
      toast.error(
        `${provider === "google" ? "Google" : "Apple"} sign-in is temporarily unavailable. Try again.`,
      );
    }
  }

  return (
    <AuthCard>
      <motion.div
        data-debug="login-page"
        // Slide-and-settle ONLY - never opacity: the sign-in choices must
        // be readable from the very first committed frame (a fade from 0
        // re-blanks the card right after the loading fallback unmounts).
        initial={animatable ? { y: 12 } : false}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: EASE_LUXE }}
        className="flex flex-col"
      >
        <div className="mb-9 flex flex-col items-center gap-5 text-center">
          <Logo size="lg" />
          <div className="space-y-2">
            <h1 className="font-display text-3xl font-semibold tracking-tight text-balance">
              Find something real.
            </h1>
            <p className="text-muted-foreground text-sm">Sign in or create your Tirvea account.</p>
          </div>
        </div>

        <div data-debug="login-form" className="grid gap-3">
          {appleEnabled && (
            <ProviderActionButton
              pending={pending === "apple"}
              onClick={() => startOAuth("apple")}
              icon={<AppleIcon />}
            >
              Continue with Apple
            </ProviderActionButton>
          )}
          <ProviderActionButton
            pending={pending === "google"}
            onClick={() => startOAuth("google")}
            icon={<GoogleIcon />}
          >
            Continue with Google
          </ProviderActionButton>
          <ProviderLink href="/login/email" icon={<Mail className="size-5" aria-hidden="true" />}>
            Continue with Email
          </ProviderLink>
          {phoneEnabled && (
            <ProviderLink
              href="/login/phone"
              icon={<Smartphone className="size-5" aria-hidden="true" />}
            >
              Continue with phone number
            </ProviderLink>
          )}
        </div>

        <p className="mt-6 text-center">
          <Link
            href="/auth/recovery"
            className="text-primary-soft focus-visible:ring-foreground/20 rounded-sm text-sm font-medium underline-offset-2 outline-none hover:underline focus-visible:ring-2"
          >
            Trouble signing in?
          </Link>
        </p>

        <p className="text-muted-foreground mt-8 text-center text-xs leading-relaxed text-pretty">
          By continuing, you agree to our{" "}
          <Link href="/legal/terms" className="hover:text-foreground underline underline-offset-2">
            Terms of Use
          </Link>{" "}
          and acknowledge our{" "}
          <Link
            href="/legal/privacy"
            className="hover:text-foreground underline underline-offset-2"
          >
            Privacy Policy
          </Link>{" "}
          and{" "}
          <Link
            href="/legal/cookies"
            className="hover:text-foreground underline underline-offset-2"
          >
            Cookie Policy
          </Link>
          .
        </p>
      </motion.div>
    </AuthCard>
  );
}
