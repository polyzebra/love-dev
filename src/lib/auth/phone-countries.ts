import { countryByIso } from "@/lib/auth/countries";

/**
 * THE per-workflow phone-country allowlists - the single place any env
 * parsing for PHONE_*_COUNTRIES happens. Server flows (phone-login-flow,
 * phone-flow) and the server pages that feed the country picker all read
 * from here; nothing else may parse these envs.
 *
 * Workflows and their env fallback chain (first CONFIGURED value wins;
 * an env that parses to nothing - unset, empty or all junk codes -
 * counts as unconfigured):
 *
 *   kind           | chain
 *   ---------------|--------------------------------------------------
 *   "login"        | PHONE_LOGIN_COUNTRIES -> "IE,GB"
 *   "verification" | PHONE_VERIFICATION_COUNTRIES ->
 *                  |   PHONE_CHANGE_COUNTRIES ->
 *                  |   PHONE_LOGIN_COUNTRIES -> "IE,GB"
 *   "change"       | PHONE_CHANGE_COUNTRIES ->
 *                  |   PHONE_VERIFICATION_COUNTRIES ->
 *                  |   PHONE_LOGIN_COUNTRIES -> "IE,GB"
 *
 * The default is ALWAYS the strict "IE,GB" - never "all countries when
 * unset". Anonymous login is the strictest surface, so it never widens
 * itself by borrowing another workflow's list; the authenticated
 * workflows fall through each other, then to login's list, then to the
 * hard default.
 *
 * WORKFLOW -> CALL-SITE MAPPING: the /auth/phone onboarding verification
 * step and the settings-driven phone change share ONE flow
 * (phone-flow.ts), and that flow enforces workflowCountries("change") -
 * so the /auth/phone page renders the "change" list too, keeping UI and
 * server authority identical. "verification" deliberately defaults to
 * the change list (see the chain above); it only diverges if
 * PHONE_VERIFICATION_COUNTRIES is set explicitly, and exists so a future
 * standalone verification flow has a named list waiting.
 */

export type PhoneWorkflow = "login" | "verification" | "change";

const HARD_DEFAULT = "IE,GB";

const ENV_CHAIN: Record<PhoneWorkflow, string[]> = {
  login: ["PHONE_LOGIN_COUNTRIES"],
  verification: [
    "PHONE_VERIFICATION_COUNTRIES",
    "PHONE_CHANGE_COUNTRIES",
    "PHONE_LOGIN_COUNTRIES",
  ],
  change: ["PHONE_CHANGE_COUNTRIES", "PHONE_VERIFICATION_COUNTRIES", "PHONE_LOGIN_COUNTRIES"],
};

/**
 * "ie, gb,GB,ZZ,123" -> ["IE","GB"]: split, trim, uppercase, dedupe
 * (first occurrence keeps its position - order matters, the UI treats
 * the first entry as the default country), then keep only ISO codes that
 * exist in the shared dataset (countries.ts - real, nameable, dialable
 * regions). Junk in the env can therefore never widen or corrupt a list.
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

/**
 * The enabled ISO country codes for a workflow, in env order (first =
 * the UI's default country). Reads process.env on every call - no
 * module-level cache - so tests and per-request server rendering always
 * see the current environment.
 */
export function workflowCountries(kind: PhoneWorkflow): string[] {
  for (const key of ENV_CHAIN[kind]) {
    const parsed = parseIsoList(process.env[key]);
    if (parsed.length > 0) return parsed;
  }
  return parseIsoList(HARD_DEFAULT);
}

/** Set-shaped view for the flows' per-number membership checks. */
export function workflowCountrySet(kind: PhoneWorkflow): ReadonlySet<string> {
  return new Set(workflowCountries(kind));
}
