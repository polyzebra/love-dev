"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, Loader2, Mail, ShieldCheck, Smartphone } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { SettingsNote } from "@/components/settings/settings-note";
import { supabaseBrowser } from "@/lib/supabase/client";
import { authRedirectUrl } from "@/lib/auth/url";

/**
 * Settings > Sign-in methods. Every row is server-derived state passed
 * down as props - this component never guesses. Manual identity linking
 * (Supabase linkIdentity/unlinkIdentity) needs the dashboard's "Allow
 * manual linking" toggle, which is OFF today, so the link/unlink actions
 * sit behind NEXT_PUBLIC_MANUAL_LINKING_ENABLED (default off) and the UI
 * names that dependency in a footnote instead of showing dead buttons.
 * Guard: unlinking is disabled whenever only one identity remains - an
 * account must never end up with zero ways to sign in.
 */

const MANUAL_LINKING_ENABLED =
  process.env.NEXT_PUBLIC_MANUAL_LINKING_ENABLED === "true" ||
  process.env.NEXT_PUBLIC_MANUAL_LINKING_ENABLED === "1";

type OAuthProvider = "google" | "apple";

export type SignInMethodsProps = {
  email: string;
  /** All providers linked to the auth user, e.g. ["email", "google"]. */
  linkedProviders: string[];
  /** Apple row is hidden until Apple sign-in ships (NEXT_PUBLIC_APPLE_LOGIN_ENABLED). */
  appleVisible: boolean;
  phone: {
    /** Masked display number, e.g. "+353 ••• ••• 333" - null when no verified phone. */
    masked: string | null;
    verified: boolean;
    /** PHONE_LOGIN_ENABLED (server env) - phone OTP login is live. */
    loginEnabled: boolean;
  };
};

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-5" aria-hidden="true">
      <path fill="#4285F4" d="M23.5 12.3c0-.9-.1-1.8-.2-2.6H12v4.9h6.5a5.6 5.6 0 0 1-2.4 3.7v3h3.9c2.3-2.1 3.5-5.2 3.5-9Z" />
      <path fill="#34A853" d="M12 24c3.2 0 6-1.1 8-2.9l-3.9-3c-1.1.7-2.5 1.2-4.1 1.2-3.1 0-5.8-2.1-6.7-5H1.2v3.1A12 12 0 0 0 12 24Z" />
      <path fill="#FBBC05" d="M5.3 14.3a7.2 7.2 0 0 1 0-4.6V6.6H1.2a12 12 0 0 0 0 10.8l4.1-3.1Z" />
      <path fill="#EA4335" d="M12 4.8c1.8 0 3.3.6 4.6 1.8L20 3.2A12 12 0 0 0 1.2 6.6l4.1 3.1c.9-2.9 3.6-4.9 6.7-4.9Z" />
    </svg>
  );
}

function AppleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-5 fill-current" aria-hidden="true">
      <path d="M17.05 20.28c-.98.95-2.05.86-3.08.38-1.09-.5-2.08-.48-3.24 0-1.44.62-2.2.44-3.06-.38C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.53 4.08ZM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25Z" />
    </svg>
  );
}

function ActiveState({ label = "Active" }: { label?: string }) {
  return (
    <span className="flex shrink-0 items-center gap-1.5 text-sm font-medium text-success">
      <Check className="size-4" aria-hidden="true" />
      {label}
    </span>
  );
}

function QuietState({ label }: { label: string }) {
  return <span className="shrink-0 text-sm text-muted-foreground">{label}</span>;
}

const PROVIDER_LABEL: Record<OAuthProvider, string> = { google: "Google", apple: "Apple" };

/** Fire-and-forget audit trail - a failed audit call never blocks the user action. */
function recordIdentityEvent(action: "link_started" | "unlink", provider: string) {
  void fetch("/api/auth/identity-event", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, provider }),
  }).catch(() => {});
}

export function SignInMethods({ email, linkedProviders, appleVisible, phone }: SignInMethodsProps) {
  const router = useRouter();
  const [busy, setBusy] = useState<OAuthProvider | null>(null);
  const [unlinkTarget, setUnlinkTarget] = useState<OAuthProvider | null>(null);

  const emailLinked = linkedProviders.includes("email");
  const onlyOneMethod = linkedProviders.length <= 1;

  async function startLink(provider: OAuthProvider) {
    setBusy(provider);
    recordIdentityEvent("link_started", provider);
    const { error } = await supabaseBrowser().auth.linkIdentity({
      provider,
      options: {
        redirectTo: `${authRedirectUrl("/auth/callback")}?next=${encodeURIComponent("/settings/sign-in-methods")}`,
      },
    });
    if (error) {
      setBusy(null);
      toast.error("Couldn't start linking. Please try again.");
    }
  }

  async function confirmUnlink(provider: OAuthProvider) {
    setBusy(provider);
    try {
      const supabase = supabaseBrowser();
      const { data, error } = await supabase.auth.getUserIdentities();
      const identity = data?.identities.find((i) => i.provider === provider);
      if (error || !identity) throw error ?? new Error(`no ${provider} identity`);
      const { error: unlinkError } = await supabase.auth.unlinkIdentity(identity);
      if (unlinkError) throw unlinkError;
      recordIdentityEvent("unlink", provider);
      toast.success(`${PROVIDER_LABEL[provider]} unlinked from your account.`);
      router.refresh();
    } catch {
      toast.error("Couldn't unlink right now. Please try again.");
    } finally {
      setBusy(null);
      setUnlinkTarget(null);
    }
  }

  /** Right-side actions for an OAuth row - only rendered when manual linking is on. */
  function oauthActions(provider: OAuthProvider, linked: boolean) {
    if (!MANUAL_LINKING_ENABLED) return null;
    if (!linked) {
      return (
        <Button
          type="button"
          variant="outline"
          className="h-11 shrink-0 rounded-full px-4"
          disabled={busy !== null}
          onClick={() => startLink(provider)}
        >
          {busy === provider ? (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          ) : null}
          Link {PROVIDER_LABEL[provider]}
        </Button>
      );
    }
    const unlinkButton = (
      <Button
        type="button"
        variant="outline"
        className="h-11 shrink-0 rounded-full px-4"
        disabled={onlyOneMethod || busy !== null}
        onClick={() => setUnlinkTarget(provider)}
      >
        Unlink
      </Button>
    );
    if (!onlyOneMethod) return unlinkButton;
    return (
      <Tooltip>
        {/* span wrapper so the tooltip still opens over the disabled button */}
        <TooltipTrigger asChild>
          <span tabIndex={0} className="shrink-0 rounded-full focus-visible:outline-none">
            {unlinkButton}
          </span>
        </TooltipTrigger>
        <TooltipContent>You need at least one way to sign in</TooltipContent>
      </Tooltip>
    );
  }

  return (
    <>
      <section aria-label="Sign-in methods" className="glass overflow-hidden rounded-3xl">
        {/* Email */}
        <div className="flex min-h-14 items-center gap-4 px-5 py-4">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-accent">
            <Mail className="size-5 text-accent-foreground" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="font-medium">Email</span>
              <Badge variant="secondary" className="rounded-full text-xs font-normal">
                Sign-in code
              </Badge>
            </div>
            <p className="truncate text-sm text-muted-foreground">{email}</p>
          </div>
          {emailLinked ? <ActiveState /> : <QuietState label="Not linked" />}
        </div>

        {/* Google */}
        <div className="flex min-h-14 items-center gap-4 border-t border-border px-5 py-4">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-accent">
            <GoogleIcon />
          </span>
          <div className="min-w-0 flex-1">
            <span className="block font-medium">Google</span>
            <p className="truncate text-sm text-muted-foreground">
              Use your Google account to sign in.
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            {linkedProviders.includes("google") ? <ActiveState /> : <QuietState label="Not linked" />}
            {oauthActions("google", linkedProviders.includes("google"))}
          </div>
        </div>

        {/* Apple - hidden until Apple sign-in ships */}
        {appleVisible && (
          <div className="flex min-h-14 items-center gap-4 border-t border-border px-5 py-4">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-accent">
              <span className="text-accent-foreground">
                <AppleIcon />
              </span>
            </span>
            <div className="min-w-0 flex-1">
              <span className="block font-medium">Apple</span>
              <p className="truncate text-sm text-muted-foreground">
                Use your Apple ID to sign in.
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-3">
              {linkedProviders.includes("apple") ? <ActiveState /> : <QuietState label="Not linked" />}
              {oauthActions("apple", linkedProviders.includes("apple"))}
            </div>
          </div>
        )}

        {/* Phone */}
        <div className="flex min-h-14 items-center gap-4 border-t border-border px-5 py-4">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-accent">
            <Smartphone className="size-5 text-accent-foreground" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <span className="block font-medium">Phone</span>
            {phone.verified && phone.masked ? (
              <>
                <p className="truncate text-sm text-muted-foreground">{phone.masked}</p>
                {!phone.loginEnabled && (
                  <p className="text-xs text-muted-foreground/80">
                    Verified for your account - phone sign-in coming soon
                  </p>
                )}
              </>
            ) : (
              <p className="truncate text-sm text-muted-foreground">
                Add a number to verify your account.
              </p>
            )}
          </div>
          {phone.verified && phone.masked ? (
            phone.loginEnabled ? (
              <ActiveState label="Active for sign-in" />
            ) : (
              <span className="flex shrink-0 items-center gap-1.5 text-sm text-muted-foreground">
                <Check className="size-4" aria-hidden="true" />
                Verified
              </span>
            )
          ) : (
            <Button asChild variant="outline" className="h-11 shrink-0 rounded-full px-4">
              <Link href="/auth/phone">Add phone</Link>
            </Button>
          )}
        </div>
      </section>

      {!MANUAL_LINKING_ENABLED && (
        <SettingsNote>
          Linking another provider requires manual-linking to be enabled for this project.
        </SettingsNote>
      )}

      {/* Security note - honest about the invariants this page enforces */}
      <section aria-label="Security note" className="glass mt-6 flex items-center gap-4 rounded-3xl px-5 py-4">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-accent">
          <ShieldCheck className="size-5 text-accent-foreground" aria-hidden="true" />
        </span>
        <p className="text-sm text-muted-foreground">
          We&apos;ll never remove your last sign-in method. Changes here are recorded.
        </p>
      </section>

      {/* Unlink confirmation - removing a sign-in path is real danger territory */}
      <Dialog open={unlinkTarget !== null} onOpenChange={(open) => !open && setUnlinkTarget(null)}>
        <DialogContent className="rounded-3xl">
          <DialogHeader>
            <DialogTitle>
              Unlink {unlinkTarget ? PROVIDER_LABEL[unlinkTarget] : ""}?
            </DialogTitle>
            <DialogDescription>
              You&apos;ll no longer be able to sign in to Tirvea with{" "}
              {unlinkTarget ? PROVIDER_LABEL[unlinkTarget] : "this method"}. Your other sign-in
              methods keep working.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              className="h-11 rounded-full px-5"
              onClick={() => setUnlinkTarget(null)}
              disabled={busy !== null}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              className="h-11 rounded-full px-5"
              disabled={busy !== null}
              onClick={() => unlinkTarget && confirmUnlink(unlinkTarget)}
            >
              {busy !== null ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
              Unlink
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
