/**
 * trust:rehearsal - the internal Trust rehearsal CLI (Epic 5). Supported-tool
 * entry point; no manual DB edits.
 *
 *   npm run trust:rehearsal                 preflight (PASS/WARN/FAIL), exit 3 if not ready
 *   npm run trust:rehearsal -- --json       machine-readable preflight
 *   npm run trust:rehearsal -- --rollback --subject <id> [--subject <id>]
 *                                           deterministic cleanup of rehearsal subjects
 *
 * The full automated lifecycle run (mock provider) is exercised by
 * tests/trust-rehearsal.test.ts - the canonical, reproducible rehearsal. A real
 * operator-driven AWS rehearsal uses this preflight + the admin binding queue.
 *
 * Exit: 0 ready/ok - 2 crash - 3 preflight FAIL.
 */
import "dotenv/config";

const argv = process.argv.slice(2);
const JSON_ONLY = argv.includes("--json");
const values = (flag: string) =>
  argv.reduce<string[]>(
    (acc, a, i) => (a === flag && argv[i + 1] ? [...acc, argv[i + 1]] : acc),
    [],
  );

async function main() {
  const { preflight, rollbackRehearsal } = await import("../src/lib/services/trust-rehearsal");

  if (argv.includes("--rollback")) {
    const subjectIds = values("--subject");
    if (subjectIds.length === 0) {
      console.error("--rollback needs at least one --subject <id>");
      process.exit(2);
    }
    const r = await rollbackRehearsal({ subjectIds });
    console.log(JSON.stringify(r, null, JSON_ONLY ? 0 : 2));
    process.exit(0);
  }

  const pf = preflight();
  if (JSON_ONLY) {
    console.log(JSON.stringify(pf));
  } else {
    console.log("Trust rehearsal - preflight\n");
    for (const c of pf.checks) console.log(`  [${c.status}] ${c.id}\n         ${c.detail}`);
    console.log(`\n  => ${pf.ok ? "READY" : "NOT READY - a required blocker exists"}`);
  }
  process.exit(pf.ok ? 0 : 3);
}

main().catch((error) => {
  console.error(`trust:rehearsal crashed: ${error instanceof Error ? error.message : error}`);
  process.exit(2);
});
