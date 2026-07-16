/**
 * Epic 1 / F1 (unit, no DB): the canonical badge helpers + the dormancy
 * invariant. Proves the legacy public badge is byte-for-byte unchanged, the
 * new positive signal is inert, and NOTHING in the app consumes faceVerifiedAt
 * yet. Also pins the binding model to normalized-evidence-only and the
 * migration to additive+idempotent.
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  isPubliclyVerified,
  isIdentityVerified,
  isPhotoVerified,
} from "../src/lib/services/verification";

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ok - ${name}`);
}

const D = new Date();

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (p.includes("/generated/")) continue;
    const s = statSync(p);
    if (s.isDirectory()) walk(p, out);
    else if (p.endsWith(".ts") || p.endsWith(".tsx")) out.push(p);
  }
  return out;
}

function main() {
  // ---- legacy isPubliclyVerified: UNCHANGED ------------------------------
  check("isPubliclyVerified keeps legacy semantics (identity && !suspended)", () => {
    assert.equal(isPubliclyVerified({ photoVerifiedAt: D, faceBadgeSuspendedAt: null }), true);
    assert.equal(isPubliclyVerified({ photoVerifiedAt: D, faceBadgeSuspendedAt: D }), false);
    assert.equal(isPubliclyVerified({ photoVerifiedAt: null, faceBadgeSuspendedAt: null }), false);
  });

  check("adding faceVerifiedAt does NOT change the legacy badge (dormant equiv.)", () => {
    // The legacy helper never reads faceVerifiedAt - a verified user stays
    // verified regardless of the new column's value.
    const withNull = { photoVerifiedAt: D, faceBadgeSuspendedAt: null, faceVerifiedAt: null };
    const withDate = { photoVerifiedAt: D, faceBadgeSuspendedAt: null, faceVerifiedAt: D };
    assert.equal(isPubliclyVerified(withNull), true);
    assert.equal(isPubliclyVerified(withDate), true);
  });

  // ---- new helpers -------------------------------------------------------
  check("isIdentityVerified = photoVerifiedAt != null", () => {
    assert.equal(isIdentityVerified({ photoVerifiedAt: D }), true);
    assert.equal(isIdentityVerified({ photoVerifiedAt: null }), false);
  });

  check("isPhotoVerified is false when null/absent, true only when set", () => {
    assert.equal(isPhotoVerified({}), false);
    assert.equal(isPhotoVerified({ faceVerifiedAt: null }), false);
    assert.equal(isPhotoVerified({ faceVerifiedAt: undefined }), false);
    assert.equal(isPhotoVerified({ faceVerifiedAt: D }), true);
  });

  // ---- dormancy invariant: only the engine + helper CONSUME faceVerifiedAt -
  check("faceVerifiedAt is confined to the helper + the grant engine (no UI/route)", () => {
    // Scan CODE only - strip comments so doc-comments that merely mention
    // "does not set faceVerifiedAt" (grant/binding services, review route) do
    // not count as consumption.
    const stripComments = (s: string) =>
      s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
    const files = walk("src");
    const hits = files.filter((f) => stripComments(readFileSync(f, "utf8")).includes("faceVerifiedAt"));
    // In CODE, faceVerifiedAt lives ONLY in the canonical helper (reads it) and
    // the grant engine (the ONE writer). No service, route or UI consumes it.
    const allowed = ["src/lib/services/verification.ts", "src/lib/services/photo-grant.ts"];
    for (const h of hits) assert.ok(allowed.includes(h), `unexpected faceVerifiedAt code reference: ${h}`);
    assert.ok(!hits.some((h) => h.endsWith(".tsx")), "no UI reads faceVerifiedAt");
    assert.ok(!hits.some((h) => h.startsWith("src/app/")), "no route/public surface reads it");
    // Exactly ONE writer: only photo-grant.ts writes the column.
    const writers = files.filter((f) => /faceVerifiedAt:\s*(new Date\(\)|null)/.test(readFileSync(f, "utf8")));
    assert.deepEqual(writers, ["src/lib/services/photo-grant.ts"], "faceVerifiedAt has exactly one writer");
    // The helper never puts it inside a Prisma select.
    const v = readFileSync("src/lib/services/verification.ts", "utf8");
    assert.ok(!/faceVerifiedAt:\s*true/.test(v), "faceVerifiedAt must not be in any select");
  });

  // ---- binding model stores only normalized evidence ---------------------
  check("FaceIdentityBinding has NO image/template/payload fields", () => {
    const schema = readFileSync("prisma/schema.prisma", "utf8");
    const raw = schema.slice(
      schema.indexOf("model FaceIdentityBinding"),
      schema.indexOf("enum FaceBindingMethod"),
    );
    assert.ok(raw.length > 0, "model present");
    // Scan FIELD DECLARATIONS only - strip comments so the doc-comment that
    // says "never raw images/templates/payloads" doesn't trip the scan.
    const block = raw
      .split("\n")
      .map((l) => l.replace(/\/\/.*$/, ""))
      .join("\n");
    for (const banned of [
      "image",
      "bytes",
      "template",
      "selfie",
      "payload",
      "base64",
      "rawStripe",
      "rawAws",
      "embedding",
    ]) {
      assert.ok(!new RegExp(banned, "i").test(block), `binding model must not carry "${banned}"`);
    }
    // similarity is a BAND (string), never a raw score field.
    assert.ok(!/similarityScore/.test(block), "no raw similarity score");
    assert.ok(/similarityBand/.test(block), "band only");
  });

  // ---- migration is additive + idempotent --------------------------------
  check("migration SQL is additive and idempotent (no destructive statements)", () => {
    const sql = readFileSync(
      "prisma/migrations/20260719060000_face_identity_binding/migration.sql",
      "utf8",
    );
    assert.ok(!/\bDROP\s+(TABLE|COLUMN|TYPE|INDEX)\b/i.test(sql), "no DROP");
    assert.ok(!/\b(TRUNCATE|DELETE\s+FROM)\b/i.test(sql), "no TRUNCATE/DELETE");
    assert.ok(/ADD COLUMN IF NOT EXISTS "faceVerifiedAt"/.test(sql), "additive column");
    assert.ok(/CREATE TABLE IF NOT EXISTS "FaceIdentityBinding"/.test(sql), "additive table");
    assert.ok(/duplicate_object/.test(sql), "guarded enum/constraint creation (idempotent)");
  });

  console.log(`\n${passed} checks passed`);
}

main();
