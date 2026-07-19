/**
 * The photo-verified badge must represent the CURRENT profile, not a
 * historical verification. When the face layer withholds the badge
 * (faceBadgeSuspendedAt set - the profile photos changed and no longer
 * confirm as the verified person), EVERY surface must agree: no badge,
 * state = requires_reverification, and the user is prompted to verify
 * again. This suite proves the single-lever consistency across every
 * derivation. Pure/unit: no DB, no provider. Run with:
 *   npx tsx tests/verification-badge-consistency.test.ts
 */
import "dotenv/config";
import assert from "node:assert/strict";

let passed = 0;
async function check(name: string, fn: () => void | Promise<void>): Promise<void> {
  await fn();
  passed += 1;
  console.log(`  ok - ${name}`);
}

async function main() {
  const { deriveVerificationUxState } = await import("../src/lib/services/photo-verification");
  const { toVerificationState, isPubliclyVerified, PHOTO_VERIFIED_WHERE } =
    await import("../src/lib/services/verification");
  const { deriveVerificationPresentation } = await import("../src/lib/verification-presentation");
  const { photoVerificationRow } = await import("../src/components/shared/verification-status-row");

  const VERIFIED = new Date("2026-01-01");
  const SUSPENDED = new Date("2026-07-01");
  const source = (photoVerifiedAt: Date | null, faceBadgeSuspendedAt: Date | null) => ({
    emailVerified: VERIFIED,
    phoneVerifiedAt: VERIFIED,
    photoVerifiedAt,
    faceBadgeSuspendedAt,
    verifications: [] as Array<{ type: "PHOTO"; status: "APPROVED"; updatedAt: Date }>,
  });

  console.log("badge lever: faceBadgeSuspendedAt withholds the badge everywhere");
  await check(
    "isPubliclyVerified: verified+not-suspended -> true; verified+suspended -> false",
    () => {
      assert.equal(
        isPubliclyVerified({
          photoVerifiedAt: VERIFIED,
          faceBadgeSuspendedAt: null,
          galleryVersion: 0,
          verifiedGalleryVersion: 0,
        }),
        true,
      );
      assert.equal(
        isPubliclyVerified({
          photoVerifiedAt: VERIFIED,
          faceBadgeSuspendedAt: SUSPENDED,
          galleryVersion: 0,
          verifiedGalleryVersion: 0,
        }),
        false,
      );
    },
  );

  await check(
    "toVerificationState: suspended -> photoVerified FALSE + requiresReverification TRUE",
    () => {
      const live = toVerificationState(source(VERIFIED, null));
      assert.equal(live.photoVerified, true);
      assert.equal(live.requiresReverification, false);

      const held = toVerificationState(source(VERIFIED, SUSPENDED));
      assert.equal(
        held.photoVerified,
        false,
        "owner profile + account + admin no longer show verified",
      );
      assert.equal(held.requiresReverification, true);

      const never = toVerificationState(source(null, null));
      assert.equal(never.photoVerified, false);
      assert.equal(
        never.requiresReverification,
        false,
        "never verified != requires reverification",
      );
    },
  );

  await check("PHOTO_VERIFIED_WHERE list filter excludes suspended badges", () => {
    assert.deepEqual(PHOTO_VERIFIED_WHERE, {
      photoVerifiedAt: { not: null },
      faceBadgeSuspendedAt: null,
    });
  });

  console.log("UX state machine: NOT_VERIFIED / VERIFIED / REQUIRES_REVERIFICATION");
  await check("deriveVerificationUxState maps suspension to requires_reverification", () => {
    const v = deriveVerificationUxState({
      photoVerifiedAt: VERIFIED,
      faceBadgeSuspendedAt: null,
      verification: null,
    });
    assert.equal(v, "verified");
    const r = deriveVerificationUxState({
      photoVerifiedAt: VERIFIED,
      faceBadgeSuspendedAt: SUSPENDED,
      verification: null,
    });
    assert.equal(
      r,
      "requires_reverification",
      "verified-but-suspended is NEVER a plain 'verified'",
    );
    const n = deriveVerificationUxState({
      photoVerifiedAt: null,
      faceBadgeSuspendedAt: null,
      verification: null,
    });
    assert.equal(n, "not_verified");
  });

  console.log("presentation + row never present a withheld badge as verified");
  await check("presentation: requires_reverification never returns 'verified'", () => {
    // No live face job to read -> steer to the re-verify prompt.
    assert.equal(
      deriveVerificationPresentation("requires_reverification", null),
      "action_required",
    );
    // Face job says the cover was rejected -> action_required (replace photo).
    assert.equal(
      deriveVerificationPresentation("requires_reverification", {
        status: "REJECTED",
        lastRunAt: SUSPENDED,
      }),
      "action_required",
    );
    // Plain verified still verifies.
    assert.equal(deriveVerificationPresentation("verified", null), "verified");
  });

  await check("status row: requires_reverification -> needs-action + 'Verify Photos'", () => {
    const row = photoVerificationRow("requires_reverification", {
      configured: true,
      surface: "profile",
    });
    assert.equal(row.state, "needs-action");
    assert.equal(row.value, "Your profile photos changed");
    assert.equal(row.action?.label, "Verify Photos");
    assert.ok(row.action?.href.endsWith("#photo-verification"));
    // The verified state stays clean (badge, no action).
    assert.equal(
      photoVerificationRow("verified", { configured: true, surface: "profile" }).state,
      "verified",
    );
  });

  console.log(`\n${passed} checks passed`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
