/**
 * One-time SUPER_ADMIN bootstrap - PREFERRED (offline) path.
 *
 *   npx tsx scripts/bootstrap-admin.ts
 *
 * Talks directly to the database from .env; no HTTP, no secret header -
 * shell access to the deployment env IS the credential here (the API
 * route exists for hosts without shell access; same guards either way,
 * both funnel through src/lib/services/admin-bootstrap.ts):
 *   - refuses when ADMIN_BOOTSTRAP_EMAIL is unset
 *   - refuses permanently once ANY SUPER_ADMIN exists (idempotent)
 *   - promotes only an existing, email-verified, ACTIVE user matched by
 *     normalized email; otherwise prints the setup steps (spec PART 13)
 *   - writes AdminLog "admin.bootstrap" + an AuthVerificationEvent
 */
import "dotenv/config";

async function main() {
  const { bootstrapSuperAdmin, normalizeEmail } = await import(
    "../src/lib/services/admin-bootstrap"
  );

  const raw = process.env.ADMIN_BOOTSTRAP_EMAIL;
  if (!raw || raw.trim().length === 0) {
    console.error("ADMIN_BOOTSTRAP_EMAIL is not set - add it to .env and re-run.");
    process.exit(1);
  }

  const result = await bootstrapSuperAdmin({ email: raw, via: "script" });
  switch (result.status) {
    case "gone":
      console.log("Nothing to do: a SUPER_ADMIN already exists. Bootstrap is permanently disabled.");
      process.exit(0);
      break;
    case "setup_required":
      console.error(`Cannot promote ${normalizeEmail(raw)} yet: ${result.reason.replace(/_/g, " ")}.`);
      console.error("Complete these steps, then re-run this script:");
      for (const step of result.instructions) console.error(`  ${step}`);
      process.exit(2);
      break;
    case "promoted":
      console.log(`Promoted ${result.email} (User.id = auth uid ${result.userId}) to SUPER_ADMIN.`);
      console.log("Audited as AdminLog admin.bootstrap. This mechanism is now disabled.");
      process.exit(0);
  }
}

main().catch((error) => {
  console.error("bootstrap-admin failed:", error);
  process.exit(1);
});
