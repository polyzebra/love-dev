"use client";

import { useMemo, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AsYouType, parsePhoneNumberFromString } from "libphonenumber-js";
import { ChevronDown } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { InlineFieldError } from "@/components/ui/field-error";
import { LoginStepShell } from "@/components/auth/LoginStepShell";
import { AuthFormStack } from "@/components/auth/AuthFormStack";
import { AuthErrorBanner } from "@/components/auth/AuthErrorBanner";
import { AuthSubmitButton } from "@/components/auth/AuthSubmitButton";
import { CountryCodeSheet } from "@/components/auth/CountryCodeSheet";
import { PHONE_COUNTRY_KEY } from "@/components/auth/PhoneInputStep";
import { OFFLINE_CODE, sendPhoneLoginCode } from "@/components/auth/api";
import { DEFAULT_COUNTRY_ISO, countryByIso, type Country } from "@/lib/auth/countries";

/**
 * /login/phone - "Continue with your phone". Country selector restricted
 * to the server's supported list (getSupportedPhoneCountries("login"),
 * a server prop - the env never reaches the bundle) + national
 * as-you-type formatting; the E.164 we send is built client-side and the
 * backend revalidates it.
 *
 * Error language, per contract code:
 * - INVALID_PHONE / UNSUPPORTED_COUNTRY: inline field error.
 * - IDENTITY_CONFLICT (409): stays HERE with the server's recovery copy
 *   and a "Sign in another way" link back to /login.
 * - RESEND_TOO_SOON (429): banner with the server's retryAfter.
 * - SMS_PROVIDER_UNAVAILABLE / PHONE_LOGIN_NOT_AVAILABLE (503): the
 *   provider (or the feature) is down/misconfigured - an inline
 *   config-error banner (NEVER a toast; it must survive a glance away)
 *   with the server's message and a "Use another method" link back to
 *   /login. The form stays fully usable for a retry.
 * - Offline: toast; everything else: quiet banner.
 */

export const LOGIN_PHONE_KEY = "tirvea:login-phone";
/** Server retryAfter (seconds) for the send that opened the code screen. */
export const LOGIN_PHONE_RETRY_KEY = "tirvea:login-phone-retry";

/** localStorage never notifies - subscribe to nothing. */
const subscribeNever = () => () => {};

function readRememberedIso(): string | null {
  try {
    return localStorage.getItem(PHONE_COUNTRY_KEY);
  } catch {
    return null;
  }
}

export function PhoneLoginInput({ allowedIsos }: { allowedIsos: string[] }) {
  const router = useRouter();

  const allowedCountries = useMemo(
    () => allowedIsos.map((iso) => countryByIso(iso)).filter((c): c is Country => c !== null),
    [allowedIsos],
  );
  // IE leads when the supported list contains it (the default full list
  // always does); a narrowed list without IE falls to its first entry.
  // (The server page never renders this with an empty list.)
  const fallbackCountry =
    allowedCountries.find((c) => c.iso === DEFAULT_COUNTRY_ISO) ?? allowedCountries[0];

  // Remembered country (shared with the signup phone step), but only
  // when the allowlist contains it; hydration-safe (null on the server).
  const rememberedIso = useSyncExternalStore(subscribeNever, readRememberedIso, () => null);
  const [pickedCountry, setPickedCountry] = useState<Country | null>(null);
  const remembered = allowedCountries.find((c) => c.iso === countryByIso(rememberedIso)?.iso);
  const country = pickedCountry ?? remembered ?? fallbackCountry;

  const [sheetOpen, setSheetOpen] = useState(false);
  const [display, setDisplay] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<string | null>(null);
  const [providerDown, setProviderDown] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function chooseCountry(next: Country) {
    setPickedCountry(next);
    try {
      localStorage.setItem(PHONE_COUNTRY_KEY, next.iso);
    } catch {}
    setDisplay((prev) => formatNational(digitsOf(prev), next));
    inputRef.current?.focus();
  }

  function digitsOf(value: string): string {
    return value.replace(/\D/g, "");
  }

  function formatNational(digits: string, c: Country): string {
    return digits ? new AsYouType(c.iso).input(digits) : "";
  }

  function onPhoneChange(e: React.ChangeEvent<HTMLInputElement>) {
    const raw = e.target.value;
    let digits = digitsOf(raw);
    // Deleting a formatting character removes no digit - reformatting
    // would snap it right back and trap the caret. Treat that delete as
    // "drop the last digit" instead.
    if (raw.length < display.length && digits === digitsOf(display)) {
      digits = digits.slice(0, -1);
    }
    setDisplay(formatNational(digits, country));
    // Editing clears every error layer - after a 409 the form stays
    // right here and must feel immediately usable again.
    if (fieldError) setFieldError(null);
    if (serverError) setServerError(null);
    if (conflict) setConflict(null);
    if (providerDown) setProviderDown(null);
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    const parsed = parsePhoneNumberFromString(digitsOf(display), country.iso);
    if (!parsed?.isValid()) {
      setFieldError("Enter a valid phone number.");
      return;
    }
    setFieldError(null);
    setServerError(null);
    setConflict(null);
    setProviderDown(null);
    setPending(true);
    const result = await sendPhoneLoginCode({
      phoneE164: parsed.number,
      countryIso: country.iso,
    });
    // Loading ALWAYS resets before any branch - a failure leaves the
    // form editable on this screen.
    setPending(false);
    if (!result.ok) {
      switch (result.code) {
        case "INVALID_PHONE":
        case "UNSUPPORTED_COUNTRY":
          setFieldError(result.message);
          return;
        case "IDENTITY_CONFLICT":
          setConflict(result.message);
          return;
        case "SMS_PROVIDER_UNAVAILABLE":
        case "PHONE_LOGIN_NOT_AVAILABLE":
          setProviderDown(result.message);
          return;
        case "RESEND_TOO_SOON":
          setServerError(
            result.retryAfter
              ? `${result.message} You can request one in ${result.retryAfter}s.`
              : result.message,
          );
          return;
        case OFFLINE_CODE:
          toast.error(result.message);
          return;
        default:
          setServerError(result.message);
          return;
      }
    }
    try {
      sessionStorage.setItem(LOGIN_PHONE_KEY, parsed.number);
      if (result.retryAfter) {
        sessionStorage.setItem(LOGIN_PHONE_RETRY_KEY, String(result.retryAfter));
      }
    } catch {
      // The query param below is the primary carrier anyway.
    }
    router.push(`/login/phone/verify?phone=${encodeURIComponent(parsed.number)}`);
  }

  return (
    <LoginStepShell
      title="Continue with your phone"
      subtitle="We'll text you a six-digit code."
      backHref="/login"
    >
      <AuthFormStack
        onSubmit={onSubmit}
        field={
          <>
            <Label htmlFor="login-phone">Phone number</Label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setSheetOpen(true)}
                aria-label={`Country: ${country.name} (${country.dialCode}). Change country`}
                aria-haspopup="dialog"
                className="border-input bg-foreground/5 hover:border-foreground/25 focus-visible:ring-foreground/20 inline-flex h-12 shrink-0 items-center gap-1.5 rounded-2xl border px-3.5 text-base shadow-[inset_0_1px_0_var(--glass-highlight)] transition-colors outline-none focus-visible:ring-2 disabled:opacity-50 md:text-sm"
                disabled={pending}
              >
                <span className="text-lg leading-none" aria-hidden="true">
                  {country.flag}
                </span>
                <span className="tabular-nums">{country.dialCode}</span>
                <ChevronDown className="text-muted-foreground size-3.5" aria-hidden="true" />
              </button>
              <Input
                ref={inputRef}
                id="login-phone"
                name="phone"
                type="tel"
                inputMode="tel"
                autoComplete="tel-national"
                autoFocus
                placeholder="87 123 4567"
                value={display}
                onChange={onPhoneChange}
                disabled={pending}
                aria-invalid={fieldError ? true : undefined}
                aria-describedby={fieldError ? "login-phone-error" : undefined}
                className="h-12"
              />
            </div>
            <InlineFieldError id="login-phone-error" message={fieldError} />
          </>
        }
        status={
          <>
            <AuthErrorBanner message={serverError ?? conflict ?? providerDown} />
            {providerDown && (
              <p className="text-center text-sm">
                <Link
                  href="/login"
                  className="text-primary-soft focus-visible:ring-foreground/20 rounded-sm font-medium underline-offset-2 outline-none hover:underline focus-visible:ring-2"
                >
                  Use another method
                </Link>
              </p>
            )}
            {conflict && (
              <p className="text-center text-sm">
                <Link
                  href="/login"
                  className="text-primary-soft focus-visible:ring-foreground/20 rounded-sm font-medium underline-offset-2 outline-none hover:underline focus-visible:ring-2"
                >
                  Sign in another way
                </Link>
              </p>
            )}
          </>
        }
        cta={
          <AuthSubmitButton pending={pending} disabled={pending}>
            Send code
          </AuthSubmitButton>
        }
        footnote="Standard SMS rates may apply."
      />

      <CountryCodeSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        selectedIso={country.iso}
        onSelect={chooseCountry}
        isos={allowedIsos}
      />
    </LoginStepShell>
  );
}
