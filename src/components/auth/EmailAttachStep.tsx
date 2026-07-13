"use client";

import { EMAIL_OTP_LENGTH } from "@/lib/auth/otp";
import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { InlineFieldError } from "@/components/ui/field-error";
import { AuthShell } from "@/components/auth/AuthShell";
import { AuthFormStack } from "@/components/auth/AuthFormStack";
import { AuthErrorBanner } from "@/components/auth/AuthErrorBanner";
import { AuthSubmitButton } from "@/components/auth/AuthSubmitButton";
import { OtpInput, refocusOtpInput } from "@/components/auth/OtpInput";
import { ResendTimer } from "@/components/auth/ResendTimer";
import { GoogleIcon, AppleIcon } from "@/components/auth/LoginEntry";
import { sendEmailAttachCode, verifyEmailAttachCode } from "@/components/auth/api";
import { appleLoginEnabled } from "@/lib/auth/apple";
import { supabaseBrowser } from "@/lib/supabase/client";
import { authRedirectUrl } from "@/lib/auth/url";

/**
 * /auth/email - the AUTHENTICATED email-attach step (the email mirror of
 * /auth/phone): phone-first accounts land here right after their phone
 * rung to replace the placeholder address with a real, verified one.
 * One page, three in-page phases (the simplest shape consistent with the
 * phone-change pattern - no address ever travels through the URL):
 *
 *  - "input":    Add your email -> POST /api/auth/email-attach/send
 *  - "code":     the emailed 6-digit code -> /verify; auto-submit,
 *                server copy on failure, resend with server cooldown
 *  - "conflict": CASE 3 (EMAIL_IN_USE) - a full-card state with the
 *                server's exact copy and the honest ways out: sign in
 *                with Email / Google / Apple (the account that owns the
 *                address), or Cancel back to a different address.
 *
 * CASE 2 (already verified on THIS account) short-circuits at send:
 * `alreadyVerified` + `next` - continue the ladder, no OTP screen.
 */

type Phase = "input" | "code" | "conflict";

/** Good-faith shape check - the emailed code is the real verification. */
function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value);
}

/** Full-width provider row for the conflict card - LoginEntry geometry. */
const PROVIDER_BUTTON_CLASS =
  "min-h-[52px] w-full rounded-full text-[0.9375rem] font-medium active:scale-[0.98]";

export function EmailAttachStep() {
  const router = useRouter();
  const appleEnabled = appleLoginEnabled();

  const [phase, setPhase] = useState<Phase>("input");
  const [email, setEmail] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  /** The send response's retryAfter - seeds the code screen's timer. */
  const [retryAfter, setRetryAfter] = useState<number | null>(null);
  /** The server's EMAIL_IN_USE copy, rendered verbatim on the conflict card. */
  const [conflictMessage, setConflictMessage] = useState<string | null>(null);

  const [code, setCode] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [codeError, setCodeError] = useState<string | null>(null);
  const otpRef = useRef<HTMLInputElement>(null);
  const [oauthPending, setOauthPending] = useState<"google" | "apple" | null>(null);

  function enterConflict(message: string) {
    setConflictMessage(message);
    setCode("");
    setCodeError(null);
    setPhase("conflict");
  }

  function backToInput() {
    setCode("");
    setCodeError(null);
    setServerError(null);
    setFieldError(null);
    setPhase("input");
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    const value = email.trim().toLowerCase();
    if (!looksLikeEmail(value)) {
      setFieldError("Enter a valid email address.");
      return;
    }
    setEmail(value);
    setFieldError(null);
    setServerError(null);
    setPending(true);
    const result = await sendEmailAttachCode(value);
    setPending(false);
    if (!result.ok) {
      // CASE 3 - the address belongs to another account: the full-card
      // conflict state with the server's exact copy.
      if (result.code === "email_in_use") {
        enterConflict(result.message);
        return;
      }
      setServerError(result.message);
      return;
    }
    // CASE 2 - already verified on this account: continue the ladder.
    if (result.alreadyVerified && result.next) {
      router.replace(result.next);
      return;
    }
    setRetryAfter(result.retryAfter ?? null);
    setPhase("code");
  }

  async function verify(value: string) {
    if (verifying) return;
    setVerifying(true);
    setCodeError(null);
    const result = await verifyEmailAttachCode(email, value);
    if (result.ok) {
      router.replace(result.next);
      return; // Keep the disabled state while the route changes.
    }
    setVerifying(false);
    if (result.code === "email_in_use") {
      // The address got claimed by another account since the send (or we
      // lost the commit race) - same conflict card, nothing transferred.
      enterConflict(result.message);
      return;
    }
    setCodeError(result.message);
    setCode("");
    refocusOtpInput(otpRef);
  }

  async function resend(): Promise<number | void> {
    setCodeError(null);
    const result = await sendEmailAttachCode(email);
    // Verified in the meantime (another tab): success - continue.
    if (result.ok && result.alreadyVerified && result.next) {
      router.replace(result.next);
      return;
    }
    if (!result.ok && result.code === "email_in_use") {
      enterConflict(result.message);
      return;
    }
    // Neutral contract: the server always says when the resend unlocks,
    // never whether this one actually went out.
    return result.ok ? result.retryAfter : undefined;
  }

  // Same browser OAuth as /login - the callback signs the browser into
  // the account that owns the address (this placeholder session simply
  // gets replaced; nothing is merged).
  async function startOAuth(provider: "google" | "apple") {
    if (oauthPending) return;
    setOauthPending(provider);
    const { error } = await supabaseBrowser().auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: `${authRedirectUrl("/auth/callback")}?next=${encodeURIComponent("/discover")}`,
        queryParams: provider === "google" ? { prompt: "select_account" } : undefined,
      },
    });
    if (error) {
      setOauthPending(null);
      toast.error("Couldn't start sign-in. Please try again.");
    }
  }

  if (phase === "conflict") {
    return (
      <AuthShell step={1} title="That email is already in use" stepKey="conflict">
        <div className="space-y-6">
          <div role="alert" className="border-border bg-foreground/5 rounded-2xl border px-5 py-5">
            <Mail className="text-muted-foreground mb-3 size-6" aria-hidden="true" />
            <p className="text-foreground text-sm leading-relaxed">{conflictMessage}</p>
          </div>
          <div className="grid gap-3">
            <Button asChild variant="outline" className={PROVIDER_BUTTON_CLASS}>
              <Link href="/login/email">
                <span className="inline-flex items-center justify-center gap-2.5">
                  <Mail className="size-5" aria-hidden="true" />
                  Continue with Email
                </span>
              </Link>
            </Button>
            <Button
              type="button"
              variant="outline"
              className={PROVIDER_BUTTON_CLASS}
              disabled={oauthPending !== null}
              onClick={() => startOAuth("google")}
            >
              <span className="inline-flex items-center justify-center gap-2.5">
                {oauthPending === "google" ? (
                  <Loader2 className="size-5 animate-spin" aria-hidden="true" />
                ) : (
                  <GoogleIcon />
                )}
                Continue with Google
              </span>
            </Button>
            {appleEnabled && (
              <Button
                type="button"
                variant="outline"
                className={PROVIDER_BUTTON_CLASS}
                disabled={oauthPending !== null}
                onClick={() => startOAuth("apple")}
              >
                <span className="inline-flex items-center justify-center gap-2.5">
                  {oauthPending === "apple" ? (
                    <Loader2 className="size-5 animate-spin" aria-hidden="true" />
                  ) : (
                    <AppleIcon />
                  )}
                  Continue with Apple
                </span>
              </Button>
            )}
            <Button
              type="button"
              variant="ghost"
              className={PROVIDER_BUTTON_CLASS}
              disabled={oauthPending !== null}
              onClick={backToInput}
            >
              Cancel
            </Button>
          </div>
        </div>
      </AuthShell>
    );
  }

  if (phase === "code") {
    return (
      <AuthShell
        step={2}
        title="Enter the code we emailed you"
        subtitle={
          <>
            Sent to <span className="text-foreground font-medium">{email}</span>{" "}
            <button
              type="button"
              onClick={backToInput}
              className="text-primary-soft focus-visible:ring-foreground/20 rounded-sm whitespace-nowrap underline-offset-2 outline-none hover:underline focus-visible:ring-2"
            >
              Change email
            </button>
          </>
        }
        stepKey="code"
      >
        <AuthFormStack
          field={
            <OtpInput
              length={EMAIL_OTP_LENGTH}
              ref={otpRef}
              value={code}
              onChange={(value) => {
                setCode(value);
                if (codeError) setCodeError(null);
              }}
              onComplete={verify}
              disabled={verifying}
              invalid={!!codeError}
              autoFocus
              label="6-digit email code"
              describedById="email-attach-code-error"
            />
          }
          statusLive
          status={
            <>
              {verifying && (
                <p className="text-muted-foreground text-center text-sm">Checking your code...</p>
              )}
              <AuthErrorBanner id="email-attach-code-error" message={codeError} />
            </>
          }
          cta={<ResendTimer disabled={verifying} initialSeconds={retryAfter} onResend={resend} />}
        />
      </AuthShell>
    );
  }

  return (
    <AuthShell
      step={1}
      title="Add your email"
      subtitle="We'll send you a six-digit code."
      stepKey="input"
    >
      <AuthFormStack
        onSubmit={onSubmit}
        field={
          <>
            <Label htmlFor="attach-email">Email</Label>
            <Input
              id="attach-email"
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
                if (serverError) setServerError(null);
              }}
              disabled={pending}
              aria-invalid={fieldError ? true : undefined}
              aria-describedby={fieldError ? "attach-email-error" : undefined}
              className="h-12"
            />
            <InlineFieldError id="attach-email-error" message={fieldError} />
          </>
        }
        status={<AuthErrorBanner message={serverError} />}
        cta={
          <AuthSubmitButton pending={pending} pendingLabel="Sending code..." disabled={pending}>
            Continue
          </AuthSubmitButton>
        }
        footnote="We only use your email to sign you in - never to spam you."
      />
    </AuthShell>
  );
}
