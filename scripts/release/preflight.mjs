/**
 * release:preflight - stage 1 of the production release contract.
 * Fail-closed configuration validation BEFORE any migration or build runs.
 * Proves DIRECT_URL (migration target) and DATABASE_URL (runtime target) are
 * present, well-formed, point at database `postgres` / schema `public`, and
 * target the same Supabase project. Prints only redacted metadata.
 *
 *   node scripts/release/preflight.mjs
 * Exit 0 = safe to proceed; non-zero = STOP the release.
 */
import "./_env.mjs";
import { assertReleaseTargets, ReleaseConfigError } from "./validate.mjs";

try {
  const { direct, runtime, sameProject } = assertReleaseTargets(process.env);
  console.log("preflight OK - release targets validated");
  console.log(`  runtime  (DATABASE_URL) -> ${runtime.redacted}  pooled=${runtime.pooled}`);
  console.log(`  migrate  (DIRECT_URL)   -> ${direct.redacted}  pooled=${direct.pooled}`);
  console.log(`  same Supabase project   -> ${sameProject ? "yes" : "N/A"}`);
  process.exit(0);
} catch (err) {
  if (err instanceof ReleaseConfigError) {
    console.error(`PREFLIGHT FAILED: ${err.message}`);
    process.exit(1);
  }
  console.error(`PREFLIGHT FAILED (unexpected): ${String(err).slice(0, 200)}`);
  process.exit(1);
}
