"use client";

import { PHONE_OTP_LENGTH } from "@/lib/auth/otp";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { parsePhoneNumberFromString } from "libphonenumber-js";
import { AuthShell } from "@/components/auth/AuthShell";
import { AuthErrorBanner } from "@/components/auth/AuthErrorBanner";
import { OtpInput } from "@/components/auth/OtpInput";
import { ResendTimer } from "@/components/auth/ResendTimer";
import {
  AUTH_PHONE_KEY,
  AUTH_PHONE_RETRY_KEY,
  PHONE_COUNTRY_KEY,
} from "@/components/auth/PhoneInputStep";
import { sendPhoneCode, verifyPhoneCode } from "@/components/auth/api";
import { DEFAULT_COUNTRY_ISO, countryByIso } from "@/lib/auth/countries";

/**
 * Final gate - the SMS 6-digit code. Same contract as the email code
 * screen: auto-submit at 6 digits, server copy in the banner on
 * failure, boxes clear and refocus. The number arrives as E.164 in the
 * query with a sessionStorage fallback.
 */
/** sessionStorage never notifies - subscribe to nothing. */
const subscribeNever = () => () => {};

function readStoredPhone(): string | null {
  try {
    return sessionStorage.getItem(AUTH_PHONE_KEY);
  } catch {
    return null; // Blocked storage - nothing to recover.
  }
}

/** The send response's retryAfter, stashed by the phone step. */
function readStoredRetry(): string | null {
  try {
    return sessionStorage.getItem(AUTH_PHONE_RETRY_KEY);
  } catch {
    return null;
  }
}

export function PhoneCodeStep() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryPhone = searchParams.get("phone");

  // Hydration-safe fallback read: null on the server, the real value
  // as soon as the client takes over - no setState-in-effect, no tear.
  const storedPhone = useSyncExternalStore(subscribeNever, readStoredPhone, () => null);
  const phone = queryPhone ?? storedPhone;

  // Server-authoritative cooldown for the send that got us here; the
  // timer falls back to 30s when it is missing.
  const storedRetry = useSyncExternalStore(subscribeNever, readStoredRetry, () => null);
  const initialRetry = storedRetry ? Number(storedRetry) : null;

  // Nothing in the query AND nothing stored - restart the phone step.
  useEffect(() => {
    if (!queryPhone && !readStoredPhone()) router.replace("/auth/phone");
  }, [queryPhone, router]);

  const [code, setCode] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const otpRef = useRef<HTMLInputElement>(null);

  const prettyPhone = useMemo(
    () =>
      phone
        ? (parsePhoneNumberFromString(phone)?.formatInternational() ?? phone)
        : null,
    [phone],
  );

  async function verify(value: string) {
    if (!phone || verifying) return;
    setVerifying(true);
    setError(null);
    const result = await verifyPhoneCode(phone, value);
    if (result.ok) {
      try {
        sessionStorage.removeItem(AUTH_PHONE_KEY);
        sessionStorage.removeItem(AUTH_PHONE_RETRY_KEY);
      } catch {}
      router.replace(result.next);
      return; // Keep the disabled state while the route changes.
    }
    setVerifying(false);
    setError(result.message);
    setCode("");
    otpRef.current?.focus();
  }

  async function resend(): Promise<number | void> {
    if (!phone) return;
    setError(null);
    // Reconstruct the country from the remembered choice; fall back to
    // deriving it from the number itself, then to the default.
    let iso: string | null = null;
    try {
      iso = localStorage.getItem(PHONE_COUNTRY_KEY);
    } catch {}
    const country =
      countryByIso(iso) ??
      countryByIso(parsePhoneNumberFromString(phone)?.country) ??
      countryByIso(DEFAULT_COUNTRY_ISO)!;
    const result = await sendPhoneCode({
      phoneE164: phone,
      countryIso: country.iso,
      dialCode: country.dialCode,
    });
    // Verified in the meantime (another tab, a race we lost track of):
    // that's a success state - continue the flow instead of resending.
    if (result.ok && result.alreadyVerified && result.next) {
      try {
        sessionStorage.removeItem(AUTH_PHONE_KEY);
        sessionStorage.removeItem(AUTH_PHONE_RETRY_KEY);
      } catch {}
      router.replace(result.next);
      return;
    }
    // Surface a duplicate claim (the number got verified on ANOTHER
    // account since the first send) instead of silently swallowing it.
    if (!result.ok && result.code === "duplicate_phone") {
      setError(result.message);
      return;
    }
    // Neutral contract: the server always says when the resend unlocks,
    // never whether this one actually went out.
    return result.ok ? result.retryAfter : undefined;
  }

  return (
    <AuthShell
      step={3}
      title="Enter the code we texted you"
      subtitle={
        prettyPhone ? (
          <>
            Sent to{" "}
            <span className="font-medium whitespace-nowrap text-foreground">
              {prettyPhone}
            </span>
          </>
        ) : (
          "One moment..."
        )
      }
      backHref="/auth/phone"
    >
      <div className="flex flex-1 flex-col">
        <OtpInput
          length={PHONE_OTP_LENGTH}
          ref={otpRef}
          value={code}
          onChange={(value) => {
            setCode(value);
            if (error) setError(null);
          }}
          onComplete={verify}
          disabled={verifying || !phone}
          invalid={!!error}
          autoFocus
          label="6-digit text message code"
          describedById="phone-code-error"
        />

        <div className="mt-4 space-y-4" aria-live="polite">
          {verifying && (
            <p className="text-center text-sm text-muted-foreground">
              Checking your code...
            </p>
          )}
          <AuthErrorBanner id="phone-code-error" message={error} />
        </div>

        <div className="mt-auto pt-8">
          <ResendTimer
            disabled={!phone || verifying}
            initialSeconds={initialRetry}
            onResend={resend}
          />
        </div>
      </div>
    </AuthShell>
  );
}
