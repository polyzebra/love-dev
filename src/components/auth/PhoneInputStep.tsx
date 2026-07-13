"use client";

import { useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { loadPhoneTools, usePhoneTools, type PhoneTools } from "@/lib/auth/phone-tools";
import { ChevronDown, MessageCircleMore } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { InlineFieldError } from "@/components/ui/field-error";
import { AuthShell } from "@/components/auth/AuthShell";
import { AuthFormStack } from "@/components/auth/AuthFormStack";
import { AuthErrorBanner } from "@/components/auth/AuthErrorBanner";
import { AuthSubmitButton } from "@/components/auth/AuthSubmitButton";
import { CountryCodeSheet } from "@/components/auth/CountryCodeSheet";
import { sendPhoneCode } from "@/components/auth/api";
import { DEFAULT_COUNTRY_ISO, countryByIso, type Country } from "@/lib/auth/countries";

/**
 * Step 3 of 5 - "What's your number?". Country selector (bottom sheet /
 * dialog) restricted to the server's supported list
 * (getSupportedPhoneCountries - a server prop from the page, the env
 * never reaches the bundle) + tel input formatted as-you-type in the
 * national format; what we store and send is always E.164. The last-used
 * country is remembered in localStorage (only honored while it stays on
 * the supported list).
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

/** localStorage never notifies - subscribe to nothing. */
const subscribeNever = () => () => {};

function readRememberedIso(): string | null {
  try {
    return localStorage.getItem(PHONE_COUNTRY_KEY);
  } catch {
    return null;
  }
}

function readStoredPhone(): string | null {
  try {
    return sessionStorage.getItem(AUTH_PHONE_KEY);
  } catch {
    return null;
  }
}

function digitsOf(value: string): string {
  return value.replace(/\D/g, "");
}

function formatNational(digits: string, c: Country, tools: PhoneTools | null): string {
  // Until the lazy formatter lands (~100ms) the digits pass through
  // unformatted - same characters, no layout shift, upgraded in place.
  if (!digits) return "";
  return tools ? tools.formatAsYouType(digits, c.iso) : digits;
}

export function PhoneInputStep({ allowedIsos }: { allowedIsos: string[] }) {
  const router = useRouter();
  const tools = usePhoneTools();

  const allowedCountries = useMemo(
    () => allowedIsos.map((iso) => countryByIso(iso)).filter((c): c is Country => c !== null),
    [allowedIsos],
  );
  // IE leads when the supported list contains it (the default full list
  // always does); a narrowed list without IE falls to its first entry.
  // The server page never renders this with an empty list -
  // getSupportedPhoneCountries never resolves to nothing.
  const fallbackCountry =
    allowedCountries.find((c) => c.iso === DEFAULT_COUNTRY_ISO) ?? allowedCountries[0];

  // The remembered country (shared with phone login) arrives
  // hydration-safely (null on the server, the stored ISO on the
  // client) and only counts while it is on the allowlist; an explicit
  // pick this session wins over it.
  const rememberedIso = useSyncExternalStore(subscribeNever, readRememberedIso, () => null);
  const [pickedCountry, setPickedCountry] = useState<Country | null>(null);
  const remembered = allowedCountries.find((c) => c.iso === countryByIso(rememberedIso)?.iso);

  // Coming back from the code screen ("Change number") re-seeds the
  // number that was sent - values entered in a multi-step flow survive
  // back navigation. Hydration-safe (null on the server); anything the
  // user types or picks this session wins over the stored send.
  const storedPhone = useSyncExternalStore(subscribeNever, readStoredPhone, () => null);
  const seeded = useMemo(() => {
    const parsed = storedPhone && tools ? tools.parsePhone(storedPhone) : null;
    const seededCountry = parsed && allowedCountries.find((c) => c.iso === parsed.country);
    return parsed && seededCountry
      ? {
          display: formatNational(String(parsed.nationalNumber), seededCountry, tools),
          country: seededCountry,
        }
      : null;
  }, [storedPhone, allowedCountries, tools]);

  // The seeded number's country outranks the remembered one - the
  // pre-filled digits are only valid under their own dial code.
  const country = pickedCountry ?? seeded?.country ?? remembered ?? fallbackCountry;

  const [sheetOpen, setSheetOpen] = useState(false);
  const [typedDisplay, setTypedDisplay] = useState<string | null>(null);
  const display = typedDisplay ?? seeded?.display ?? "";
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
    setTypedDisplay(formatNational(digitsOf(display), next, tools));
    inputRef.current?.focus();
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
    setTypedDisplay(formatNational(digits, country, tools));
    // Editing the number clears BOTH error layers - after a duplicate
    // (409) the form stays right here and must feel immediately usable.
    if (fieldError) setFieldError(null);
    if (serverError) setServerError(null);
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    const t = tools ?? (await loadPhoneTools());
    const parsed = t.parsePhone(digitsOf(display), country.iso);
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
    // Loading ALWAYS resets before any branch - a failure (duplicate,
    // invalid, rate-limited...) leaves the form editable on this screen.
    setPending(false);
    if (!result.ok) {
      if (result.blocked) setBlocked(true);
      else setServerError(result.message);
      return;
    }
    // This number is already verified on this account - success, no OTP
    // screen; continue straight to the next step of the flow.
    if (result.alreadyVerified && result.next) {
      router.replace(result.next);
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
        <div
          role="status"
          className="border-border bg-foreground/5 rounded-2xl border px-5 py-6 text-center"
        >
          <MessageCircleMore
            className="text-muted-foreground mx-auto mb-3 size-6"
            aria-hidden="true"
          />
          <p className="text-foreground text-sm">Phone verification is temporarily unavailable.</p>
          <p className="text-muted-foreground mt-1.5 text-xs">
            We can&apos;t send codes right now. Please try again in a little while - verifying your
            number is required to continue.
          </p>
        </div>
      ) : (
        <AuthFormStack
          onSubmit={onSubmit}
          field={
            <>
              <Label htmlFor="auth-phone">Phone number</Label>
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
            </>
          }
          status={<AuthErrorBanner message={serverError} />}
          cta={
            <AuthSubmitButton pending={pending} pendingLabel="Sending code..." disabled={pending}>
              Send code
            </AuthSubmitButton>
          }
          footnote="Standard SMS rates may apply."
        />
      )}

      <CountryCodeSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        selectedIso={country.iso}
        onSelect={chooseCountry}
        isos={allowedIsos}
      />
    </AuthShell>
  );
}
