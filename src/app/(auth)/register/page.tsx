"use client";

import { useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { CheckCircle2, Eye, EyeOff, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { OAuthButtons } from "@/components/auth/oauth-buttons";
import { supabaseBrowser } from "@/lib/supabase/client";

export default function RegisterPage() {
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setSubmitting(true);
    setFieldErrors({});

    // Supabase Auth owns registration: the user is created in
    // auth.users and Supabase sends the confirmation email.
    const { error } = await supabaseBrowser().auth.signUp({
      email: String(form.get("email")),
      password: String(form.get("password")),
      options: {
        data: {
          full_name: String(form.get("name")),
          marketing_opt_in: form.get("marketing") === "on",
        },
        emailRedirectTo: `${window.location.origin}/auth/callback?next=/onboarding`,
      },
    });
    setSubmitting(false);

    if (error) {
      setFieldErrors({});
      toast.error(error.message);
      return;
    }
    setDone(true);
  }

  if (done) {
    return (
      <div className="space-y-4 text-center">
        <CheckCircle2 className="mx-auto size-12 text-success" aria-hidden="true" />
        <h1 className="font-display text-3xl font-semibold tracking-tight">Check your inbox</h1>
        <p className="mx-auto max-w-sm leading-relaxed text-muted-foreground">
          We sent a confirmation link to your email. Click it, then sign in to build your profile.
        </p>
        <Button size="lg" className="rounded-full" asChild>
          <Link href="/login">Go to sign in</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="space-y-2 text-center">
        <h1 className="font-display text-3xl font-semibold tracking-tight">Create your account</h1>
        <p className="text-muted-foreground">Verified profiles. Real intentions. No ads.</p>
      </div>

      <OAuthButtons />

      <form onSubmit={onSubmit} className="space-y-5" noValidate>
        <div className="space-y-2">
          <Label htmlFor="name">First name</Label>
          <Input
            id="name"
            name="name"
            autoComplete="given-name"
            required
            minLength={2}
            placeholder="What should we call you?"
            className="h-12 rounded-2xl"
            aria-invalid={!!fieldErrors.name}
          />
          {fieldErrors.name?.[0] && (
            <p role="alert" className="text-sm text-destructive">{fieldErrors.name[0]}</p>
          )}
        </div>
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
            aria-invalid={!!fieldErrors.email}
          />
          {fieldErrors.email?.[0] && (
            <p role="alert" className="text-sm text-destructive">{fieldErrors.email[0]}</p>
          )}
        </div>
        <div className="space-y-2">
          <Label htmlFor="password">Password</Label>
          <div className="relative">
            <Input
              id="password"
              name="password"
              type={showPassword ? "text" : "password"}
              autoComplete="new-password"
              required
              minLength={10}
              placeholder="10+ characters"
              className="h-12 rounded-2xl pr-12"
              aria-invalid={!!fieldErrors.password}
              aria-describedby="password-hint"
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              aria-label={showPassword ? "Hide password" : "Show password"}
              className="tap-target absolute inset-y-0 right-0 flex items-center px-4 text-muted-foreground hover:text-foreground"
            >
              {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          </div>
          <p id="password-hint" className="text-xs text-muted-foreground">
            At least 10 characters. A passphrase works great.
          </p>
          {fieldErrors.password?.[0] && (
            <p role="alert" className="text-sm text-destructive">{fieldErrors.password[0]}</p>
          )}
        </div>
        <div className="flex items-start gap-2">
          <Checkbox id="marketing" name="marketing" className="mt-0.5" />
          <Label htmlFor="marketing" className="text-sm font-normal leading-snug text-muted-foreground">
            Send me dating tips and product updates (optional)
          </Label>
        </div>
        <Button type="submit" size="lg" className="h-12 w-full rounded-full" disabled={submitting}>
          {submitting ? <Loader2 className="size-4 animate-spin" /> : null}
          Create account
        </Button>
      </form>

      <p className="text-center text-sm text-muted-foreground">
        Already a member?{" "}
        <Link href="/login" className="font-medium text-primary-soft underline-offset-2 hover:underline">
          Sign in
        </Link>
      </p>
    </div>
  );
}
