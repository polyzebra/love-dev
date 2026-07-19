/**
 * L6.6 Phase B/L - the canonical verification state machine + public-badge
 * resolver. Pure, no DB. Proves: legal transitions accepted, illegal ones
 * rejected (a stale event can never resurrect a badge), resolveTrustState maps
 * facts to the right state, and publicBadgeVisible === (state === VERIFIED).
 *   npx tsx tests/verification-state-machine.test.ts
 */
import assert from "node:assert/strict";
import {
  TrustState,
  canTransition,
  assertTransition,
  IllegalTrustTransitionError,
  resolveTrustState,
  publicBadgeVisible,
  badgeVisibleForState,
} from "../src/lib/trust/verification-state-machine";

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ok - ${name}`);
}

const D = new Date();

function main() {
  // ---- illegal transitions are rejected (the core safety property) --------
  check("stale event can NEVER move INVALIDATED/SUSPENDED/FAILED/NOT_VERIFIED -> VERIFIED", () => {
    for (const from of [
      TrustState.INVALIDATED,
      TrustState.SUSPENDED,
      TrustState.FAILED,
      TrustState.NOT_VERIFIED,
      TrustState.PENDING,
    ]) {
      assert.equal(canTransition(from, TrustState.VERIFIED), false, `${from} -> VERIFIED illegal`);
      assert.throws(
        () => assertTransition(from, TrustState.VERIFIED),
        IllegalTrustTransitionError,
        `${from} -> VERIFIED must throw`,
      );
    }
  });

  check("the ONLY legal ways into VERIFIED are PROCESSING/UNDER_REVIEW/ADMIN_RESTORED", () => {
    const into = Object.values(TrustState).filter(
      (s) => canTransition(s, TrustState.VERIFIED) && s !== TrustState.VERIFIED,
    );
    assert.deepEqual(
      into.sort(),
      [TrustState.ADMIN_RESTORED, TrustState.PROCESSING, TrustState.UNDER_REVIEW].sort(),
    );
  });

  check("legal lifecycle transitions are accepted", () => {
    assert.ok(canTransition(TrustState.PROCESSING, TrustState.VERIFIED));
    assert.ok(canTransition(TrustState.VERIFIED, TrustState.INVALIDATED)); // gallery change
    assert.ok(canTransition(TrustState.INVALIDATED, TrustState.REQUIRES_REVERIFICATION));
    assert.ok(canTransition(TrustState.REQUIRES_REVERIFICATION, TrustState.PROCESSING));
    assert.ok(canTransition(TrustState.SUSPENDED, TrustState.ADMIN_RESTORED));
    assert.doesNotThrow(() => assertTransition(TrustState.PROCESSING, TrustState.VERIFIED));
  });

  // ---- resolveTrustState maps facts -> state ------------------------------
  check("resolveTrustState: identity + matching gallery + not suspended = VERIFIED", () => {
    assert.equal(
      resolveTrustState({
        photoVerifiedAt: D,
        faceBadgeSuspendedAt: null,
        galleryVersion: 5,
        verifiedGalleryVersion: 5,
      }),
      TrustState.VERIFIED,
    );
  });

  check("resolveTrustState: gallery moved on = INVALIDATED (badge OFF)", () => {
    assert.equal(
      resolveTrustState({
        photoVerifiedAt: D,
        faceBadgeSuspendedAt: new Date(),
        galleryVersion: 6,
        verifiedGalleryVersion: 5,
      }),
      TrustState.INVALIDATED,
    );
  });

  check("resolveTrustState: reverifying after a change = REQUIRES_REVERIFICATION", () => {
    assert.equal(
      resolveTrustState({
        photoVerifiedAt: D,
        faceBadgeSuspendedAt: new Date(),
        galleryVersion: 6,
        verifiedGalleryVersion: 5,
        reverifying: true,
      }),
      TrustState.REQUIRES_REVERIFICATION,
    );
  });

  check("resolveTrustState: pre-identity lifecycle", () => {
    const base = {
      photoVerifiedAt: null,
      faceBadgeSuspendedAt: null,
      galleryVersion: 0,
      verifiedGalleryVersion: null,
    };
    assert.equal(resolveTrustState(base), TrustState.NOT_VERIFIED);
    assert.equal(resolveTrustState({ ...base, workflowStatus: "PENDING" }), TrustState.PENDING);
    assert.equal(
      resolveTrustState({ ...base, workflowStatus: "PENDING", hasOpenSession: true }),
      TrustState.PROCESSING,
    );
    assert.equal(
      resolveTrustState({ ...base, workflowStatus: "IN_REVIEW" }),
      TrustState.UNDER_REVIEW,
    );
    assert.equal(resolveTrustState({ ...base, workflowStatus: "REJECTED" }), TrustState.FAILED);
  });

  check("resolveTrustState: face-layer suspension / review", () => {
    const base = {
      photoVerifiedAt: D,
      faceBadgeSuspendedAt: new Date(),
      galleryVersion: 1,
      verifiedGalleryVersion: 1,
    };
    assert.equal(resolveTrustState({ ...base, faceStatus: "SUSPENDED" }), TrustState.SUSPENDED);
    assert.equal(
      resolveTrustState({ ...base, faceStatus: "MANUAL_REVIEW" }),
      TrustState.UNDER_REVIEW,
    );
    // versions match but suspended for a non-gallery reason -> SUSPENDED
    assert.equal(resolveTrustState(base), TrustState.SUSPENDED);
  });

  // ---- the badge shows IFF state === VERIFIED -----------------------------
  check(
    "publicBadgeVisible === (resolveTrustState === VERIFIED) for every identity-verified case",
    () => {
      const cases = [
        {
          photoVerifiedAt: D,
          faceBadgeSuspendedAt: null,
          galleryVersion: 2,
          verifiedGalleryVersion: 2,
        }, // VERIFIED
        {
          photoVerifiedAt: D,
          faceBadgeSuspendedAt: null,
          galleryVersion: 3,
          verifiedGalleryVersion: 2,
        }, // INVALIDATED
        {
          photoVerifiedAt: D,
          faceBadgeSuspendedAt: new Date(),
          galleryVersion: 2,
          verifiedGalleryVersion: 2,
        }, // SUSPENDED
        {
          photoVerifiedAt: D,
          faceBadgeSuspendedAt: null,
          galleryVersion: 0,
          verifiedGalleryVersion: null,
        }, // never snapshotted
        {
          photoVerifiedAt: null,
          faceBadgeSuspendedAt: null,
          galleryVersion: 0,
          verifiedGalleryVersion: null,
        }, // NOT_VERIFIED
      ];
      for (const c of cases) {
        assert.equal(
          publicBadgeVisible(c),
          badgeVisibleForState(resolveTrustState(c)),
          `parity for ${JSON.stringify(c)}`,
        );
      }
    },
  );

  console.log(`\n${passed} checks passed`);
}

main();
