/**
 * CI guard: no secret may ever ship under NEXT_PUBLIC_.
 *
 * Two checks:
 *  1. Every NEXT_PUBLIC_* name referenced anywhere in src/ or
 *     .env.example must be on the explicit allowlist below (all values
 *     that are public BY DESIGN). A new NEXT_PUBLIC var fails CI until
 *     a human adds it here - that review moment is the control.
 *  2. No NEXT_PUBLIC name may contain a secret-smelling token
 *     (SECRET, SERVICE_ROLE, PRIVATE, WEBHOOK, TOKEN, PASSWORD) even if
 *     someone adds it to the allowlist by mistake.
 */
import { execSync } from "node:child_process";

const ALLOWLIST = new Set([
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY", // anon key is designed-public (RLS/storage scope)
  "NEXT_PUBLIC_APP_URL",
  "NEXT_PUBLIC_SITE_URL",
  "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY", // publishable by definition
  "NEXT_PUBLIC_VAPID_PUBLIC_KEY", // public half of the VAPID pair
  "NEXT_PUBLIC_APPLE_LOGIN_ENABLED",
  "NEXT_PUBLIC_APPLE_OAUTH",
  "NEXT_PUBLIC_EMAIL_OTP_LENGTH",
  "NEXT_PUBLIC_MANUAL_LINKING_ENABLED",
]);

const FORBIDDEN = /SECRET|SERVICE_ROLE|PRIVATE|WEBHOOK|TOKEN|PASSWORD/i;

const grep = execSync(
  "grep -rhoE 'NEXT_PUBLIC_[A-Z0-9_]+' src .env.example 2>/dev/null | sort -u",
  { encoding: "utf8" },
);
const found = grep.split("\n").filter(Boolean);

const problems = [];
for (const name of found) {
  if (!ALLOWLIST.has(name)) {
    problems.push(`${name}: not on the public-env allowlist (scripts/check-public-env.mjs)`);
  }
  if (FORBIDDEN.test(name.replace(/^NEXT_PUBLIC_/, ""))) {
    problems.push(`${name}: name contains a secret-smelling token - never NEXT_PUBLIC`);
  }
}

if (problems.length) {
  console.error("Forbidden NEXT_PUBLIC usage:\n" + problems.map((p) => `  - ${p}`).join("\n"));
  process.exit(1);
}
console.log(`public-env check OK (${found.length} NEXT_PUBLIC names, all allowlisted)`);
