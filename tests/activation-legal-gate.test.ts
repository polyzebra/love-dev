/**
 * ACTIVATION BLOCKERS - H4 (runtime legal gate) + H1 (public-badge verdict),
 * pure/unit. No DB. Proves the RUNTIME fails closed unless every recorded
 * approval exists, and that the public-badge verdict honours suspension.
 *
 * Unit lane. Run with: npx tsx tests/activation-legal-gate.test.ts
 */
import assert from "node:assert/strict";

let passed = 0;
async function check(name: string, fn: () => void | Promise<void>): Promise<void> {
  await fn();
  passed += 1;
  console.log(`  ok - ${name}`);
}

const env = process.env as Record<string, string | undefined>;

// The full set of env this suite touches - saved once, restored in finally so
// the harness leaves no residue for sibling suites.
const KEYS = [
  "NODE_ENV",
  "FACE_MATCH_PROVIDER",
  "FACE_LEGAL_APPROVAL_VERSION",
  "FACE_LEGAL_APPROVED_VERSIONS",
  "FACE_BINDING_METHOD",
  "FACE_BINDING_LEGAL_APPROVAL_VERSION",
  "FACE_BINDING_LEGAL_APPROVED_VERSIONS",
  "FACE_CALIBRATION_APPROVED",
  "FACE_CALIBRATION_VERSION",
  "FACE_AWS_DPA_CONFIRMED",
  "FACE_EMERGENCY_DISABLE",
];

async function main() {
  const SAVED = Object.fromEntries(KEYS.map((k) => [k, env[k]]));
  const { faceMatchLegalGate, faceBindingLegalGate } =
    await import("../src/lib/services/face-rollout");
  const { isFaceMatchConfigured } = await import("../src/lib/services/face-match-providers");
  const { humanReviewConfigured } = await import("../src/lib/services/human-review-binding");
  const { isPubliclyVerified } = await import("../src/lib/services/verification");

  // A fully-approved MATCH environment (the ONLY state that may activate).
  const approveMatch = () => {
    env.FACE_LEGAL_APPROVED_VERSIONS = "legal-v1,legal-v2";
    env.FACE_LEGAL_APPROVAL_VERSION = "legal-v1";
    env.FACE_AWS_DPA_CONFIRMED = "1";
    env.FACE_CALIBRATION_APPROVED = "1";
    env.FACE_CALIBRATION_VERSION = "cal-v1";
    delete env.FACE_EMERGENCY_DISABLE;
  };
  const approveBinding = () => {
    env.FACE_BINDING_LEGAL_APPROVED_VERSIONS = "bind-v1";
    env.FACE_BINDING_LEGAL_APPROVAL_VERSION = "bind-v1";
  };

  try {
    // ---- H4: MATCH legal gate ------------------------------------------------
    await check("H4 match gate: PASSES only when every approval is recorded", () => {
      approveMatch();
      const g = faceMatchLegalGate();
      assert.equal(g.ok, true, `expected ok, missing: ${g.missing.join(",")}`);
    });

    await check("H4 match gate: FAILS CLOSED when approved-versions list is empty", () => {
      approveMatch();
      delete env.FACE_LEGAL_APPROVED_VERSIONS;
      const g = faceMatchLegalGate();
      assert.equal(g.ok, false);
      assert.ok(g.missing.includes("FACE_LEGAL_APPROVED_VERSIONS"));
    });

    await check("H4 match gate: FAILS CLOSED when approval version missing", () => {
      approveMatch();
      delete env.FACE_LEGAL_APPROVAL_VERSION;
      const g = faceMatchLegalGate();
      assert.equal(g.ok, false);
      assert.ok(g.missing.includes("FACE_LEGAL_APPROVAL_VERSION"));
    });

    await check("H4 match gate: FAILS CLOSED when supplied version is NOT approved", () => {
      approveMatch();
      env.FACE_LEGAL_APPROVAL_VERSION = "legal-vX"; // not in the allowlist
      const g = faceMatchLegalGate();
      assert.equal(g.ok, false, "version mismatch must fail closed");
      assert.ok(g.missing.some((m) => m.startsWith("FACE_LEGAL_APPROVAL_VERSION")));
    });

    await check("H4 match gate: FAILS CLOSED when DPA not confirmed", () => {
      approveMatch();
      delete env.FACE_AWS_DPA_CONFIRMED;
      const g = faceMatchLegalGate();
      assert.equal(g.ok, false);
      assert.ok(g.missing.includes("FACE_AWS_DPA_CONFIRMED"));
    });

    await check("H4 match gate: FAILS CLOSED when calibration not approved / no version", () => {
      approveMatch();
      delete env.FACE_CALIBRATION_APPROVED;
      assert.equal(faceMatchLegalGate().ok, false);
      approveMatch();
      delete env.FACE_CALIBRATION_VERSION;
      const g = faceMatchLegalGate();
      assert.equal(g.ok, false);
      assert.ok(g.missing.includes("FACE_CALIBRATION_VERSION"));
    });

    await check("H4 match gate: FAILS CLOSED when emergency disable is ON", () => {
      approveMatch();
      env.FACE_EMERGENCY_DISABLE = "1";
      const g = faceMatchLegalGate();
      assert.equal(g.ok, false);
      assert.ok(g.missing.includes("FACE_EMERGENCY_DISABLE"));
    });

    // ---- H4: BINDING legal gate ---------------------------------------------
    await check("H4 binding gate: PASSES only with match + binding approvals", () => {
      approveMatch();
      approveBinding();
      assert.equal(faceBindingLegalGate().ok, true);
    });

    await check("H4 binding gate: FAILS CLOSED when binding version not approved", () => {
      approveMatch();
      approveBinding();
      env.FACE_BINDING_LEGAL_APPROVAL_VERSION = "bind-vX";
      assert.equal(faceBindingLegalGate().ok, false);
    });

    await check("H4 binding gate: FAILS CLOSED when the MATCH gate fails", () => {
      approveMatch();
      approveBinding();
      delete env.FACE_AWS_DPA_CONFIRMED; // match compliance broken
      assert.equal(faceBindingLegalGate().ok, false, "binding inherits match compliance");
    });

    // ---- H4: production runtime provider resolution fails closed ------------
    await check("H4 runtime: aws provider stays NOT-configured in prod without approvals", () => {
      const savedNodeEnv = env.NODE_ENV;
      env.NODE_ENV = "production";
      env.FACE_MATCH_PROVIDER = "aws_rekognition_faces";
      approveMatch();
      delete env.FACE_AWS_DPA_CONFIRMED; // one approval missing
      assert.equal(isFaceMatchConfigured(), false, "prod refuses activation - fail closed");
      env.NODE_ENV = savedNodeEnv;
    });

    await check("H4 runtime: human review NOT configured in prod without binding approvals", () => {
      const savedNodeEnv = env.NODE_ENV;
      env.NODE_ENV = "production";
      env.FACE_BINDING_METHOD = "HUMAN_REVIEW";
      approveMatch();
      approveBinding();
      delete env.FACE_BINDING_LEGAL_APPROVED_VERSIONS; // allowlist missing
      assert.equal(humanReviewConfigured(), false, "prod binding fails closed");
      env.NODE_ENV = savedNodeEnv;
    });

    // ---- H1: public-badge verdict honours suspension ------------------------
    await check("H1 verdict: verified only when identity present AND not suspended", () => {
      const now = new Date();
      assert.equal(isPubliclyVerified({ photoVerifiedAt: now, faceBadgeSuspendedAt: null }), true);
      assert.equal(
        isPubliclyVerified({ photoVerifiedAt: now, faceBadgeSuspendedAt: now }),
        false,
        "suspended must never read as verified",
      );
      assert.equal(
        isPubliclyVerified({ photoVerifiedAt: null, faceBadgeSuspendedAt: null }),
        false,
      );
    });

    // ---- H1: the suspension field is compile-time REQUIRED + surfaces load it
    await check(
      "H1 source: isPubliclyVerified requires faceBadgeSuspendedAt (not optional)",
      async () => {
        const { readFileSync } = await import("node:fs");
        const src = readFileSync("src/lib/services/verification.ts", "utf8");
        // The param block must declare the field WITHOUT the optional `?`.
        assert.ok(
          /isPubliclyVerified\(user:\s*\{[\s\S]*?faceBadgeSuspendedAt:\s*Date\s*\|\s*null;[\s\S]*?\}\)/.test(
            src,
          ),
          "faceBadgeSuspendedAt must be a required field on isPubliclyVerified",
        );
        assert.ok(
          !/isPubliclyVerified\(user:\s*\{[\s\S]*?faceBadgeSuspendedAt\?:/.test(src),
          "faceBadgeSuspendedAt must NOT be optional on isPubliclyVerified",
        );
        assert.ok(/export const PUBLIC_BADGE_SELECT/.test(src), "canonical selector exists");
      },
    );

    await check("H1 source: swipe + chat load the canonical PUBLIC_BADGE_SELECT", async () => {
      const { readFileSync } = await import("node:fs");
      for (const f of [
        "src/lib/services/discovery.ts",
        "src/app/(app)/chat/[conversationId]/page.tsx",
      ]) {
        const src = readFileSync(f, "utf8");
        assert.ok(
          /PUBLIC_BADGE_SELECT/.test(src),
          `${f} must load the canonical public-badge projection`,
        );
      }
    });
  } finally {
    for (const [k, v] of Object.entries(SAVED)) {
      if (v === undefined) delete env[k];
      else env[k] = v;
    }
  }

  console.log(`\n${passed} checks passed`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
