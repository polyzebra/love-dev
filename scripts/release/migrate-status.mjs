/**
 * db:migrate:status - report Prisma migration status against the production
 * DIRECT_URL (session/direct connection). Read-only. Redacted output.
 *
 *   node scripts/release/migrate-status.mjs
 * Exit code mirrors `prisma migrate status` (non-zero => pending/failed).
 */
import "./_env.mjs";
import { prismaMigrate } from "./_env.mjs";
import { parsePgUrl } from "./validate.mjs";

const direct = parsePgUrl(process.env.DIRECT_URL, "DIRECT_URL");
console.log(`migrate status -> ${direct.redacted}`);

const run = prismaMigrate(["migrate", "status"]);
// Surface only the human-readable status lines, never the connection banner.
const line = (run.stdout + "\n" + run.stderr)
  .split("\n")
  .map((l) => l.trim())
  .filter((l) =>
    /up to date|pending|following migration|failed|not yet been applied|Database schema/i.test(l),
  );
for (const l of line) console.log(`  ${l}`);
process.exit(run.status ?? 1);
