"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { InlineFieldError } from "@/components/ui/field-error";
import { AuthShell } from "@/components/auth/AuthShell";
import { AuthErrorBanner } from "@/components/auth/AuthErrorBanner";
import { AuthSubmitButton } from "@/components/auth/AuthSubmitButton";
import { sendEmailCode } from "@/components/auth/api";
import { supabaseBrowser } from "@/lib/supabase/client";

/**
 * Step 1 of 5 - "What's your email?". One field, one big CTA; Google
 * as the shortcut underneath. Validation runs on submit only. The
 * send endpoint is contractually neutral (200 whatever happens), so
 * success simply moves to the code screen.
 */

export const AUTH_EMAIL_KEY = "tirvea:auth-email";
/** Server retryAfter (seconds) for the send that opened the code screen. */
export const AUTH_EMAIL_RETRY_KEY = "tirvea:auth-email-retry";

/** Good-faith shape check - the emailed code is the real verification. */
function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value);
}

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" aria-hidden="true">
      <path fill="#4285F4" d="M23.5 12.3c0-.9-.1-1.8-.2-2.6H12v4.9h6.5a5.6 5.6 0 0 1-2.4 3.7v3h3.9c2.3-2.1 3.5-5.2 3.5-9Z" />
      <path fill="#34A853" d="M12 24c3.2 0 6-1.1 8-2.9l-3.9-3c-1.1.7-2.5 1.2-4.1 1.2-3.1 0-5.8-2.1-6.7-5H1.2v3.1A12 12 0 0 0 12 24Z" />
      <path fill="#FBBC05" d="M5.3 14.3a7.2 7.2 0 0 1 0-4.6V6.6H1.2a12 12 0 0 0 0 10.8l4.1-3.1Z" />
      <path fill="#EA4335" d="M12 4.8c1.8 0 3.3.6 4.6 1.8L20 3.2A12 12 0 0 0 1.2 6.6l4.1 3.1c.9-2.9 3.6-4.9 6.7-4.9Z" />
    </svg>
  );
}

export function EmailInputStep() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [pending, setPending] = useState<"email" | "google" | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    const value = email.trim().toLowerCase();
    if (!looksLikeEmail(value)) {
      setFieldError("Enter a valid email address.");
      return;
    }
    setFieldError(null);
    setServerError(null);
    setPending("email");
    const result = await sendEmailCode(value);
    setPending(null);
    if (!result.ok) {
      setServerError(result.message);
      return;
    }
    try {
      sessionStorage.setItem(AUTH_EMAIL_KEY, value);
      if (result.retryAfter) {
        sessionStorage.setItem(AUTH_EMAIL_RETRY_KEY, String(result.retryAfter));
      }
    } catch {
      // Query param below is the primary carrier anyway.
    }
    router.push(`/auth/email-code?email=${encodeURIComponent(value)}`);
  }

  // The existing login OAuth flow, verbatim (see oauth-buttons.tsx):
  // Supabase browser client + prompt=select_account so switching
  // accounts is always explicit. New signups land in /onboarding.
  async function continueWithGoogle() {
    if (pending) return;
    setServerError(null);
    setPending("google");
    const { error } = await supabaseBrowser().auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent("/onboarding")}`,
        queryParams: { prompt: "select_account" },
      },
    });
    if (error) {
      setPending(null);
      setServerError("Couldn't start Google sign-in. Please try again.");
    }
  }

  return (
    <AuthShell
      step={1}
      title="What's your email?"
      subtitle="We'll email you a 6-digit code. No passwords to remember."
    >
      <form onSubmit={onSubmit} className="flex flex-1 flex-col" noValidate>
        <div className="space-y-2">
          <Label htmlFor="auth-email">Email</Label>
          <Input
            id="auth-email"
            name="email"
            type="email"
            inputMode="email"
            autoComplete="email"
            autoFocus
            placeholder="you@example.com"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              if (fieldError) setFieldError(null);
            }}
            disabled={pending !== null}
            aria-invalid={fieldError ? true : undefined}
            aria-describedby={fieldError ? "auth-email-error" : undefined}
            className="h-12"
          />
          <InlineFieldError id="auth-email-error" message={fieldError} />
        </div>

        <AuthErrorBanner message={serverError} className="mt-4" />

        <div className="mt-auto space-y-4 pt-8">
          <AuthSubmitButton
            pending={pending === "email"}
            disabled={pending !== null}
          >
            Continue
          </AuthSubmitButton>

          <div className="relative" role="separator" aria-label="or">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t" />
            </div>
            <div className="relative flex justify-center">
              <span className="rounded-full bg-card px-3 text-xs tracking-wider text-muted-foreground uppercase">
                or
              </span>
            </div>
          </div>

          <Button
            type="button"
            variant="outline"
            size="lg"
            className="h-12 w-full rounded-full"
            disabled={pending !== null}
            onClick={continueWithGoogle}
          >
            {pending === "google" ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <GoogleIcon />
            )}
            Continue with Google
          </Button>

          <p className="text-center text-xs text-muted-foreground">
            We only use your email to sign you in - never to spam you.
          </p>
        </div>
      </form>
    </AuthShell>
  );
}
