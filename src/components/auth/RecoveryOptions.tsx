"use client";

import { useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { ChevronRight, Loader2, Mail, MessageCircleMore } from "lucide-react";
import { LoginStepShell } from "@/components/auth/LoginStepShell";
import { supabaseBrowser } from "@/lib/supabase/client";
import { authRedirectUrl } from "@/lib/auth/url";

/**
 * /auth/recovery - "Trouble signing in?". A calm list of every way back
 * in; deliberately account-blind. It NEVER looks anything up and never
 * says which sign-in methods exist for any account - that answer would
 * tell a stranger things about someone else's account. The user picks a
 * door; the door itself decides.
 */

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-4.5" aria-hidden="true">
      <path fill="#4285F4" d="M23.5 12.3c0-.9-.1-1.8-.2-2.6H12v4.9h6.5a5.6 5.6 0 0 1-2.4 3.7v3h3.9c2.3-2.1 3.5-5.2 3.5-9Z" />
      <path fill="#34A853" d="M12 24c3.2 0 6-1.1 8-2.9l-3.9-3c-1.1.7-2.5 1.2-4.1 1.2-3.1 0-5.8-2.1-6.7-5H1.2v3.1A12 12 0 0 0 12 24Z" />
      <path fill="#FBBC05" d="M5.3 14.3a7.2 7.2 0 0 1 0-4.6V6.6H1.2a12 12 0 0 0 0 10.8l4.1-3.1Z" />
      <path fill="#EA4335" d="M12 4.8c1.8 0 3.3.6 4.6 1.8L20 3.2A12 12 0 0 0 1.2 6.6l4.1 3.1c.9-2.9 3.6-4.9 6.7-4.9Z" />
    </svg>
  );
}

const ROW_CLASS =
  "flex min-h-[52px] w-full items-center gap-3 rounded-2xl border border-border bg-foreground/5 px-4 py-3 text-left text-sm font-medium shadow-[inset_0_1px_0_var(--glass-highlight)] transition-[transform,background-color] outline-none hover:bg-foreground/10 focus-visible:ring-2 focus-visible:ring-foreground/20 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50";

function RowBody({
  icon,
  title,
  detail,
  trailing,
}: {
  icon: React.ReactNode;
  title: string;
  detail: string;
  trailing?: React.ReactNode;
}) {
  return (
    <>
      <span
        className="flex size-9 shrink-0 items-center justify-center rounded-full bg-foreground/5"
        aria-hidden="true"
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block">{title}</span>
        <span className="mt-0.5 block text-xs font-normal text-muted-foreground">{detail}</span>
      </span>
      {trailing ?? (
        <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      )}
    </>
  );
}

export function RecoveryOptions({ phoneEnabled }: { phoneEnabled: boolean }) {
  const [pending, setPending] = useState(false);

  async function continueWithGoogle() {
    if (pending) return;
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
      toast.error("Sign-in isn't configured on this server.");
      return;
    }
    setPending(true);
    const { error } = await supabaseBrowser().auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${authRedirectUrl("/auth/callback")}?next=${encodeURIComponent("/discover")}`,
        queryParams: { prompt: "select_account" },
      },
    });
    if (error) {
      setPending(false);
      toast.error("Couldn't start Google sign-in. Please try again.");
    }
  }

  return (
    <LoginStepShell
      title="Trouble signing in?"
      subtitle="No stress - any of these gets you back into your account."
      backHref="/login"
    >
      <div className="flex flex-1 flex-col">
        <div className="grid gap-3">
          <Link href="/auth" className={ROW_CLASS}>
            <RowBody
              icon={<Mail className="size-4.5" />}
              title="Sign in with email code"
              detail="We'll email you a one-time code - no password needed."
            />
          </Link>

          <button
            type="button"
            onClick={continueWithGoogle}
            disabled={pending}
            className={ROW_CLASS}
          >
            <RowBody
              icon={<GoogleIcon />}
              title="Sign in with Google"
              detail="Continue with the Google account you signed up with."
              trailing={
                pending ? (
                  <Loader2
                    className="size-4 shrink-0 animate-spin text-muted-foreground"
                    aria-hidden="true"
                  />
                ) : undefined
              }
            />
          </button>

          {phoneEnabled && (
            <Link href="/login/phone" className={ROW_CLASS}>
              <RowBody
                icon={<MessageCircleMore className="size-4.5" />}
                title="Sign in with phone"
                detail="We'll text a six-digit code to your number."
              />
            </Link>
          )}
        </div>

        <p className="mt-6 text-sm leading-relaxed text-pretty text-muted-foreground">
          Using Google? The account chooser lists every Google identity on
          this device - pick the email address your Tirvea account uses.
          Choosing a different one signs you into a different (or brand-new)
          account.
        </p>

        <div className="mt-auto pt-8">
          <p className="text-center text-xs text-muted-foreground">
            Still stuck?{" "}
            <a
              href="mailto:support@tirvea.app"
              className="font-medium text-primary-soft underline-offset-2 hover:underline"
            >
              Contact support
            </a>
          </p>
        </div>
      </div>
    </LoginStepShell>
  );
}
