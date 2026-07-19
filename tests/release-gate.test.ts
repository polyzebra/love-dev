/**
 * L7.3.7 - release gate contract (unit, no DB). Proves the fail-closed
 * configuration validation that guards production migrations: the pure
 * validator in scripts/release/validate.mjs. These are the source-of-truth
 * checks behind `release:preflight` / `db:migrate:deploy`.
 *
 *   npx tsx tests/release-gate.test.ts
 */
import assert from "node:assert/strict";
import {
  parsePgUrl,
  assertReleaseTargets,
  ReleaseConfigError,
} from "../scripts/release/validate.mjs";

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ok - ${name}`);
}

const REF = "lgalzviotxultelgmssh";
const PROD_DIRECT = `postgresql://postgres.${REF}:s3cr3tP%40ss@aws-0-eu-west-1.pooler.supabase.com:5432/postgres`;
const PROD_RUNTIME = `postgresql://postgres.${REF}:s3cr3tP%40ss@aws-0-eu-west-1.pooler.supabase.com:6543/postgres?pgbouncer=true`;

function throwsConfig(fn: () => void, re: RegExp): void {
  assert.throws(
    fn,
    (e: unknown) => e instanceof ReleaseConfigError && re.test((e as Error).message),
  );
}

function main() {
  // Phase I.1 - missing DIRECT_URL fails
  check("release fails when DIRECT_URL is absent", () => {
    throwsConfig(
      () => assertReleaseTargets({ DATABASE_URL: PROD_RUNTIME }),
      /DIRECT_URL is missing/,
    );
  });

  // Phase I.2 - malformed DIRECT_URL fails
  check("release fails when DIRECT_URL is malformed", () => {
    throwsConfig(
      () => assertReleaseTargets({ DIRECT_URL: "not a url", DATABASE_URL: PROD_RUNTIME }),
      /DIRECT_URL is malformed/,
    );
  });

  // Phase I.3 - database pathname not /postgres fails
  check("release fails when database pathname is not /postgres", () => {
    const bad = PROD_DIRECT.replace(/\/postgres$/, "/some_other_db");
    throwsConfig(
      () => assertReleaseTargets({ DIRECT_URL: bad, DATABASE_URL: PROD_RUNTIME }),
      /DIRECT_URL database is 'some_other_db'/,
    );
  });

  // non-postgres protocol fails
  check("release fails when DIRECT_URL is not a postgres URL", () => {
    throwsConfig(
      () =>
        assertReleaseTargets({ DIRECT_URL: "mysql://h:5432/postgres", DATABASE_URL: PROD_RUNTIME }),
      /not a postgres/,
    );
  });

  // runtime & migration targets on different projects fails
  check("release fails when DATABASE_URL and DIRECT_URL target different projects", () => {
    const otherProject = PROD_RUNTIME.replace(REF, "zzzzzzzzzzzzzzzzzzzz");
    throwsConfig(
      () => assertReleaseTargets({ DIRECT_URL: PROD_DIRECT, DATABASE_URL: otherProject }),
      /different Supabase projects/i,
    );
  });

  // placeholder/local host is rejected as a production target
  check("release fails when DIRECT_URL points at a local/placeholder host", () => {
    throwsConfig(
      () =>
        assertReleaseTargets({
          DIRECT_URL: "postgresql://postgres:pw@localhost:5432/postgres",
          DATABASE_URL: "postgresql://postgres:pw@localhost:6543/postgres",
        }),
      /local\/placeholder host/,
    );
  });

  // the real production shape passes and reports same-project
  check("valid production targets pass and are recognized as the same project", () => {
    const r = assertReleaseTargets({ DIRECT_URL: PROD_DIRECT, DATABASE_URL: PROD_RUNTIME });
    assert.equal(r.direct.database, "postgres");
    assert.equal(r.direct.schema, "public");
    assert.equal(r.sameProject, true);
    assert.equal(r.direct.port, "5432"); // migration = direct/session port
    assert.ok(r.runtime, "runtime target parsed");
    assert.equal(r.runtime!.port, "6543"); // runtime = transaction pooler
  });

  // Phase I.8 - the parsed identity NEVER carries a secret (redaction proof)
  check("parsed identity never leaks the password or full connection string", () => {
    const parsed = parsePgUrl(PROD_DIRECT, "DIRECT_URL");
    const serialized = JSON.stringify(parsed) + "|" + parsed.redacted;
    assert.ok(!/s3cr3tP/.test(serialized), "password must never appear");
    assert.ok(!/s3cr3tP%40ss/.test(serialized), "encoded password must never appear");
    assert.ok(!serialized.includes(PROD_DIRECT), "raw connection string must never appear");
    // redacted form is host-suffix + db + schema only
    assert.match(parsed.redacted, /pooler\.supabase\.com:5432\/postgres\?schema=public/);
  });

  console.log(`\n${passed} checks passed`);
}

main();
