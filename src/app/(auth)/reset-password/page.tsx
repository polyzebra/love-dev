"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabaseBrowser } from "@/lib/supabase/client";

/**
 * Arrived via the Supabase recovery link (/auth/callback exchanged the
 * code, so a recovery session is active). Setting the new password
 * happens directly against Supabase Auth.
 */
export default function ResetPasswordPage() {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const password = String(form.get("password"));
    if (password !== String(form.get("confirm"))) {
      toast.error("Passwords don't match.");
      return;
    }
    setSubmitting(true);
    const { error } = await supabaseBrowser().auth.updateUser({ password });
    setSubmitting(false);
    if (error) {
      toast.error(
        "Couldn't update the password. The reset link may have expired - request a new one.",
      );
      return;
    }
    toast.success("Password updated.");
    router.push("/discover");
  }

  return (
    <div className="space-y-8">
      <div className="space-y-2 text-center">
        <h1 className="font-display text-3xl font-semibold tracking-tight">Set a new password</h1>
        <p className="text-muted-foreground">Choose something long - a passphrase works great.</p>
      </div>
      <form onSubmit={onSubmit} className="space-y-5" noValidate>
        <div className="space-y-2">
          <Label htmlFor="password">New password</Label>
          <Input id="password" name="password" type="password" autoComplete="new-password" required minLength={10} placeholder="10+ characters" className="h-12 rounded-2xl" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="confirm">Confirm password</Label>
          <Input id="confirm" name="confirm" type="password" autoComplete="new-password" required minLength={10} placeholder="Repeat your new password" className="h-12 rounded-2xl" />
        </div>
        <Button type="submit" size="lg" className="h-12 w-full rounded-full" disabled={submitting}>
          {submitting ? <Loader2 className="size-4 animate-spin" /> : null}
          Update password
        </Button>
      </form>
    </div>
  );
}
