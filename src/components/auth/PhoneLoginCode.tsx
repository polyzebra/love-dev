"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { parsePhoneNumberFromString } from "libphonenumber-js";
import { ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LoginStepShell } from "@/components/auth/LoginStepShell";
import { AuthFormStack } from "@/components/auth/AuthFormStack";
import { AuthErrorBanner } from "@/components/auth/AuthErrorBanner";
import { OtpInput } from "@/components/auth/OtpInput";
import { ResendTimer } from "@/components/auth/ResendTimer";
import { LOGIN_PHONE_KEY, LOGIN_PHONE_RETRY_KEY } from "@/components/auth/PhoneLoginInput";
import { OFFLINE_CODE, sendPhoneLoginCode, verifyPhoneLoginCode } from "@/components/auth/api";

/**
 * /login/phone/verify - the SMS six-digit gate for phone LOGIN. The
 * number arrives as E.164 in the query with a sessionStorage fallback
 * and is shown MASKED (+353 ... last 3 digits only - this screen's URL
 * can be shared/screenshotted; the full number never needs to be on it).
 *
 * States, per contract code:
 * - INVALID_CODE: boxes clear + shake + refocus, stay here.
 * - EXPIRED_CODE: distinct copy pointing at resend.
 * - TOO_MANY_ATTEMPTS (429): input disabled with cooldown copy; the form
 *   recovers by itself when the countdown ends.
 * - IDENTITY_CONFLICT (409): full-card recovery state - the session was
 *   refused server-side; offer email/Google instead. Never reveals more.
 * - Offline: toast, code kept.
 * Success: cookies are already set - router.replace(next).
 */

/** UI recovery window after a 429 - the form must come back on its own. */
const LOCK_RECOVER_SECONDS = 60;

/** sessionStorage never notifies - subscribe to nothing. */
const subscribeNever = () => () => {};

function readStoredPhone(): string | null {
  try {
    return sessionStorage.getItem(LOGIN_PHONE_KEY);
  } catch {
    return null;
  }
}

/** The send response's retryAfter, stashed by the phone step. */
function readStoredRetry(): string | null {
  try {
    return sessionStorage.getItem(LOGIN_PHONE_RETRY_KEY);
  } catch {
    return null;
  }
}

/**
 * "+353 ••• ••• 333" - dial code kept, national digits masked except the
 * last three, grouped in threes from the right.
 */
function maskPhone(e164: string): string {
  const parsed = parsePhoneNumberFromString(e164);
  const dial = parsed ? `+${parsed.countryCallingCode}` : "";
  const digits = (parsed ? String(parsed.nationalNumber) : e164.replace(/^\+/, "")).replace(
    /\D/g,
    "",
  );
  const masked = "•".repeat(Math.max(0, digits.length - 3)) + digits.slice(-3);
  const groups: string[] = [];
  for (let end = masked.length; end > 0; end -= 3) {
    groups.unshift(masked.slice(Math.max(0, end - 3), end));
  }
  return [dial, groups.join(" ")].filter(Boolean).join(" ");
}

export function PhoneLoginCode() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryPhone = searchParams.get("phone");

  // Hydration-safe fallback read: null on the server, the real value as
  // soon as the client takes over.
  const storedPhone = useSyncExternalStore(subscribeNever, readStoredPhone, () => null);
  const phone = queryPhone ?? storedPhone;

  const storedRetry = useSyncExternalStore(subscribeNever, readStoredRetry, () => null);
  const initialRetry = storedRetry ? Number(storedRetry) : null;

  // Nothing in the query AND nothing stored - restart at the phone step.
  useEffect(() => {
    if (!queryPhone && !readStoredPhone()) router.replace("/login/phone");
  }, [queryPhone, router]);

  const [code, setCode] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);
  const [conflict, setConflict] = useState<string | null>(null);
  const [lockSeconds, setLockSeconds] = useState(0);
  const otpRef = useRef<HTMLInputElement>(null);

  // The 429 cooldown ticks down and the form recovers on its own.
  useEffect(() => {
    if (lockSeconds <= 0) return;
    const t = setInterval(() => setLockSeconds((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(t);
  }, [lockSeconds]);

  const masked = useMemo(() => (phone ? maskPhone(phone) : null), [phone]);

  function clearSession() {
    try {
      sessionStorage.removeItem(LOGIN_PHONE_KEY);
      sessionStorage.removeItem(LOGIN_PHONE_RETRY_KEY);
    } catch {}
  }

  async function verify(value: string) {
    if (!phone || verifying || lockSeconds > 0) return;
    setVerifying(true);
    setError(null);
    setExpired(false);
    const result = await verifyPhoneLoginCode(phone, value);
    if (result.ok) {
      clearSession();
      router.replace(result.next);
      return; // Keep the disabled state while the route changes.
    }
    setVerifying(false);
    switch (result.code) {
      case OFFLINE_CODE:
        // Nothing was judged - keep the typed code, just say so.
        toast.error(result.message);
        return;
      case "IDENTITY_CONFLICT":
        setConflict(result.message);
        return;
      case "TOO_MANY_ATTEMPTS":
        setError(result.message);
        setCode("");
        setLockSeconds(LOCK_RECOVER_SECONDS);
        return;
      case "EXPIRED_CODE":
        setExpired(true);
        setError(result.message);
        setCode("");
        otpRef.current?.focus();
        return;
      default:
        // INVALID_CODE and anything unexpected: clear + shake + refocus.
        setError(result.message);
        setCode("");
        otpRef.current?.focus();
        return;
    }
  }

  async function resend(): Promise<number | void> {
    if (!phone) return;
    setError(null);
    setExpired(false);
    const iso = parsePhoneNumberFromString(phone)?.country;
    const result = await sendPhoneLoginCode({
      phoneE164: phone,
      countryIso: iso ?? "IE",
    });
    if (result.ok) return result.retryAfter;
    switch (result.code) {
      case "RESEND_TOO_SOON":
        // The countdown is the honest signal - restart it from the server.
        return result.retryAfter;
      case "IDENTITY_CONFLICT":
        setConflict(result.message);
        return;
      case OFFLINE_CODE:
        toast.error(result.message);
        return;
      default:
        setError(result.message);
        return;
    }
  }

  const locked = lockSeconds > 0;

  return (
    <LoginStepShell
      title={conflict ? "Let's sign you in another way" : "Enter the code we texted you"}
      subtitle={
        conflict ? null : masked ? (
          <>
            Sent to <span className="text-foreground font-medium whitespace-nowrap">{masked}</span>
          </>
        ) : (
          "One moment..."
        )
      }
      backHref="/login/phone"
      backLabel="Change number"
      stepKey={conflict ? "conflict" : "code"}
    >
      {conflict ? (
        // Full-card recovery: the OTP was right, but this number belongs
        // to an account that signs in another way - the server already
        // refused the session. Calm exit, no identity details.
        <AuthFormStack
          field={
            <div
              role="alert"
              className="border-border bg-foreground/5 rounded-2xl border px-5 py-6 text-center"
            >
              <ShieldAlert
                className="text-muted-foreground mx-auto mb-3 size-6"
                aria-hidden="true"
              />
              <p className="text-foreground text-sm">{conflict}</p>
            </div>
          }
          cta={
            <Button asChild size="lg" className="min-h-12 w-full rounded-full">
              <Link href="/login">Use email or Google</Link>
            </Button>
          }
          footnote={
            <>
              Need a hand?{" "}
              <a
                href="mailto:support@tirvea.app"
                className="hover:text-foreground underline underline-offset-2"
              >
                Contact support
              </a>
            </>
          }
        />
      ) : (
        <AuthFormStack
          field={
            <OtpInput
              length={6}
              ref={otpRef}
              value={code}
              onChange={(value) => {
                setCode(value);
                if (error && !locked) {
                  setError(null);
                  setExpired(false);
                }
              }}
              onComplete={verify}
              disabled={verifying || locked || !phone}
              invalid={!!error && !locked}
              autoFocus
              label="6-digit text message code"
              describedById="phone-login-code-error"
            />
          }
          statusLive
          status={
            <>
              {verifying && (
                <p className="text-muted-foreground text-center text-sm">Checking your code...</p>
              )}
              <AuthErrorBanner id="phone-login-code-error" message={error} />
              {locked && (
                <p className="text-muted-foreground text-center text-sm">
                  You can try again in{" "}
                  <span className="tabular-nums">
                    {Math.floor(lockSeconds / 60)}:{String(lockSeconds % 60).padStart(2, "0")}
                  </span>
                  .
                </p>
              )}
              {expired && !locked && (
                <p className="text-muted-foreground text-center text-sm">
                  Codes only live for a few minutes - request a fresh one below.
                </p>
              )}
            </>
          }
          cta={
            <ResendTimer
              disabled={!phone || verifying || locked}
              initialSeconds={initialRetry}
              onResend={resend}
            />
          }
        />
      )}
    </LoginStepShell>
  );
}
