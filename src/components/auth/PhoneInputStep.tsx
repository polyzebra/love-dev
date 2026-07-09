"use client";

import { useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { AsYouType, parsePhoneNumberFromString } from "libphonenumber-js";
import { ChevronDown, MessageCircleMore } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { InlineFieldError } from "@/components/ui/field-error";
import { AuthShell } from "@/components/auth/AuthShell";
import { AuthErrorBanner } from "@/components/auth/AuthErrorBanner";
import { AuthSubmitButton } from "@/components/auth/AuthSubmitButton";
import { CountryCodeSheet } from "@/components/auth/CountryCodeSheet";
import { sendPhoneCode } from "@/components/auth/api";
import {
  DEFAULT_COUNTRY_ISO,
  countryByIso,
  type Country,
} from "@/lib/auth/countries";

/**
 * Step 3 of 5 - "What's your number?". Country selector (bottom sheet /
 * dialog) + tel input formatted as-you-type in the national format;
 * what we store and send is always E.164. The last-used country is
 * remembered in localStorage.
 *
 * A 503 from the send route means phone verification can't happen right
 * now (provider outage while the feature is live) - we say so plainly
 * and BLOCK: no continue button, no skip. Outages never bypass
 * verification. When the feature flag is off entirely the gate never
 * routes here, so this screen only ever blocks, it never skips.
 */

export const AUTH_PHONE_KEY = "tirvea:auth-phone";
export const PHONE_COUNTRY_KEY = "tirvea:phone-country";
/** Server retryAfter (seconds) for the send that opened the code screen. */
export const AUTH_PHONE_RETRY_KEY = "tirvea:auth-phone-retry";

const defaultCountry = countryByIso(DEFAULT_COUNTRY_ISO)!;

/** localStorage never notifies - subscribe to nothing. */
const subscribeNever = () => () => {};

function readRememberedIso(): string | null {
  try {
    return localStorage.getItem(PHONE_COUNTRY_KEY);
  } catch {
    return null;
  }
}

export function PhoneInputStep() {
  const router = useRouter();
  // The remembered country arrives hydration-safely (null on the
  // server, the stored ISO on the client); an explicit pick this
  // session wins over it, IE is the default before either exists.
  const rememberedIso = useSyncExternalStore(subscribeNever, readRememberedIso, () => null);
  const [pickedCountry, setPickedCountry] = useState<Country | null>(null);
  const country = pickedCountry ?? countryByIso(rememberedIso) ?? defaultCountry;

  const [sheetOpen, setSheetOpen] = useState(false);
  const [display, setDisplay] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function chooseCountry(next: Country) {
    setPickedCountry(next);
    try {
      localStorage.setItem(PHONE_COUNTRY_KEY, next.iso);
    } catch {}
    // Reformat whatever is typed under the new country's rules.
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
    // Deleting a formatting character (space, bracket) removes no
    // digit, so reformatting would snap the char right back and trap
    // the caret. Treat that delete as "drop the last digit" instead.
    if (raw.length < display.length && digits === digitsOf(display)) {
      digits = digits.slice(0, -1);
    }
    setDisplay(formatNational(digits, country));
    if (fieldError) setFieldError(null);
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
    setPending(true);
    const result = await sendPhoneCode({
      phoneE164: parsed.number,
      countryIso: country.iso,
      dialCode: country.dialCode,
    });
    setPending(false);
    if (!result.ok) {
      if (result.blocked) setBlocked(true);
      else setServerError(result.message);
      return;
    }
    try {
      sessionStorage.setItem(AUTH_PHONE_KEY, parsed.number);
      if (result.retryAfter) {
        sessionStorage.setItem(AUTH_PHONE_RETRY_KEY, String(result.retryAfter));
      }
    } catch {}
    router.push(`/auth/phone-code?phone=${encodeURIComponent(parsed.number)}`);
  }

  return (
    <AuthShell
      step={3}
      title="What's your number?"
      subtitle="We'll text you a code to verify it's really you."
      stepKey={blocked ? "blocked" : "phone"}
    >
      {blocked ? (
        // Provider outage while phone verification is REQUIRED. This is
        // a hard stop by design - no continue button, no skip path.
        <div className="flex flex-1 flex-col">
          <div
            role="status"
            className="rounded-2xl border border-border bg-foreground/5 px-5 py-6 text-center"
          >
            <MessageCircleMore
              className="mx-auto mb-3 size-6 text-muted-foreground"
              aria-hidden="true"
            />
            <p className="text-sm text-foreground">
              Phone verification is temporarily unavailable.
            </p>
            <p className="mt-1.5 text-xs text-muted-foreground">
              We can&apos;t send codes right now. Please try again in a little
              while - verifying your number is required to continue.
            </p>
          </div>
        </div>
      ) : (
        <form onSubmit={onSubmit} className="flex flex-1 flex-col" noValidate>
          <div className="space-y-2">
            <Label htmlFor="auth-phone">Phone number</Label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setSheetOpen(true)}
                aria-label={`Country: ${country.name} (${country.dialCode}). Change country`}
                aria-haspopup="dialog"
                className="inline-flex h-12 shrink-0 items-center gap-1.5 rounded-2xl border border-input bg-foreground/5 px-3.5 text-base shadow-[inset_0_1px_0_var(--glass-highlight)] transition-colors outline-none hover:border-foreground/25 focus-visible:ring-2 focus-visible:ring-foreground/20 disabled:opacity-50 md:text-sm"
                disabled={pending}
              >
                <span className="text-lg leading-none" aria-hidden="true">
                  {country.flag}
                </span>
                <span className="tabular-nums">{country.dialCode}</span>
                <ChevronDown
                  className="size-3.5 text-muted-foreground"
                  aria-hidden="true"
                />
              </button>
              <Input
                ref={inputRef}
                id="auth-phone"
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
                aria-describedby={fieldError ? "auth-phone-error" : undefined}
                className="h-12"
              />
            </div>
            <InlineFieldError id="auth-phone-error" message={fieldError} />
          </div>

          <AuthErrorBanner message={serverError} className="mt-4" />

          <div className="mt-auto space-y-4 pt-8">
            <AuthSubmitButton pending={pending} disabled={pending}>
              Send code
            </AuthSubmitButton>
            <p className="text-center text-xs text-muted-foreground">
              Standard SMS rates may apply.
            </p>
          </div>
        </form>
      )}

      <CountryCodeSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        selectedIso={country.iso}
        onSelect={chooseCountry}
      />
    </AuthShell>
  );
}
