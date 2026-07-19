/**
 * L7.3.3 Phase F - migration portability governance. CI FAILS if the realtime
 * chat-authorization migration (or any future one touching the `realtime`
 * schema) references Realtime objects UNGUARDED - the class that raised P3018
 * (`schema "realtime" does not exist`) on a database without Supabase Realtime,
 * blocking every later migration.
 *
 * Source-contract (no DB): a live Postgres proof (apply with & without the
 * realtime schema, twice for idempotency) runs in the CI `prisma` job against
 * ephemeral postgres:16 - which itself has NO realtime schema, so a green
 * migrate-deploy there IS the portability proof.
 *   npx tsx tests/migration-portability.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ok - ${name}`);
}

const REALTIME_MIG = "prisma/migrations/20260713150000_realtime_chat_authorization/migration.sql";
const read = (p: string) => readFileSync(p, "utf8");

/** Strip line comments so guards match executable SQL only. */
const noComments = (sql: string) =>
  sql
    .split("\n")
    .filter((l) => !/^\s*--/.test(l))
    .join("\n");

function main() {
  const sql = read(REALTIME_MIG);
  const exec = noComments(sql);

  check("the realtime policy is guarded by to_regclass('realtime.messages')", () => {
    assert.ok(
      /to_regclass\('realtime\.messages'\)\s+IS NOT NULL/.test(exec),
      "policy must be guarded so a missing realtime schema is a no-op",
    );
    assert.ok(
      /to_regnamespace\('realtime'\)\s+IS NOT NULL/.test(exec),
      "schema presence must be checked",
    );
  });

  check("no UNGUARDED realtime.messages DDL at statement top level (parse-safe)", () => {
    // Every realtime.messages reference must live inside an EXECUTE '...'/$policy$
    // dynamic-SQL string, never a bare top-level CREATE/DROP POLICY ... ON
    // realtime.messages (which parse-fails when the relation is absent).
    for (const stmt of exec.split(";")) {
      if (/\brealtime\.messages\b/.test(stmt) && /^\s*(CREATE|DROP)\s+POLICY/i.test(stmt.trim())) {
        assert.fail(`unguarded realtime.messages policy DDL: ${stmt.trim().slice(0, 60)}`);
      }
    }
  });

  check(
    "the public helper is CREATE OR REPLACE (idempotent) and PUBLIC revoke is unconditional",
    () => {
      assert.ok(
        /CREATE OR REPLACE FUNCTION public\.realtime_can_join_conversation/.test(exec),
        "helper must be CREATE OR REPLACE",
      );
      assert.ok(/REVOKE ALL ON FUNCTION[^\n]*FROM public/.test(exec), "revoke from PUBLIC");
    },
  );

  check("Realtime-coupled role grants are guarded by pg_roles existence", () => {
    for (const role of ["anon", "authenticated", "supabase_realtime_admin"]) {
      assert.ok(
        new RegExp(`pg_roles WHERE rolname = '${role}'`).test(exec),
        `${role} grant/revoke must be guarded (role may be absent)`,
      );
    }
  });

  check("does NOT fabricate an empty realtime schema", () => {
    assert.ok(
      !/CREATE\s+SCHEMA\s+(IF NOT EXISTS\s+)?realtime\b/i.test(exec),
      "never CREATE SCHEMA realtime",
    );
  });

  // Repo-wide: no OTHER migration references the realtime schema unguarded.
  check("no other migration references realtime.* unguarded", () => {
    const dir = "prisma/migrations";
    const offenders: string[] = [];
    for (const e of readdirSync(dir)) {
      const p = join(dir, e, "migration.sql");
      let m: string;
      try {
        m = noComments(readFileSync(p, "utf8"));
      } catch {
        continue;
      }
      if (!/\brealtime\./.test(m)) continue;
      const guarded =
        /to_regclass\('realtime\.messages'\)/.test(m) || /to_regnamespace\('realtime'\)/.test(m);
      for (const stmt of m.split(";")) {
        if (
          /\brealtime\.messages\b/.test(stmt) &&
          /^\s*(CREATE|DROP)\s+POLICY/i.test(stmt.trim()) &&
          !guarded
        ) {
          offenders.push(e);
        }
      }
    }
    assert.deepEqual([...new Set(offenders)], [], "all realtime.* DDL must be guarded");
  });

  console.log(`\n${passed} checks passed`);
}

main();
