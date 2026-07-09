"use client";

import { useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Loader2, MailCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabaseBrowser } from "@/lib/supabase/client";
import { authRedirectUrl } from "@/lib/auth/url";

export default function ForgotPasswordPage() {
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setSubmitting(true);
    await supabaseBrowser().auth.resetPasswordForEmail(String(form.get("email")), {
      redirectTo: `${authRedirectUrl("/auth/callback")}?next=/reset-password`,
    });
    setSubmitting(false);
    setSent(true);
  }

  if (sent) {
    return (
      <div className="space-y-4 text-center">
        <MailCheck className="mx-auto size-12 text-success" aria-hidden="true" />
        <h1 className="font-display text-3xl font-semibold tracking-tight">Check your inbox</h1>
        <p className="mx-auto max-w-sm leading-relaxed text-muted-foreground">
          If that email is registered, a reset link is on its way. It expires in 30 minutes.
        </p>
        <Button variant="outline" className="rounded-full" asChild>
          <Link href="/login">Back to sign in</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="space-y-2 text-center">
        <h1 className="font-display text-3xl font-semibold tracking-tight">Reset your password</h1>
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
            className="h-12 rounded-2xl"
          />
        </div>
        <Button type="submit" size="lg" className="h-12 w-full rounded-full" disabled={submitting}>
          {submitting ? <Loader2 className="size-4 animate-spin" /> : null}
          Send reset link
        </Button>
      </form>
      <p className="text-center text-sm text-muted-foreground">
        Remembered it?{" "}
        <Link href="/login" className="font-medium text-primary-soft underline-offset-2 hover:underline">
          Sign in
        </Link>
      </p>
    </div>
  );
}
