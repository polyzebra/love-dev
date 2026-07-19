/**
 * db:schema:verify - stage 4 of the release contract. Proves the Production
 * database matches the committed migration history AFTER deploy, before the
 * new build is considered healthy. Read-only. Redacted output.
 *
 * Confirms:
 *   1. `prisma migrate status` is clean (exit 0).
 *   2. public._prisma_migrations exists.
 *   3. No unfinished (finished_at IS NULL) or rolled-back migration remains.
 *   4. Every migration directory in the repo is recorded (incl. the latest).
 *   5. User.galleryVersion exists (the P2022 incident column).
 *
 *   node scripts/release/schema-verify.mjs
 * Exit 0 = schema verified; non-zero = STOP / do not mark healthy.
 */
import { readdirSync } from "node:fs";
import { existsSync } from "node:fs";
import "./_env.mjs";
import { prismaMigrate, directClient } from "./_env.mjs";
import { parsePgUrl } from "./validate.mjs";

const problems = [];
const direct = parsePgUrl(process.env.DIRECT_URL, "DIRECT_URL");
console.log(`schema verify -> ${direct.redacted}`);

// 1. migrate status clean
const status = prismaMigrate(["migrate", "status"]);
if (status.status !== 0) {
  problems.push("prisma migrate status is NOT clean (pending/failed migrations)");
}

// Repo migration directories (the source of truth for "latest required").
const repoMigrations = readdirSync("prisma/migrations")
  .filter((e) => existsSync(`prisma/migrations/${e}/migration.sql`))
  .sort();
const latest = repoMigrations[repoMigrations.length - 1];

const client = await directClient();
try {
  const reg = (await client.query("SELECT to_regclass('public._prisma_migrations')::text AS t"))
    .rows[0].t;
  if (!reg) {
    problems.push(
      "public._prisma_migrations does not exist - unbaselined DB (manual recovery required)",
    );
  } else {
    const counts = (
      await client.query(
        `SELECT count(*)::int AS total,
                coalesce(sum((rolled_back_at IS NOT NULL)::int),0)::int AS rolled_back,
                coalesce(sum((finished_at  IS NULL)::int),0)::int   AS unfinished
         FROM public._prisma_migrations`,
      )
    ).rows[0];
    console.log(
      `  _prisma_migrations: ${counts.total} rows, ${counts.rolled_back} rolled-back, ${counts.unfinished} unfinished`,
    );
    if (counts.rolled_back > 0)
      problems.push(`${counts.rolled_back} rolled-back migration(s) present`);
    if (counts.unfinished > 0)
      problems.push(`${counts.unfinished} unfinished migration(s) present`);

    const applied = new Set(
      (await client.query("SELECT migration_name FROM public._prisma_migrations")).rows.map(
        (r) => r.migration_name,
      ),
    );
    const missing = repoMigrations.filter((m) => !applied.has(m));
    if (missing.length) {
      problems.push(
        `${missing.length} repo migration(s) not recorded in DB (latest required: ${latest})`,
      );
    } else {
      console.log(`  all ${repoMigrations.length} repo migrations recorded (latest: ${latest})`);
    }
  }

  const hasGalleryVersion = (
    await client.query(
      `SELECT EXISTS(
         SELECT 1 FROM information_schema.columns
         WHERE table_schema='public' AND table_name='User' AND column_name='galleryVersion'
       ) AS has`,
    )
  ).rows[0].has;
  if (!hasGalleryVersion) {
    problems.push("User.galleryVersion column is ABSENT (P2022 incident regression)");
  } else {
    console.log("  User.galleryVersion: present");
  }
} finally {
  await client.end();
}

if (problems.length) {
  console.error("SCHEMA VERIFY FAILED:");
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log("schema verify OK");
process.exit(0);
