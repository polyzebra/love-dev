/**
 * db:apply-migration - the project's sanctioned mechanism for applying a
 * committed, forward-only migration to a database on which the Prisma CLI
 * hangs (documented house limitation). It is NOT a general query path and is
 * NEVER invoked from a request path, server component, API route, or app
 * startup - only run deliberately from a terminal / deploy step.
 *
 *   npm run db:apply-migration -- <migration_dir_name>            # DRY-RUN (default)
 *   npm run db:apply-migration -- <migration_dir_name> --confirm  # apply
 *
 * Safety (Approval B): dry-run by default; explicit --confirm to write; a
 * Postgres ADVISORY LOCK so two applies never race; the SQL is read from the
 * committed prisma/migrations/<dir>/migration.sql (idempotent, ADD ... IF NOT
 * EXISTS, no destructive statements); post-apply verification; exit non-zero
 * on any failure. It executes ONLY the committed file - it never composes DDL.
 */
import "dotenv/config";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";

const ADVISORY_LOCK_KEY = 748219; // stable app-specific migration lock id

const argv = process.argv.slice(2);
const dir = argv.find((a) => !a.startsWith("--"));
const CONFIRM = argv.includes("--confirm");

// Post-apply verification for known migrations: (name) -> checks that prove
// the additive objects exist. Keeps the script honest about what "applied"
// means without re-parsing SQL.
const VERIFY: Record<string, { sql: string; expect: string }[]> = {
  "20260719060000_face_identity_binding": [
    {
      sql: `SELECT 1 FROM information_schema.columns WHERE table_name='User' AND column_name='faceVerifiedAt'`,
      expect: "User.faceVerifiedAt column",
    },
    {
      sql: `SELECT 1 FROM information_schema.tables WHERE table_name='FaceIdentityBinding'`,
      expect: "FaceIdentityBinding table",
    },
    {
      sql: `SELECT 1 FROM pg_type WHERE typname='FaceBindingStatus'`,
      expect: "FaceBindingStatus enum",
    },
    {
      sql: `SELECT 1 FROM pg_indexes WHERE indexname='FaceIdentityBinding_livenessFlowId_key'`,
      expect: "one-binding-per-flow unique index",
    },
  ],
};

function assertSafe(sql: string): void {
  // No destructive statements in a committed forward-only migration.
  const banned =
    /\b(DROP\s+(TABLE|COLUMN|TYPE|INDEX|CONSTRAINT|DATABASE|SCHEMA)|TRUNCATE|DELETE\s+FROM|ALTER\s+TABLE\s+\S+\s+DROP)\b/i;
  if (banned.test(sql)) {
    throw new Error("Refusing to apply: migration contains a destructive statement.");
  }
}

async function main() {
  if (!dir) {
    console.error("usage: db:apply-migration -- <migration_dir_name> [--confirm]");
    process.exit(2);
  }
  const url = process.env.DATABASE_URL?.trim();
  if (!url) {
    console.error("DATABASE_URL is not set.");
    process.exit(2);
  }
  const path = join("prisma", "migrations", dir, "migration.sql");
  const sql = readFileSync(path, "utf8");
  assertSafe(sql);

  console.log(`migration : ${dir}`);
  console.log(`file      : ${path} (${sql.length} bytes)`);
  console.log(`mode      : ${CONFIRM ? "APPLY (--confirm)" : "DRY-RUN"}`);

  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    // Advisory lock: serialize applies; non-blocking probe so a stuck holder
    // is visible rather than hanging forever.
    const lock = await client.query("SELECT pg_try_advisory_lock($1) AS got", [ADVISORY_LOCK_KEY]);
    if (!lock.rows[0]?.got) {
      console.error("Another migration apply holds the advisory lock. Aborting.");
      process.exit(3);
    }

    if (!CONFIRM) {
      console.log("\nDRY-RUN: nothing written. Re-run with --confirm to apply.");
      // Still report current verification state so the operator sees the delta.
      await report(client, dir);
      return;
    }

    // The committed SQL is itself idempotent (IF NOT EXISTS / guarded DO
    // blocks); run it in one transaction so a mid-failure rolls back cleanly.
    await client.query("BEGIN");
    await client.query(sql);
    await client.query("COMMIT");
    console.log("\napplied.");
    const ok = await report(client, dir);
    if (!ok) {
      console.error("post-apply verification FAILED.");
      process.exit(1);
    }
    console.log("post-apply verification OK.");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    console.error(`apply failed: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [ADVISORY_LOCK_KEY]).catch(() => {});
    await client.end();
  }
}

async function report(client: Client, name: string): Promise<boolean> {
  const checks = VERIFY[name];
  if (!checks) {
    console.log("(no verification checks registered for this migration)");
    return true;
  }
  let ok = true;
  console.log("\nverification:");
  for (const c of checks) {
    const r = await client.query(c.sql);
    const present = (r.rowCount ?? 0) > 0;
    if (!present) ok = false;
    console.log(`  [${present ? "PRESENT" : "MISSING"}] ${c.expect}`);
  }
  return ok;
}

main().catch((error) => {
  console.error(`db:apply-migration crashed: ${error instanceof Error ? error.message : error}`);
  process.exit(1);
});
