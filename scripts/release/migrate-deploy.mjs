/**
 * db:migrate:deploy - stage 3 of the release contract. Applies pending
 * migrations to Production using the DIRECT_URL connection, fail-closed.
 * This is the step whose ABSENCE caused the incident (app shipped ahead of
 * its schema). It runs BEFORE the app build is activated.
 *
 *   node scripts/release/migrate-deploy.mjs
 *
 * Fails (non-zero, no activation) when:
 *   - DIRECT_URL missing / malformed / not database `postgres`
 *   - runtime & migration targets are different projects (via preflight)
 *   - Prisma reports a FAILED migration (P3009) - requires manual recovery
 *   - migrate deploy returns non-zero for any reason
 * Idempotent: a clean DB yields "No pending migrations" and exits 0, so a
 * retry after an infrastructure blip is safe.
 */
import "./_env.mjs";
import { prismaMigrate } from "./_env.mjs";
import { assertReleaseTargets, ReleaseConfigError } from "./validate.mjs";

try {
  // Never deploy without the same guarantees preflight enforces.
  const { direct } = assertReleaseTargets(process.env);
  console.log(`migrate deploy -> ${direct.redacted}`);
} catch (err) {
  if (err instanceof ReleaseConfigError) {
    console.error(`MIGRATE DEPLOY REFUSED: ${err.message}`);
    process.exit(1);
  }
  throw err;
}

const run = prismaMigrate(["migrate", "deploy"]);
const out = run.stdout + "\n" + run.stderr;

// A failed migration in history (P3009) must never be auto-resolved here.
if (/P3009|failed migrations?/i.test(out)) {
  console.error(
    "MIGRATE DEPLOY FAILED: a failed migration is recorded in history. " +
      "Do NOT auto-resolve. Follow docs/DB-MIGRATION-RECOVERY.md.",
  );
  process.exit(1);
}

for (const l of out
  .split("\n")
  .map((l) => l.trim())
  .filter(Boolean)) {
  if (/migration|already in sync|No pending|applied|up to date/i.test(l)) console.log(`  ${l}`);
}

if (run.status !== 0) {
  console.error(
    `MIGRATE DEPLOY FAILED (exit ${run.status}). Release stopped; app build NOT activated.`,
  );
  process.exit(run.status ?? 1);
}
console.log("migrate deploy OK");
process.exit(0);
