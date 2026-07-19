/**
 * L7.3.2 Phase G - schema/migration drift guard. CI FAILS if the Prisma schema
 * (hence the generated client the app deploys) declares a column that NO
 * committed migration creates. This catches the "changed the model + regenerated
 * the client, but forgot the migration" class before it ships.
 *
 * IMPORTANT scope note: this guard proves migrations EXIST for every column. It
 * does NOT prove they were APPLIED to a given database - that is the deploy
 * pipeline's job (`prisma migrate deploy` / db:apply-migration). The P2022
 * production incident was an UNAPPLIED (not a missing) migration; see the report.
 *
 * Pure source-contract; no DB. Focused on the drift surface that broke
 * (User + Verification), which is also where request-path reads live.
 *   npx tsx tests/prisma-migration-drift.test.ts
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

const SCHEMA = readFileSync("prisma/schema.prisma", "utf8");

/** All model + enum names, so we can tell a scalar/enum column from a relation. */
function namesOf(kind: "model" | "enum"): Set<string> {
  const out = new Set<string>();
  for (const m of SCHEMA.matchAll(new RegExp(`^${kind}\\s+(\\w+)\\s*\\{`, "gm"))) out.add(m[1]);
  return out;
}
const MODELS = namesOf("model");

/** Extract the DB column names for a model block (relations excluded). */
function columnsOf(model: string): string[] {
  const start = SCHEMA.indexOf(`model ${model} {`);
  const end = SCHEMA.indexOf("\n}", start);
  const block = SCHEMA.slice(start, end);
  const cols: string[] = [];
  for (const line of block.split("\n")) {
    const m = line.match(/^\s+(\w+)\s+(\w+)(\[\])?\??/);
    if (!m) continue;
    const [, field, type] = m;
    if (field === model) continue;
    // A relation's type is another MODEL -> not a column. Scalars + enums are columns.
    if (MODELS.has(type)) continue;
    // Skip block attributes like @@index (they start with @, not caught above).
    cols.push(field);
  }
  return cols;
}

/** Concatenated migration SQL (all committed migrations). */
function allMigrationSql(): string {
  const dir = "prisma/migrations";
  let sql = "";
  for (const e of readdirSync(dir)) {
    const p = join(dir, e, "migration.sql");
    try {
      sql += "\n" + readFileSync(p, "utf8");
    } catch {
      /* not a migration dir */
    }
  }
  return sql;
}

function main() {
  const migrations = allMigrationSql();
  // The models most exposed on the request path (a missing column here 500s a
  // core flow, as galleryVersion did to OTP verify via ensureAppUser).
  for (const model of ["User", "Verification"]) {
    check(`every ${model} column is created by some migration (no schema>migration drift)`, () => {
      const missing = columnsOf(model).filter((c) => !new RegExp(`"${c}"`).test(migrations));
      assert.deepEqual(
        missing,
        [],
        `${model} columns declared in schema but created by NO migration: ${missing.join(", ")}`,
      );
    });
  }

  // Regression pin: the exact column from the P2022 incident is migration-backed.
  check("User.galleryVersion (P2022 incident) is created by a migration", () => {
    assert.ok(
      /ADD COLUMN "galleryVersion"/.test(migrations),
      "galleryVersion must be added by a migration",
    );
  });

  console.log(`\n${passed} checks passed`);
}

main();
