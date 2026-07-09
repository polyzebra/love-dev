"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { AuthShell } from "@/components/auth/AuthShell";
import { AuthErrorBanner } from "@/components/auth/AuthErrorBanner";
import { OtpInput } from "@/components/auth/OtpInput";
import { ResendTimer } from "@/components/auth/ResendTimer";
import { AUTH_EMAIL_KEY, AUTH_EMAIL_RETRY_KEY } from "@/components/auth/EmailInputStep";
import { sendEmailCode, verifyEmailCode } from "@/components/auth/api";

/**
 * Step 2 of 5 - the emailed 6-digit code. The address travels in the
 * query string with a sessionStorage fallback (opened-from-history,
 * stripped params). Auto-submits at 6 digits; on a bad code the
 * server's own copy lands in the banner, the boxes clear and focus
 * returns to the first one. Expired / too-many-attempts read the same
 * way - always the real server message, never invented copy.
 */
/** sessionStorage never notifies - subscribe to nothing. */
const subscribeNever = () => () => {};

function readStoredEmail(): string | null {
  try {
    return sessionStorage.getItem(AUTH_EMAIL_KEY);
  } catch {
    return null; // Blocked storage - nothing to recover.
  }
}

/** The send response's retryAfter, stashed by the email step. */
function readStoredRetry(): string | null {
  try {
    return sessionStorage.getItem(AUTH_EMAIL_RETRY_KEY);
  } catch {
    return null;
  }
}

export function EmailCodeStep() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryEmail = searchParams.get("email");

  // Hydration-safe fallback read: null on the server, the real value
  // as soon as the client takes over - no setState-in-effect, no tear.
  const storedEmail = useSyncExternalStore(subscribeNever, readStoredEmail, () => null);
  const email = queryEmail ?? storedEmail;

  // Server-authoritative cooldown for the send that got us here; the
  // timer falls back to 30s when it is missing.
  const storedRetry = useSyncExternalStore(subscribeNever, readStoredRetry, () => null);
  const initialRetry = storedRetry ? Number(storedRetry) : null;

  // Nothing in the query AND nothing stored - restart the flow.
  useEffect(() => {
    if (!queryEmail && !readStoredEmail()) router.replace("/auth");
  }, [queryEmail, router]);

  const [code, setCode] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const otpRef = useRef<HTMLInputElement>(null);

  async function verify(value: string) {
    if (!email || verifying) return;
    setVerifying(true);
    setError(null);
    const result = await verifyEmailCode(email, value);
    if (result.ok) {
      try {
        sessionStorage.removeItem(AUTH_EMAIL_KEY);
        sessionStorage.removeItem(AUTH_EMAIL_RETRY_KEY);
      } catch {}
      router.replace(result.next);
      return; // Keep the disabled state while the route changes.
    }
    setVerifying(false);
    setError(result.message);
    setCode("");
    otpRef.current?.focus();
  }

  return (
    <AuthShell
      step={2}
      title="Enter the code we emailed you"
      subtitle={
        email ? (
          <>
            Sent to <span className="font-medium text-foreground">{email}</span>{" "}
            <Link
              href="/auth"
              className="whitespace-nowrap text-primary-soft underline-offset-2 hover:underline"
            >
              Change email
            </Link>
          </>
        ) : (
          "One moment..."
        )
      }
      backHref="/auth"
    >
      <div className="flex flex-1 flex-col">
        <OtpInput
          ref={otpRef}
          value={code}
          onChange={(value) => {
            setCode(value);
            if (error) setError(null);
          }}
          onComplete={verify}
          disabled={verifying || !email}
          invalid={!!error}
          autoFocus
          label="6-digit email code"
          describedById="email-code-error"
        />

        <div className="mt-4 space-y-4" aria-live="polite">
          {verifying && (
            <p className="text-center text-sm text-muted-foreground">
              Checking your code...
            </p>
          )}
          <AuthErrorBanner id="email-code-error" message={error} />
        </div>

        <div className="mt-auto pt-8">
          <ResendTimer
            disabled={!email || verifying}
            initialSeconds={initialRetry}
            onResend={async () => {
              if (!email) return;
              setError(null);
              const result = await sendEmailCode(email);
              // Neutral contract: the server always says when the resend
              // unlocks, never whether this one actually went out.
              return result.ok ? result.retryAfter : undefined;
            }}
          />
        </div>
      </div>
    </AuthShell>
  );
}
