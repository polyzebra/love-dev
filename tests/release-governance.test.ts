/**
 * L7.3.7 - production release governance (unit, no DB). Source-contract proof
 * that the delivery pipeline is fail-closed and migration-safe:
 *   - `prisma db push` can never appear in a Production workflow/script
 *   - `prisma migrate dev` never runs in the Production release path
 *   - migrations (migrate deploy) run BEFORE the app is deployed
 *   - one authoritative path, serialized by a production-release lock
 *   - Prisma Migrate targets DIRECT_URL, not the runtime pooler
 *   - release scripts never print a raw connection string / secret
 *
 *   npx tsx tests/release-governance.test.ts
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

const CI = readFileSync(".github/workflows/ci.yml", "utf8");
const PKG = JSON.parse(readFileSync("package.json", "utf8"));
const VERCEL = readFileSync("vercel.json", "utf8");

/** The `deploy:` job block (the only Production-activating job). */
function deployJob(): string {
  const start = CI.indexOf("\n  deploy:");
  assert.ok(start > -1, "ci.yml must have a deploy job");
  // Runs to EOF (deploy is the last job); trim to be safe if others follow.
  return CI.slice(start);
}

/** Every release script body, concatenated. */
function releaseScripts(): { name: string; body: string }[] {
  const dir = "scripts/release";
  return readdirSync(dir)
    .filter((f) => f.endsWith(".mjs"))
    .map((f) => ({ name: f, body: readFileSync(join(dir, f), "utf8") }));
}

function main() {
  const job = deployJob();
  const scripts = releaseScripts();

  // Phase E - db push is prohibited everywhere in Production paths.
  check("no 'prisma db push' anywhere in the CI workflow", () => {
    assert.ok(!/\bdb\s+push\b/.test(CI), "CI workflow must never use db push");
  });
  check("no 'prisma db push' in any release script", () => {
    for (const s of scripts) {
      assert.ok(!/\bdb\s+push\b/.test(s.body), `${s.name} must never use db push`);
    }
  });

  // Phase E - migrate dev is local-only; never in the Production release path.
  check("no 'prisma migrate dev' in the production deploy job", () => {
    assert.ok(!/migrate\s+dev/.test(job), "deploy job must use migrate deploy, never migrate dev");
  });
  check("no 'prisma migrate dev' in release scripts (deploy-lane)", () => {
    for (const s of scripts) {
      assert.ok(!/migrate\s+dev/.test(s.body), `${s.name} must not use migrate dev`);
    }
  });

  // Phase D/F - migrations run BEFORE the app is built/deployed.
  check("deploy job runs the DB gate (release:production) BEFORE vercel deploy", () => {
    const gateIdx = job.indexOf("release:production");
    const buildIdx = job.indexOf("vercel build");
    const deployIdx = job.indexOf("vercel deploy");
    assert.ok(gateIdx > -1, "deploy job must run 'npm run release:production'");
    assert.ok(deployIdx > -1, "deploy job must run 'vercel deploy'");
    assert.ok(gateIdx < buildIdx, "migrate deploy must precede vercel build");
    assert.ok(gateIdx < deployIdx, "migrate deploy must precede vercel deploy");
  });

  // Phase G - exactly one serialized production release at a time.
  check("deploy job holds a non-cancelling 'production-release' concurrency lock", () => {
    const cc = job.slice(job.indexOf("concurrency:"), job.indexOf("steps:"));
    assert.match(cc, /group:\s*production-release/, "must serialize on production-release");
    assert.match(cc, /cancel-in-progress:\s*false/, "must queue, never interrupt a migrate deploy");
  });

  // Phase F - deploy promotes the SAME commit that passed the gate.
  check("deploy uses --prebuilt (same-commit promotion) and carries github.sha to smoke", () => {
    assert.match(
      job,
      /vercel deploy --prebuilt --prod/,
      "must promote the prebuilt (this-commit) artifact",
    );
    assert.match(
      job,
      /EXPECTED_COMMIT:\s*\$\{\{\s*github\.sha\s*\}\}/,
      "smoke must assert the tested commit",
    );
  });

  // Phase C - Prisma Migrate targets DIRECT_URL, never the runtime pooler.
  check("migrate helper forces DATABASE_URL to DIRECT_URL for the CLI", () => {
    const env = scripts.find((s) => s.name === "_env.mjs")!.body;
    assert.match(env, /DATABASE_URL:\s*directUrl/, "migrate must run on the direct connection");
    assert.match(env, /DIRECT_URL/, "DIRECT_URL is the migration target");
  });

  // Phase C - a failed migration is never auto-resolved during a normal release.
  check("migrate-deploy refuses to auto-resolve a failed migration (P3009)", () => {
    const md = scripts.find((s) => s.name === "migrate-deploy.mjs")!.body;
    assert.match(md, /P3009/, "must detect a failed-migration state");
    assert.ok(!/migrate\s+resolve/.test(md), "must NOT run migrate resolve in a normal release");
  });

  // Phase C.3 - release scripts never print a raw connection string / secret.
  check("release scripts never console-log a raw DIRECT_URL/DATABASE_URL value", () => {
    for (const s of scripts) {
      // logging the .redacted field is fine; logging the raw env value is not
      const bad = /console\.\w+\([^)]*process\.env\.(DIRECT_URL|DATABASE_URL)\b/;
      assert.ok(!bad.test(s.body), `${s.name} must not log a raw connection string`);
    }
  });

  // Phase A/F - the git-push production build stays gated by vercel.json.
  check("vercel.json still gates production git builds (ignoreCommand + CI_DEPLOYS_ONLY)", () => {
    assert.match(VERCEL, /ignoreCommand/);
    assert.match(VERCEL, /CI_DEPLOYS_ONLY/);
  });

  // Phase C - the documented release scripts exist and are wired.
  check("package.json wires the release script surface", () => {
    for (const s of [
      "db:migrate:status",
      "db:migrate:deploy",
      "db:schema:verify",
      "release:preflight",
      "release:smoke",
      "release:production",
    ]) {
      assert.ok(PKG.scripts[s], `missing npm script: ${s}`);
    }
    assert.match(PKG.scripts["db:migrate:deploy"], /release\/migrate-deploy\.mjs/);
  });

  console.log(`\n${passed} checks passed`);
}

main();
