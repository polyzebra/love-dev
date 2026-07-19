/**
 * Shared runtime bits for the release scripts. Loads .env when present (local
 * runs) but never requires it (CI provides env via secrets). Provides a
 * spawn helper that runs the Prisma CLI with DATABASE_URL overridden to
 * DIRECT_URL - the session/direct connection Prisma Migrate needs - and a
 * pg client factory that connects on DIRECT_URL. Nothing here prints a
 * secret; command env is passed in-process, never echoed.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

// dotenv is a dependency (prisma.config.ts uses it); loading is a no-op with
// no .env, so CI is unaffected.
if (existsSync(".env")) {
  await import("dotenv/config");
}

export function requireEnv(name) {
  const v = process.env[name];
  if (v == null || v.trim() === "") {
    console.error(`FAIL: required environment variable ${name} is not set`);
    process.exit(1);
  }
  return v;
}

/**
 * Run `npx prisma <args>` with DATABASE_URL forced to DIRECT_URL for the
 * duration of the child ONLY (migration traffic must use the direct
 * connection). Returns { status, stdout, stderr }. The connection string is
 * passed through the child env, never onto the command line or the log.
 */
export function prismaMigrate(args, { timeoutMs = 180_000 } = {}) {
  const directUrl = process.env.DIRECT_URL;
  if (!directUrl || directUrl.trim() === "") {
    console.error(
      "FAIL: DIRECT_URL is not set (migration target). Refusing to run Prisma Migrate.",
    );
    process.exit(1);
  }
  const run = spawnSync("npx", ["prisma", ...args], {
    encoding: "utf8",
    timeout: timeoutMs,
    env: { ...process.env, DATABASE_URL: directUrl },
  });
  return run;
}

/** Lazily create a connected pg client on DIRECT_URL (read-only queries). */
export async function directClient() {
  const directUrl = requireEnv("DIRECT_URL");
  const pg = (await import("pg")).default;
  const client = new pg.Client({ connectionString: directUrl });
  await client.connect();
  return client;
}
