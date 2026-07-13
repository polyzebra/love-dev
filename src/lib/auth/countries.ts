// Types only from libphonenumber-js (erased at compile time - the 40 KB
// metadata blob must NEVER enter client bundles from here, Phase 0J).
// The ISO -> dial-code facts come from the GENERATED static table
// (countries-data.ts, from scripts/generate-countries.mjs), which keeps
// this dataset the one source of truth for server allowlists
// (phone-countries.ts) and the UI alike without shipping metadata.
import type { CountryCode } from "libphonenumber-js/core";
import { COUNTRY_DIAL_CODES } from "@/lib/auth/countries-data";

/**
 * Country metadata for the phone step - ISO/dial codes from the generated
 * libphonenumber table + Intl.DisplayNames for human names + flag emoji
 * computed from the ISO code. Nothing is hand-typed; regenerate the table
 * when the library updates.
 */

export type Country = {
  /** ISO 3166-1 alpha-2, e.g. "IE". */
  iso: CountryCode;
  /** English display name, e.g. "Ireland". */
  name: string;
  /** Calling code with plus, e.g. "+353". */
  dialCode: string;
  /** Flag emoji from regional indicator symbols. */
  flag: string;
};

export const DEFAULT_COUNTRY_ISO: CountryCode = "IE";

/** Where most of our members are - pinned to the top of the sheet. */
export const POPULAR_ISOS: CountryCode[] = [
  "IE",
  "GB",
  "LV",
  "LT",
  "PL",
  "RO",
  "DE",
  "FR",
  "ES",
  "US",
];

/** "IE" -> regional indicators U+1F1EE U+1F1EA -> the flag emoji. */
function flagEmoji(iso: string): string {
  return String.fromCodePoint(
    ...[...iso.toUpperCase()].map((ch) => 0x1f1e6 + ch.charCodeAt(0) - 65),
  );
}

const regionNames = new Intl.DisplayNames(["en"], { type: "region" });

function nameOf(iso: string): string | null {
  try {
    const name = regionNames.of(iso);
    // DisplayNames echoes the code back for regions it can't name
    // (e.g. "AC" Ascension) - those rows would be noise, drop them.
    return name && name !== iso ? name : null;
  } catch {
    return null;
  }
}

/** Every nameable country, alphabetical by English name. */
export const COUNTRIES: Country[] = COUNTRY_DIAL_CODES.flatMap(([iso, code]): Country[] => {
  const name = nameOf(iso);
  return name
    ? [
        {
          iso: iso as CountryCode,
          name,
          dialCode: `+${code}`,
          flag: flagEmoji(iso),
        },
      ]
    : [];
}).sort((a, b) => a.name.localeCompare(b.name));

const byIso = new Map(COUNTRIES.map((c) => [c.iso as string, c]));

export function countryByIso(iso: string | null | undefined): Country | null {
  return (iso && byIso.get(iso.toUpperCase())) || null;
}

export const POPULAR_COUNTRIES: Country[] = POPULAR_ISOS.flatMap((iso) => {
  const c = byIso.get(iso);
  return c ? [c] : [];
});

/**
 * Matches name ("irela"), ISO code ("IE"/"ie") and dial code with or
 * without the plus ("353" | "+353"). Empty query matches everything.
 */
export function matchesCountry(country: Country, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const digits = q.startsWith("+") ? q.slice(1) : q;
  if (/^\d+$/.test(digits)) return country.dialCode.slice(1).startsWith(digits);
  return country.name.toLowerCase().includes(q) || country.iso.toLowerCase().startsWith(q);
}
