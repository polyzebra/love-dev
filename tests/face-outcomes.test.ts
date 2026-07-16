/**
 * Canonical normalized face outcomes + the rules they encode. Proves the
 * DB classification enum maps 1:1 onto the 8 normalized outcomes, that a
 * provider error is NEVER a mismatch (PROVIDER_UNAVAILABLE / ERROR only),
 * the documented multi-face-cover policy, and that public surfaces never
 * reference a raw score or internal reason. Pure/unit. Run with:
 *   npx tsx tests/face-outcomes.test.ts
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

async function main() {
  const {
    classificationToOutcome,
    providerErrorToOutcome,
    isTransientOutcome,
    MULTIPLE_FACES_ON_COVER_POLICY,
  } = await import("../src/lib/services/face-outcomes");
  const { FaceMatchNotConfiguredError } = await import("../src/lib/services/face-match-providers");
  const { ProviderCircuitOpenError } = await import("../src/lib/services/provider-resilience");

  console.log("classification -> normalized outcome (1:1, no migration)");
  await check("every stored classification maps to a canonical outcome", () => {
    assert.equal(classificationToOutcome("OWNER_MATCHED"), "OWNER_MATCHED");
    assert.equal(classificationToOutcome("OTHER_PERSON_ONLY"), "DIFFERENT_PERSON");
    assert.equal(classificationToOutcome("NO_FACE"), "NO_FACE");
    assert.equal(classificationToOutcome("GROUP_PHOTO"), "MULTIPLE_FACES");
    assert.equal(classificationToOutcome("UNCERTAIN"), "LOW_CONFIDENCE");
    assert.equal(classificationToOutcome("MANIPULATION_RISK"), "AI_OR_MANIPULATION_RISK");
  });

  console.log("a provider error is NEVER a mismatch");
  await check("provider/infra failures -> PROVIDER_UNAVAILABLE (not DIFFERENT_PERSON)", () => {
    const cases: Array<[unknown, string]> = [
      [new FaceMatchNotConfiguredError("off"), "provider_not_configured"],
      [new ProviderCircuitOpenError("aws_rekognition_faces"), "provider_unavailable"],
      [new Error("timeout after 5000ms"), "provider_unavailable"],
      [new Error("invalid signature / unauthorized"), "provider_unavailable"],
      [new Error("throttled: too many requests 429"), "provider_unavailable"],
      [new Error("ENOTFOUND / fetch failed / socket"), "provider_unavailable"],
      [new Error("service not available in region"), "provider_unavailable"],
    ];
    for (const [err, reason] of cases) {
      const r = providerErrorToOutcome(err);
      assert.equal(r.outcome, "PROVIDER_UNAVAILABLE", `${reason} -> PROVIDER_UNAVAILABLE`);
      assert.equal(r.reasonCode, reason);
      assert.notEqual(r.outcome, "DIFFERENT_PERSON");
    }
  });

  await check("a genuinely unexpected error -> ERROR (still never a mismatch)", () => {
    const r = providerErrorToOutcome(new Error("something entirely unexpected"));
    assert.equal(r.outcome, "ERROR");
    assert.equal(r.reasonCode, "internal_error");
  });

  await check("transient outcomes never change the badge; verdict outcomes do", () => {
    assert.equal(isTransientOutcome("PROVIDER_UNAVAILABLE"), true);
    assert.equal(isTransientOutcome("ERROR"), true);
    for (const o of [
      "OWNER_MATCHED",
      "DIFFERENT_PERSON",
      "NO_FACE",
      "MULTIPLE_FACES",
      "LOW_CONFIDENCE",
      "AI_OR_MANIPULATION_RISK",
    ] as const)
      assert.equal(isTransientOutcome(o), false, `${o} is a real verdict`);
  });

  console.log("documented policies");
  await check("multiple faces on a cover -> MANUAL_REVIEW (never auto-suspend)", () => {
    assert.equal(MULTIPLE_FACES_ON_COVER_POLICY, "MANUAL_REVIEW");
  });

  console.log("public surfaces never expose a raw score or internal reason");
  await check("explore/discovery/person-card/profile-peek carry no score/reason fields", () => {
    const leaky =
      /similarityScore|manipulationRisk|failureReason|confidenceBand|reasonCode|riskLevel/;
    for (const f of [
      "src/lib/services/explore.ts",
      "src/lib/services/discovery.ts",
      "src/components/explore/person-card.tsx",
      "src/components/app/profile-peek.tsx",
    ]) {
      assert.ok(
        !leaky.test(readFileSync(f, "utf8")),
        `${f} must not surface internal face signals`,
      );
    }
  });

  console.log(`\n${passed} checks passed`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
