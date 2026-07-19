/**
 * release:production - the pre-activation DATABASE gate, run in order and
 * fail-closed. This is the portion that MUST complete before a new app build
 * is activated (the incident happened because it didn't exist):
 *
 *   1. preflight      - config validation (DIRECT_URL/DATABASE_URL sane, same project)
 *   2. migrate deploy - apply pending migrations via DIRECT_URL
 *   3. schema verify  - status clean, history intact, galleryVersion present
 *
 * The app BUILD, Vercel DEPLOY, and SMOKE stages run around this in CI
 * (.github/workflows/ci.yml deploy job): build+deploy happen only after this
 * exits 0, and smoke runs after the deployment is Ready. Any non-zero here
 * stops the release and leaves the previous healthy deployment active.
 *
 *   node scripts/release/production.mjs
 */
import { spawnSync } from "node:child_process";

const stages = [
  ["preflight", "scripts/release/preflight.mjs"],
  ["migrate-deploy", "scripts/release/migrate-deploy.mjs"],
  ["schema-verify", "scripts/release/schema-verify.mjs"],
];

for (const [name, path] of stages) {
  console.log(`\n=== release stage: ${name} ===`);
  const run = spawnSync("node", [path], { stdio: "inherit", env: process.env });
  if (run.status !== 0) {
    console.error(`\nRELEASE STOPPED at '${name}' (exit ${run.status}). App build NOT activated.`);
    process.exit(run.status ?? 1);
  }
}
console.log(
  "\nDB release gate: GO - migrations applied and schema verified. Safe to build + deploy.",
);
process.exit(0);
