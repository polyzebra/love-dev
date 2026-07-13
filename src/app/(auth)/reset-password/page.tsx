"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { InlineFieldError } from "@/components/ui/field-error";
import { AuthErrorBanner } from "@/components/auth/AuthErrorBanner";
import { supabaseBrowser } from "@/lib/supabase/client";
import { AuthCard } from "@/components/auth/AuthCard";

/**
 * Arrived via the Supabase recovery link (/auth/callback exchanged the
 * code, so a recovery session is active). Setting the new password
 * happens directly against Supabase Auth. Errors surface inline (field
 * error + banner), matching the rest of the auth flow - never as toasts
 * that can be missed.
 */
export default function ResetPasswordPage() {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submitting) return;
    const form = new FormData(e.currentTarget);
    const password = String(form.get("password"));
    if (password.length < 10) {
      setPasswordError("Use at least 10 characters.");
      return;
    }
    if (password !== String(form.get("confirm"))) {
      setConfirmError("Passwords don't match.");
      return;
    }
    setServerError(null);
    setSubmitting(true);
    const { error } = await supabaseBrowser().auth.updateUser({ password });
    setSubmitting(false);
    if (error) {
      setServerError(
        "Couldn't update the password. The reset link may have expired - request a new one.",
      );
      return;
    }
    toast.success("Password updated.");
    router.push("/discover");
  }

  return (
    <AuthCard>
    <div className="space-y-8">
      <div className="space-y-2 text-center">
        <h1 className="font-display text-3xl font-semibold tracking-tight">Set a new password</h1>
        <p className="text-muted-foreground">Choose something long - a passphrase works great.</p>
      </div>
      <form onSubmit={onSubmit} className="space-y-5" noValidate>
        <div className="space-y-2">
          <Label htmlFor="password">New password</Label>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="new-password"
            required
            minLength={10}
            placeholder="10+ characters"
            onChange={() => {
              if (passwordError) setPasswordError(null);
              if (serverError) setServerError(null);
            }}
            aria-invalid={passwordError ? true : undefined}
            aria-describedby={passwordError ? "password-error" : undefined}
            className="h-12"
          />
          <InlineFieldError id="password-error" message={passwordError} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="confirm">Confirm password</Label>
          <Input
            id="confirm"
            name="confirm"
            type="password"
            autoComplete="new-password"
            required
            minLength={10}
            placeholder="Repeat your new password"
            onChange={() => {
              if (confirmError) setConfirmError(null);
              if (serverError) setServerError(null);
            }}
            aria-invalid={confirmError ? true : undefined}
            aria-describedby={confirmError ? "confirm-error" : undefined}
            className="h-12"
          />
          <InlineFieldError id="confirm-error" message={confirmError} />
        </div>
        <AuthErrorBanner message={serverError} />
        <Button type="submit" size="lg" className="h-12 w-full rounded-full" disabled={submitting}>
          {submitting ? <Loader2 className="size-4 animate-spin" /> : null}
          Update password
        </Button>
      </form>
    </div>
    </AuthCard>
  );
}
