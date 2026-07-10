"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { InlineFieldError } from "@/components/ui/field-error";
import { AuthShell } from "@/components/auth/AuthShell";
import { AuthFormStack } from "@/components/auth/AuthFormStack";
import { AuthErrorBanner } from "@/components/auth/AuthErrorBanner";
import { AuthSubmitButton } from "@/components/auth/AuthSubmitButton";
import { sendEmailCode } from "@/components/auth/api";

/**
 * Step 1 of 5 - "What's your email?". Purely the email step: one field,
 * one big CTA, back arrow to /login. Provider buttons (Google/Apple/
 * phone) live ONLY on /login (LoginEntry) - never duplicated here.
 * Validation runs on submit only. The send endpoint is contractually
 * neutral (200 whatever happens), so success simply moves to the code
 * screen.
 */

export const AUTH_EMAIL_KEY = "tirvea:auth-email";
/** Server retryAfter (seconds) for the send that opened the code screen. */
export const AUTH_EMAIL_RETRY_KEY = "tirvea:auth-email-retry";

/** Good-faith shape check - the emailed code is the real verification. */
function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value);
}

export function EmailInputStep() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

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
    setPending(true);
    const result = await sendEmailCode(value);
    setPending(false);
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
    router.push(`/login/email/verify?email=${encodeURIComponent(value)}`);
  }

  return (
    <AuthShell
      step={1}
      title="What's your email?"
      subtitle="We'll email you a 6-digit code. No passwords to remember."
      backHref="/login"
    >
      <AuthFormStack
        onSubmit={onSubmit}
        field={
          <>
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
              disabled={pending}
              aria-invalid={fieldError ? true : undefined}
              aria-describedby={fieldError ? "auth-email-error" : undefined}
              className="h-12"
            />
            <InlineFieldError id="auth-email-error" message={fieldError} />
          </>
        }
        status={<AuthErrorBanner message={serverError} />}
        cta={
          <AuthSubmitButton pending={pending} disabled={pending}>
            Continue
          </AuthSubmitButton>
        }
        footnote="We only use your email to sign you in - never to spam you."
      />
    </AuthShell>
  );
}
