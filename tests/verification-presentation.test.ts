/**
 * Epic 4 (unit, no DB): the canonical dual-badge presentation model. Proves
 * the migration semantics WITHOUT any backfill or write:
 *   - legacy user (photoVerifiedAt set, faceVerifiedAt null) -> Identity only
 *   - new user (both null) -> nothing
 *   - binding complete but no grant -> still Identity only
 *   - grant present (faceVerifiedAt set) -> Photo Verified
 *   - public badge exposes only IDENTITY_VERIFIED | PHOTO_VERIFIED | null
 *   - owner states carry explanations; public never sees internal states
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  isIdentityVerified,
  isPhotoVerifiedBadge,
  publicVerificationBadge,
  ownerVerificationPresentation,
  VERIFICATION_BADGE_LABEL,
} from "../src/lib/verification-presentation";

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ok - ${name}`);
}

const D = new Date();

function main() {
  // ---- legacy user: Identity only, never Photo -----------------------
  check("legacy user (photoVerifiedAt set, faceVerifiedAt null) -> Identity ONLY", () => {
    const u = { photoVerifiedAt: D, faceVerifiedAt: null };
    assert.equal(isIdentityVerified(u), true);
    assert.equal(isPhotoVerifiedBadge(u), false);
    assert.equal(publicVerificationBadge(u), "IDENTITY_VERIFIED");
    const owner = ownerVerificationPresentation(u);
    assert.equal(owner.identityVerified, true);
    assert.equal(owner.photoVerified, false);
    assert.equal(owner.photo.state, "IDENTITY_VERIFIED");
    assert.ok(/earn this badge/i.test(owner.photo.body), "explains how to earn Photo Verified");
  });

  check("faceVerifiedAt absent (never selected) still reads as NOT photo-verified", () => {
    const u = { photoVerifiedAt: D }; // no faceVerifiedAt key at all
    assert.equal(isPhotoVerifiedBadge(u), false);
    assert.equal(publicVerificationBadge(u), "IDENTITY_VERIFIED");
  });

  // ---- new user: nothing ---------------------------------------------
  check("new user (both null) -> no badge", () => {
    const u = { photoVerifiedAt: null, faceVerifiedAt: null };
    assert.equal(publicVerificationBadge(u), null);
    assert.equal(isIdentityVerified(u), false);
  });

  // ---- binding complete but no grant -> still Identity only ----------
  check("identity + bound but no MATCH grant (faceVerifiedAt null) -> Identity only", () => {
    const u = { photoVerifiedAt: D, faceVerifiedAt: null };
    // grant refused for lack of match -> owner needs to fix cover; badge = Identity.
    assert.equal(publicVerificationBadge(u), "IDENTITY_VERIFIED");
    assert.equal(
      ownerVerificationPresentation(u, "NO_MATCH").photo.state,
      "NEEDS_PHOTO_VERIFICATION",
    );
  });

  // ---- grant present -> Photo Verified -------------------------------
  check("faceVerifiedAt set -> Photo Verified (highest public tier)", () => {
    const u = { photoVerifiedAt: D, faceVerifiedAt: D };
    assert.equal(isPhotoVerifiedBadge(u), true);
    assert.equal(publicVerificationBadge(u), "PHOTO_VERIFIED");
    assert.equal(ownerVerificationPresentation(u).photo.state, "PHOTO_VERIFIED");
  });

  // ---- owner state matrix (server passes the grant reason) -----------
  check("owner states map from the grant reason", () => {
    const u = { photoVerifiedAt: D, faceVerifiedAt: null };
    assert.equal(ownerVerificationPresentation(u, "NO_BINDING").photo.state, "BINDING_REQUIRED");
    assert.equal(
      ownerVerificationPresentation(u, "CONSENT_REQUIRED").photo.state,
      "CONSENT_REQUIRED",
    );
    assert.equal(ownerVerificationPresentation(u, "UNDER_REVIEW").photo.state, "CHECKING");
    assert.equal(
      ownerVerificationPresentation(u, "PROVIDER_UNAVAILABLE").photo.state,
      "PROVIDER_UNAVAILABLE",
    );
    // dormant / provider disabled -> generic "earn it"
    assert.equal(
      ownerVerificationPresentation(u, "PROVIDER_DISABLED").photo.state,
      "IDENTITY_VERIFIED",
    );
  });

  // ---- public exposes ONLY the two badge tiers (no internal state) ---
  check("public badge is only IDENTITY_VERIFIED | PHOTO_VERIFIED | null", () => {
    for (const g of [
      "NO_BINDING",
      "CONSENT_REQUIRED",
      "UNDER_REVIEW",
      "NO_MATCH",
      "PROVIDER_UNAVAILABLE",
    ]) {
      const badge = publicVerificationBadge({ photoVerifiedAt: D, faceVerifiedAt: null });
      // the public badge ignores internal reasons entirely
      assert.ok(badge === "IDENTITY_VERIFIED", `public badge stays Identity regardless of ${g}`);
    }
    assert.deepEqual(Object.keys(VERIFICATION_BADGE_LABEL).sort(), [
      "IDENTITY_VERIFIED",
      "PHOTO_VERIFIED",
    ]);
    assert.equal(VERIFICATION_BADGE_LABEL.IDENTITY_VERIFIED, "Identity verified");
  });

  // ---- the shared badge no longer defaults to a dishonest "Photo verified"
  check("VerifiedBadge default tier is Identity (honest for all current users)", () => {
    const src = readFileSync("src/components/shared/verified-badge.tsx", "utf8");
    assert.ok(/tier = "IDENTITY_VERIFIED"/.test(src), "default tier is Identity");
    assert.ok(!/label = "Photo verified"/.test(src), "no dishonest default label");
  });

  console.log(`\n${passed} checks passed`);
}

main();
