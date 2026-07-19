/**
 * Verification presentation (unit, no DB). After L6.7.2 the dormant Epic-4
 * dual-badge fork (publicVerificationBadge / isPhotoVerifiedBadge /
 * ownerVerificationPresentation / VERIFICATION_BADGE_LABEL) is REMOVED. This
 * suite now pins the LIVE presentation mapper, the single canonical badge
 * component, and asserts the fork stays gone.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  deriveVerificationPresentation,
  FACE_STATE_COPY,
} from "../src/lib/verification-presentation";

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ok - ${name}`);
}

const read = (p: string) => readFileSync(p, "utf8");

function main() {
  // ---- LIVE presentation mapper (identity x face-layer -> ONE state) ------
  check("deriveVerificationPresentation maps the canonical identity states", () => {
    assert.equal(deriveVerificationPresentation("not_verified", null), "not_started");
    assert.equal(deriveVerificationPresentation("verified", null), "verified");
    assert.equal(deriveVerificationPresentation("manual_review", null), "manual_review");
    assert.equal(deriveVerificationPresentation("failed", null), "failed");
    // Identity verified but the face layer withheld the badge (photos changed).
    assert.equal(
      deriveVerificationPresentation("requires_reverification", null),
      "action_required",
    );
  });

  check("consent withdrawal overrides to consent_withdrawn", () => {
    assert.equal(
      deriveVerificationPresentation("verified", null, { consentWithdrawn: true }),
      "consent_withdrawn",
    );
  });

  check("FACE_STATE_COPY carries the owner-facing copy the card renders", () => {
    for (const k of [
      "checking_profile_photos",
      "photo_update_review",
      "action_required",
      "consent_withdrawn",
    ]) {
      assert.ok(k in FACE_STATE_COPY, `FACE_STATE_COPY has ${k}`);
    }
  });

  // ---- F-3 regression: the dormant dual-badge fork is GONE ----------------
  check("F-3: the forked dual-badge exports no longer exist", () => {
    const src = read("src/lib/verification-presentation.ts");
    for (const gone of [
      "publicVerificationBadge",
      "isPhotoVerifiedBadge",
      "ownerVerificationPresentation",
      "VERIFICATION_BADGE_LABEL",
    ]) {
      assert.ok(
        !new RegExp(`export (function|const|type) ${gone}\\b`).test(src),
        `${gone} must not be exported (removed fork)`,
      );
    }
  });

  // ---- L6.6: ONE canonical Verified badge (no tiers, no dishonest label) ---
  check("VerifiedBadge is the single 'Verified' badge with the canonical description", () => {
    const src = read("src/components/shared/verified-badge.tsx");
    assert.ok(!/tier\s*[:=?]/.test(src), "the tier prop/param is retired");
    assert.ok(/VERIFIED_BADGE_LABEL = "Verified"/.test(src), "single 'Verified' label");
    assert.ok(
      /belong to that verified person/.test(src),
      "carries the canonical trust description",
    );
    assert.ok(!/aria-label="Photo verified"/.test(src), "no dishonest label");
  });

  console.log(`\n${passed} checks passed`);
}

main();
