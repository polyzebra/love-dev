import { COUNTRIES, countryByIso } from "@/lib/auth/countries";

/**
 * THE phone-country support model - the single place any env parsing for
 * SUPPORTED_PHONE_COUNTRIES / PHONE_*_COUNTRIES happens. Server flows
 * (phone-login-flow, phone-flow) and the server pages that feed the
 * country picker all read from here; nothing else may parse these envs.
 *
 * Resolution, per workflow:
 *
 *   BASE   = SUPPORTED_PHONE_COUNTRIES when it parses to anything,
 *            else EVERY country in the shared dataset (countries.ts,
 *            alphabetical by English name). The verification capability
 *            is Twilio Verify, which delivers worldwide - so "supported"
 *            defaults to the full dataset unless narrowed deliberately.
 *   RESULT = intersection(BASE, per-workflow override) when the
 *            workflow's env is set, else BASE.
 *
 *   workflow       | narrowing override env
 *   ---------------|------------------------------
 *   "login"        | PHONE_LOGIN_COUNTRIES
 *   "verification" | PHONE_VERIFICATION_COUNTRIES
 *   "change"       | PHONE_CHANGE_COUNTRIES
 *
 * Overrides can only NARROW: codes outside the base are dropped, never
 * added - a workflow can never widen itself beyond what the product
 * supports. An env that parses to nothing (unset, empty, all junk, or
 * an override that intersects the base to nothing) counts as
 * unconfigured, so the result is never an empty list. With every env
 * unset, login, verification and change all resolve to the IDENTICAL
 * full list. There is no hard-coded country default anywhere.
 *
 * WORKFLOW -> CALL-SITE MAPPING: the /auth/phone onboarding verification
 * step and the settings-driven phone change share ONE flow
 * (phone-flow.ts), and that flow enforces
 * getSupportedPhoneCountries("change") - so the /auth/phone page renders
 * the "change" list too, keeping UI and server authority identical.
 * "verification" exists so a future standalone verification flow has a
 * named override waiting; until one is set it equals the base like the
 * others.
 */

export type PhoneWorkflow = "login" | "verification" | "change";

const OVERRIDE_ENV: Record<PhoneWorkflow, string> = {
  login: "PHONE_LOGIN_COUNTRIES",
  verification: "PHONE_VERIFICATION_COUNTRIES",
  change: "PHONE_CHANGE_COUNTRIES",
};

/**
 * "ie, gb,GB,ZZ,123" -> ["IE","GB"]: split, trim, uppercase, dedupe
 * (first occurrence keeps its position - order matters, the UI treats
 * the first entry as the default country), then keep only ISO codes that
 * exist in the shared dataset (countries.ts - real, nameable, dialable
 * regions). Junk in an env can therefore never widen or corrupt a list.
 */
function parseIsoList(raw: string | undefined): string[] {
  if (!raw) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const part of raw.split(",")) {
    const iso = part.trim().toUpperCase();
    if (!iso || seen.has(iso)) continue;
    seen.add(iso);
    if (countryByIso(iso)) out.push(iso);
  }
  return out;
}

/** The shared base list every workflow starts from (see module doc). */
function baseCountries(): string[] {
  const configured = parseIsoList(process.env.SUPPORTED_PHONE_COUNTRIES);
  if (configured.length > 0) return configured;
  // Full dataset, already alphabetical by name - the UI's order; the
  // sheet handles popular pinning itself.
  return COUNTRIES.map((c) => c.iso as string);
}

/**
 * The enabled ISO country codes for a workflow. Reads process.env on
 * every call - no module-level cache - so tests and per-request server
 * rendering always see the current environment. Server pages pass this
 * exact list to the client picker as a prop, and the flows validate
 * against the same call: frontend and backend can never disagree.
 */
export function getSupportedPhoneCountries(workflow: PhoneWorkflow): string[] {
  const base = baseCountries();
  const override = parseIsoList(process.env[OVERRIDE_ENV[workflow]]);
  if (override.length === 0) return base;
  const inBase = new Set(base);
  const narrowed = override.filter((iso) => inBase.has(iso));
  // An override entirely outside the base is a misconfiguration, not a
  // wish for an empty product - treat it as unconfigured.
  return narrowed.length > 0 ? narrowed : base;
}

/** Set-shaped view for the flows' per-number membership checks. */
export function getSupportedPhoneCountrySet(workflow: PhoneWorkflow): ReadonlySet<string> {
  return new Set(getSupportedPhoneCountries(workflow));
}
