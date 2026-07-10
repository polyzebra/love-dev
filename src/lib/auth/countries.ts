// The "core" build with explicit metadata - same reasoning as
// phone-flow.ts: the bundled builds (min/max) resolve their metadata
// through an ESM/CJS interop shim that breaks under tsx (tests) while
// working under Next. core + an explicit JSON import behaves identically
// everywhere, which is what lets this dataset be THE one source of truth
// for server allowlists (phone-countries.ts) and the UI alike.
import {
  getCountries,
  getCountryCallingCode,
  type CountryCode,
  type MetadataJson,
} from "libphonenumber-js/core";
import metadataJson from "libphonenumber-js/metadata.min.json";

const phoneMetadata = metadataJson as unknown as MetadataJson;

/**
 * Country metadata for the phone step - derived entirely from
 * libphonenumber-js metadata (every dialable region) + Intl.DisplayNames
 * for human names + flag emoji computed from the ISO code. Nothing is
 * hand-typed, so the list stays correct when the library updates.
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
  "IE", "GB", "LV", "LT", "PL", "RO", "DE", "FR", "ES", "US",
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
export const COUNTRIES: Country[] = getCountries(phoneMetadata)
  .flatMap((iso): Country[] => {
    const name = nameOf(iso);
    return name
      ? [
          {
            iso,
            name,
            dialCode: `+${getCountryCallingCode(iso, phoneMetadata)}`,
            flag: flagEmoji(iso),
          },
        ]
      : [];
  })
  .sort((a, b) => a.name.localeCompare(b.name));

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
  return (
    country.name.toLowerCase().includes(q) ||
    country.iso.toLowerCase().startsWith(q)
  );
}
