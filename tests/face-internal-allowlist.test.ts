/**
 * FACE_INTERNAL_USER_ALLOWLIST + the admitToFaceVerification priority gate.
 * The internal allowlist admits a user for internal AWS rehearsal while
 * FACE_VERIFICATION_PERCENT=0, but must NEVER bypass the provider,
 * emergency-disable, production legal-approval or consent gates. Priority:
 *   1 provider  2 emergency  3 legal(prod)  4 consent  5 internal  6 percent  7 country
 * Pure/unit: env-controlled, consent passed explicitly (no DB). Run with:
 *   npx tsx tests/face-internal-allowlist.test.ts
 */
import "dotenv/config";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

let passed = 0;
async function check(name: string, fn: () => void | Promise<void>): Promise<void> {
  await fn();
  passed += 1;
  console.log(`  ok - ${name}`);
}

const INTERNAL = "user_internal_admin_0001";
const OUTSIDER = "user_regular_person_9999";

// process.env.NODE_ENV is typed read-only; the test toggles it deliberately.
const env = process.env as Record<string, string | undefined>;

// Env keys this suite mutates - snapshot + restore so no bleed.
const KEYS = [
  "FACE_MATCH_PROVIDER",
  "FACE_EMERGENCY_DISABLE",
  "FACE_LEGAL_APPROVAL_VERSION",
  "FACE_VERIFICATION_PERCENT",
  "FACE_INTERNAL_USER_ALLOWLIST",
  "FACE_VERIFICATION_COUNTRY_ALLOWLIST",
  "FACE_INTERNAL_ALLOWLIST_COUNTRY_OVERRIDE",
  "NODE_ENV",
] as const;

async function main() {
  const { admitToFaceVerification, isFaceInternalUser, faceInternalAllowlist } =
    await import("../src/lib/services/face-rollout");

  const saved: Record<string, string | undefined> = {};
  for (const k of KEYS) saved[k] = process.env[k];
  const reset = () => {
    for (const k of KEYS) delete process.env[k];
    // Baseline for an internal-rehearsal window: provider on (mock, dev),
    // percentage cohort CLOSED, internal user allowlisted.
    process.env.FACE_MATCH_PROVIDER = "mock";
    process.env.FACE_VERIFICATION_PERCENT = "0";
    process.env.FACE_INTERNAL_USER_ALLOWLIST = ` ${INTERNAL} , , bad@example.com `;
  };

  try {
    console.log("parsing + validation (server-only, IDs not emails)");
    await check("allowlist trims, drops empties, ignores emails", () => {
      reset();
      const set = faceInternalAllowlist();
      assert.ok(set.has(INTERNAL), "the internal ID is admitted");
      assert.ok(!set.has("bad@example.com"), "an email entry is ignored (IDs only)");
      assert.equal(set.size, 1, "only the one valid ID survives");
      assert.equal(isFaceInternalUser(INTERNAL), true);
      assert.equal(isFaceInternalUser(OUTSIDER), false);
      assert.equal(isFaceInternalUser(""), false);
    });

    console.log("admission priority");
    await check("internal user admitted at FACE_VERIFICATION_PERCENT=0", async () => {
      reset();
      const d = await admitToFaceVerification(INTERNAL, { hasActiveConsent: true });
      assert.deepEqual(d, { admit: true, reason: "internal_allowlist" });
    });

    await check("non-internal user rejected at 0%", async () => {
      reset();
      const d = await admitToFaceVerification(OUTSIDER, { hasActiveConsent: true });
      assert.equal(d.admit, false);
      assert.equal(d.reason, "cohort_excluded");
    });

    await check("emergency disable rejects the internal user (overrides allowlist)", async () => {
      reset();
      process.env.FACE_EMERGENCY_DISABLE = "1";
      const d = await admitToFaceVerification(INTERNAL, { hasActiveConsent: true });
      assert.deepEqual(d, { admit: false, reason: "emergency_disable" });
      // ...even for already-admitted recovery work.
      const r = await admitToFaceVerification(INTERNAL, {
        hasActiveConsent: true,
        isRecovery: true,
      });
      assert.equal(r.reason, "emergency_disable");
    });

    await check("missing legal approval rejects the internal user in production", async () => {
      reset();
      env.NODE_ENV = "production";
      process.env.FACE_MATCH_PROVIDER = "aws_rekognition_faces";
      delete process.env.FACE_LEGAL_APPROVAL_VERSION;
      const d = await admitToFaceVerification(INTERNAL, { hasActiveConsent: true });
      assert.equal(d.admit, false, "no biometric processing in prod without legal approval");
      // The provider's own legal gate makes it not-configured, so gate 1
      // fires first; gate 3 is defense-in-depth for the same condition.
      assert.ok(
        d.reason === "provider_disabled" || d.reason === "legal_approval_missing",
        `rejected for a legal reason (got ${d.reason})`,
      );
    });

    await check("withdrawn / absent consent rejects the internal user (and recovery)", async () => {
      reset();
      const d = await admitToFaceVerification(INTERNAL, { hasActiveConsent: false });
      assert.deepEqual(d, { admit: false, reason: "consent_missing" });
      // Consent is enforced even for recovery of already-admitted work.
      const r = await admitToFaceVerification(INTERNAL, {
        hasActiveConsent: false,
        isRecovery: true,
      });
      assert.equal(r.reason, "consent_missing");
    });

    await check("internal admission still respects country unless override granted", async () => {
      reset();
      process.env.FACE_VERIFICATION_COUNTRY_ALLOWLIST = "IE,US";
      const blocked = await admitToFaceVerification(INTERNAL, {
        hasActiveConsent: true,
        country: "CA",
      });
      assert.equal(
        blocked.reason,
        "country_excluded",
        "internal is NOT a country bypass by default",
      );
      const allowed = await admitToFaceVerification(INTERNAL, {
        hasActiveConsent: true,
        country: "IE",
      });
      assert.equal(allowed.reason, "internal_allowlist");
      // Explicit policy override lets internal ignore the country gate.
      process.env.FACE_INTERNAL_ALLOWLIST_COUNTRY_OVERRIDE = "1";
      const overridden = await admitToFaceVerification(INTERNAL, {
        hasActiveConsent: true,
        country: "CA",
      });
      assert.equal(overridden.reason, "internal_allowlist");
    });

    await check("provider off rejects everyone, internal included", async () => {
      reset();
      delete process.env.FACE_MATCH_PROVIDER;
      const d = await admitToFaceVerification(INTERNAL, { hasActiveConsent: true });
      assert.deepEqual(d, { admit: false, reason: "provider_disabled" });
    });

    console.log("no client exposure of allowlist data");
    await check("env var is server-only (no NEXT_PUBLIC alias) and never client-imported", () => {
      const rollout = readFileSync("src/lib/services/face-rollout.ts", "utf8");
      assert.ok(
        rollout.includes("process.env.FACE_INTERNAL_USER_ALLOWLIST"),
        "read from the server-only var",
      );
      assert.ok(
        !/NEXT_PUBLIC_FACE_INTERNAL/.test(rollout),
        "no NEXT_PUBLIC alias that would inline into the client bundle",
      );
      assert.ok(!rollout.startsWith('"use client"'), "face-rollout is a server module");
    });

    await check("admit decisions never leak allowlist membership as data", async () => {
      reset();
      const d = await admitToFaceVerification(INTERNAL, { hasActiveConsent: true });
      // The reason is a fixed enum token, never the user id or the raw list.
      assert.ok(!d.reason.includes(INTERNAL), "reason carries no user id");
      assert.ok(
        ["internal_allowlist", "cohort_admitted", "recovery"].includes(d.reason) || !d.admit,
        "reason is a stable token",
      );
    });
  } finally {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete env[k];
      else env[k] = saved[k];
    }
  }

  console.log(`\n${passed} checks passed`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
