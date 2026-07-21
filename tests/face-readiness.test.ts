/**
 * Face readiness (admin surface) + the "one failed match never auto-suspends"
 * invariant. Pure; no DB. Run:  npx tsx tests/face-readiness.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { getFaceReadiness } from "../src/lib/services/face-readiness";
import { decideProfile } from "../src/lib/services/face-verification";

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ok - ${name}`);
}

function main() {
  // ---- readiness never leaks a secret VALUE ------------------------------
  check("getFaceReadiness exposes booleans/names only - no secret VALUES", () => {
    const prev = { ...process.env };
    process.env.AWS_SECRET_ACCESS_KEY = "SECRET_AKIA_VALUE_should_never_appear";
    process.env.AWS_ACCESS_KEY_ID = "AKIA_ID_should_never_appear";
    process.env.FACE_LIVENESS_ROLE_ARN = "arn:aws:iam::999:role/SECRET_ROLE";
    process.env.FACE_COLLECTION_ID = "secret-collection-name";
    try {
      const r = getFaceReadiness();
      const blob = JSON.stringify(r);
      for (const secret of [
        "SECRET_AKIA_VALUE_should_never_appear",
        "AKIA_ID_should_never_appear",
        "arn:aws:iam::999:role/SECRET_ROLE",
        "secret-collection-name",
      ]) {
        assert.ok(!blob.includes(secret), `readiness leaked ${secret}`);
      }
      // Only boolean presence is surfaced.
      assert.equal(typeof r.collectionConfigured, "boolean");
      assert.equal(typeof r.streamingConfigured, "boolean");
      assert.equal(typeof r.isFaceMatchConfigured, "boolean");
      // legalGate.missing is a list of non-secret KEY NAMES (uppercase env keys).
      for (const m of r.legalGate.missing) assert.match(m, /^FACE_[A-Z_:]+$/);
    } finally {
      process.env = prev;
    }
  });

  // ---- INVARIANT: a single failed face match never auto-suspends ----------
  const P = (o: Partial<{ decision: string; classification: string; isCover: boolean }>) =>
    ({ decision: "PASSED", classification: "OWNER_MATCHED", isCover: false, ...o }) as never;

  check("single cover mismatch -> REJECTED (retry/replace), NOT SUSPENDED", () => {
    const d = decideProfile([P({ decision: "REJECTED", classification: "OTHER_PERSON_ONLY", isCover: true })]);
    assert.equal(d.status, "REJECTED");
    assert.notEqual(d.status, "SUSPENDED");
  });

  check("single cover no-face -> REJECTED (user-fixable), NOT SUSPENDED", () => {
    const d = decideProfile([P({ decision: "REJECTED", classification: "NO_FACE", isCover: true })]);
    assert.equal(d.status, "REJECTED");
    assert.notEqual(d.status, "SUSPENDED");
  });

  check("single flagged/borderline -> MANUAL_REVIEW, NOT SUSPENDED", () => {
    const d = decideProfile([P({ decision: "FLAGGED", classification: "UNCERTAIN", isCover: true })]);
    assert.equal(d.status, "MANUAL_REVIEW");
    assert.notEqual(d.status, "SUSPENDED");
  });

  check("one other-person gallery photo (<= cap), good cover -> NOT SUSPENDED", () => {
    const prev = process.env.FACE_MAX_OTHER_PERSON_PHOTOS;
    process.env.FACE_MAX_OTHER_PERSON_PHOTOS = "2";
    try {
      const d = decideProfile([
        P({ decision: "PASSED", classification: "OWNER_MATCHED", isCover: true }),
        P({ decision: "REJECTED", classification: "OTHER_PERSON_ONLY", isCover: false }),
      ]);
      assert.notEqual(d.status, "SUSPENDED", "one other-person photo must not suspend");
    } finally {
      if (prev === undefined) delete process.env.FACE_MAX_OTHER_PERSON_PHOTOS;
      else process.env.FACE_MAX_OTHER_PERSON_PHOTOS = prev;
    }
  });

  check("suspension is AGGREGATE only (other-person count > cap), never a single fail", () => {
    const prev = process.env.FACE_MAX_OTHER_PERSON_PHOTOS;
    process.env.FACE_MAX_OTHER_PERSON_PHOTOS = "2";
    try {
      const many = decideProfile([
        P({ decision: "PASSED", classification: "OWNER_MATCHED", isCover: true }),
        P({ decision: "REJECTED", classification: "OTHER_PERSON_ONLY", isCover: false }),
        P({ decision: "REJECTED", classification: "OTHER_PERSON_ONLY", isCover: false }),
        P({ decision: "REJECTED", classification: "OTHER_PERSON_ONLY", isCover: false }),
      ]);
      assert.equal(many.status, "SUSPENDED", "3 > cap(2) suspends (aggregate impersonation)");
    } finally {
      if (prev === undefined) delete process.env.FACE_MAX_OTHER_PERSON_PHOTOS;
      else process.env.FACE_MAX_OTHER_PERSON_PHOTOS = prev;
    }
  });

  // ---- governance: the admin surfaces never return secrets -----------------
  check("admin readiness route + service return no credential fields", () => {
    const route = readFileSync("src/app/api/admin/face-readiness/route.ts", "utf8");
    assert.match(route, /requirePermission\("verifications:review"\)/, "admin-gated");
    const svc = readFileSync("src/lib/services/face-readiness.ts", "utf8");
    assert.doesNotMatch(svc, /accessKeyId|secretAccessKey|\broleArn\b/, "no secret fields returned");
  });

  console.log(`\n${passed} checks passed`);
}

main();
