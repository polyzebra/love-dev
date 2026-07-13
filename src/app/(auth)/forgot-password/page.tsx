"use client";

import { useState } from "react";
import Link from "next/link";
import { Loader2, MailCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { InlineFieldError } from "@/components/ui/field-error";
import { supabaseBrowser } from "@/lib/supabase/client";
import { authRedirectUrl } from "@/lib/auth/url";
import { AuthCard } from "@/components/auth/AuthCard";

/** Same good-faith shape check as the email sign-in step. */
function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value);
}

export default function ForgotPasswordPage() {
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [fieldError, setFieldError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submitting) return;
    const form = new FormData(e.currentTarget);
    const email = String(form.get("email")).trim().toLowerCase();
    if (!looksLikeEmail(email)) {
      setFieldError("Enter a valid email address.");
      return;
    }
    setFieldError(null);
    setSubmitting(true);
    await supabaseBrowser().auth.resetPasswordForEmail(email, {
      redirectTo: `${authRedirectUrl("/auth/callback")}?next=/reset-password`,
    });
    setSubmitting(false);
    setSent(true);
  }

  if (sent) {
    return (
      <AuthCard>
        <div className="space-y-4 text-center">
          <MailCheck className="text-success mx-auto size-12" aria-hidden="true" />
          <h1 className="font-display text-3xl font-semibold tracking-tight">Check your inbox</h1>
          <p className="text-muted-foreground mx-auto max-w-sm leading-relaxed">
            If that email is registered, a reset link is on its way. It expires in 30 minutes.
          </p>
          <Button variant="outline" className="h-12 rounded-full px-6" asChild>
            <Link href="/login">Back to sign in</Link>
          </Button>
        </div>
      </AuthCard>
    );
  }

  return (
    <AuthCard>
      <div className="space-y-8">
        <div className="space-y-2 text-center">
          <h1 className="font-display text-3xl font-semibold tracking-tight">
            Reset your password
          </h1>
          <p className="text-muted-foreground">
            Enter your email and we&apos;ll send you a secure reset link.
          </p>
        </div>
        <form onSubmit={onSubmit} className="space-y-5" noValidate>
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              inputMode="email"
              required
              placeholder="you@example.com"
              onChange={() => {
                if (fieldError) setFieldError(null);
              }}
              aria-invalid={fieldError ? true : undefined}
              aria-describedby={fieldError ? "email-error" : undefined}
              className="h-12"
            />
            <InlineFieldError id="email-error" message={fieldError} />
          </div>
          <Button
            type="submit"
            size="lg"
            className="h-12 w-full rounded-full"
            disabled={submitting}
          >
            {submitting ? <Loader2 className="size-4 animate-spin" /> : null}
            Send reset link
          </Button>
        </form>
        <p className="text-muted-foreground text-center text-sm">
          Remembered it?{" "}
          <Link
            href="/login"
            className="text-primary-soft font-medium underline-offset-2 hover:underline"
          >
            Sign in
          </Link>
        </p>
      </div>
    </AuthCard>
  );
}
