/**
 * Test runner: sequential tsx suites with lane selection and a summary.
 *
 *   node scripts/run-tests.mjs            all suites (unit + integration + live)
 *   node scripts/run-tests.mjs unit       no-DB source-contract suites
 *   node scripts/run-tests.mjs integration DB-backed suites (Prisma only;
 *                                          external transports injected)
 *   node scripts/run-tests.mjs live       suites that construct real
 *                                          Supabase clients (need live creds)
 *
 * Lanes are explicit so CI can gate them differently: `unit` needs no
 * environment at all; `integration` needs a migrated Postgres and dummy
 * provider env; `live` needs real Supabase credentials.
 */
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";

const LIVE = new Set([
  // Construct real @supabase/supabase-js clients (auth admin API).
  "admin-authz.test.ts",
  "auth-cleanup.test.ts",
  "identity-invariants.test.ts",
  "phone-sync.test.ts",
  "bearer-live.test.ts",
  "api-v1.test.ts",
  "api-0e.test.ts",
  "api-0f.test.ts",
  "api-0g.test.ts",
  "api-0h.test.ts",
  "api-0i.test.ts",
  "critical-flows.test.ts",
  "bio.test.ts",
  "photo-verification.test.ts",
  "verification-hardening.test.ts",
  "verification-e2e-guards.test.ts",
  "verification-continue.test.ts",
  "face-verification.test.ts",
  "face-security.test.ts",
  "face-chaos.test.ts",
  "face-final-blockers.test.ts",
  "face-remediation.test.ts",
  "face-consent-withdrawal.test.ts",
  "face-consent-liveness-guard.test.ts",
  "face-emergency-disable.test.ts",
  "face-identity-binding.test.ts",
  "photo-grant.test.ts",
  "face-binding-engine.test.ts",
  "human-review-binding.test.ts",
  "trust-rehearsal.test.ts",
  "trust-activation.test.ts",
  "trust-hardening.test.ts",
  "activation-blockers.test.ts",
  "ops-alerts.test.ts",
  "face-rehearsal.test.ts",
  "face-storage-bucket.test.ts",
  "face-badge-trust.test.ts",
  "face-cache-cover-role.test.ts",
]);

const UNIT = new Set([
  // Pure source-contract suites - no DB import, no env needed.
  "legal-typography.test.ts",
  "legal-integration.test.ts",
  "activation-legal-gate.test.ts",
  "calibration-tooling.test.ts",
  "auth-form-stack.test.ts",
  "rate-limit.test.ts",
  "architecture.test.ts",
  "thread-store.test.ts",
  "verification-notice.test.ts",
  "verification-consistency.test.ts",
  "auth-url.test.ts",
  "billing-ui.test.ts",
  "login-routes.test.ts",
  "notifications-web-surface.test.ts",
  "auth-transport.test.ts",
  "api-contract.test.ts",
  "otp-email.test.ts",
  "login-view.test.ts",
  "login-entry-lifecycle.test.ts",
  "verification-badge-consistency.test.ts",
  "face-internal-allowlist.test.ts",
  "face-outcomes.test.ts",
  "face-badge-helpers.test.ts",
  "verification-presentation.test.ts",
  "face-binding-platform.test.ts",
  "support-request.test.ts",
  "global-scope.test.ts",
  "public-layout.test.ts",
  "gallery-integrity.test.ts",
  "verification-state-machine.test.ts",
  "trust-contract-governance.test.ts",
  "legal-navigation-governance.test.ts",
  "link-integrity.test.ts",
  "prisma-migration-drift.test.ts",
  "migration-portability.test.ts",
  "release-gate.test.ts",
  "release-governance.test.ts",
  "registration-state-machine.test.ts",
  "registration-governance.test.ts",
  "activation-contract.test.ts",
  "seo-integrity.test.ts",
]);

const lane = process.argv[2] ?? "all";
const all = readdirSync("tests")
  .filter((f) => f.endsWith(".test.ts"))
  .sort();

const selected = all.filter((f) => {
  if (lane === "unit") return UNIT.has(f);
  if (lane === "live") return LIVE.has(f);
  if (lane === "integration") return !UNIT.has(f) && !LIVE.has(f);
  return true; // all
});

if (selected.length === 0) {
  console.error(`No suites in lane "${lane}" (valid: unit, integration, live, all)`);
  process.exit(2);
}

let failed = 0;
const results = [];
for (const file of selected) {
  const started = Date.now();
  const run = spawnSync("npx", ["tsx", `tests/${file}`], {
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8",
  });
  const ok = run.status === 0;
  if (!ok) failed++;
  const summary =
    (run.stdout + run.stderr)
      .split("\n")
      .reverse()
      .find((l) => /passed|FAILED|Error/.test(l))
      ?.trim() ?? `(exit ${run.status})`;
  results.push({ file, ok, ms: Date.now() - started, summary });
  console.log(`${ok ? "PASS" : "FAIL"}  ${file}  (${Date.now() - started}ms)  ${summary}`);
  if (!ok) {
    // Full output for failures only - keeps green runs readable.
    console.log(run.stdout);
    console.error(run.stderr);
  }
}

console.log(
  `\n${lane}: ${results.length - failed}/${results.length} suites passed` +
    (failed ? ` - ${failed} FAILED` : ""),
);
process.exit(failed ? 1 : 0);
