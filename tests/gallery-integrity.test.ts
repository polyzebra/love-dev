/**
 * L6.5 - Verified Badge Integrity Lockdown. Pure + source-contract proof that a
 * blue Verified badge can NEVER survive a MATERIAL gallery change without a
 * fresh Photo Verification. No DB, no env. Run with:
 *   npx tsx tests/gallery-integrity.test.ts
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

const read = (p: string) => readFileSync(p, "utf8");

async function main() {
  const { isMaterialGalleryChange, computeGalleryHash, MATERIAL_GALLERY_REASONS } =
    await import("../src/lib/services/gallery-integrity");
  const { isPubliclyVerified } = await import("../src/lib/services/verification");
  const D = new Date();

  // ---- PHASE A: one canonical material-change classifier -----------------
  await check("every material reason is material; only pure reorder is not", () => {
    for (const r of MATERIAL_GALLERY_REASONS) {
      assert.equal(isMaterialGalleryChange(r), true, `${r} must be material`);
    }
    assert.equal(isMaterialGalleryChange("photos_reordered"), false);
    // Fail-safe: an unknown reason is treated as material (invalidate, never
    // silently keep a badge).
    assert.equal(isMaterialGalleryChange("some_unknown_future_reason"), true);
  });

  // ---- gallery hash: order-insensitive except cover ----------------------
  await check("pure reorder keeps the hash; add/delete/replace/cover change it", () => {
    const a = { id: "a", mediaVersion: 0, isCover: true };
    const b = { id: "b", mediaVersion: 0, isCover: false };
    const c = { id: "c", mediaVersion: 0, isCover: false };
    const base = computeGalleryHash([a, b, c]);
    // Pure reorder of NON-cover photos -> identical hash (policy-allowed).
    assert.equal(computeGalleryHash([a, c, b]), base, "reorder must not change hash");
    // Add a photo -> different.
    assert.notEqual(
      computeGalleryHash([a, b, c, { id: "d", mediaVersion: 0, isCover: false }]),
      base,
    );
    // Delete a photo -> different.
    assert.notEqual(computeGalleryHash([a, b]), base);
    // Replace bytes (mediaVersion bump) -> different.
    assert.notEqual(computeGalleryHash([{ ...a, mediaVersion: 1 }, b, c]), base);
    // Change cover -> different.
    assert.notEqual(
      computeGalleryHash([{ ...a, isCover: false }, { ...b, isCover: true }, c]),
      base,
    );
  });

  // ---- PHASE F/G: the badge decision requires the CURRENT gallery ---------
  await check("isPubliclyVerified: ON only when current gallery == verified gallery", () => {
    const on = {
      photoVerifiedAt: D,
      faceBadgeSuspendedAt: null,
      galleryVersion: 3,
      verifiedGalleryVersion: 3,
    };
    assert.equal(isPubliclyVerified(on), true);
    // Gallery moved on -> OFF (the core lockdown).
    assert.equal(isPubliclyVerified({ ...on, galleryVersion: 4 }), false);
    // Never snapshotted -> OFF.
    assert.equal(isPubliclyVerified({ ...on, verifiedGalleryVersion: null }), false);
    // Suspended -> OFF.
    assert.equal(isPubliclyVerified({ ...on, faceBadgeSuspendedAt: D }), false);
    // No identity -> OFF.
    assert.equal(isPubliclyVerified({ ...on, photoVerifiedAt: null }), false);
  });

  // ---- SOURCE CONTRACT: every gallery mutation invalidates synchronously --
  await check("upload / delete / reorder(cover) call invalidateBadgeOnGalleryChange", () => {
    const upload = read("src/app/api/photos/route.ts");
    const del = read("src/app/api/photos/[id]/route.ts");
    const reorder = read("src/app/api/photos/reorder/route.ts");
    for (const [name, src] of [
      ["upload", upload],
      ["delete", del],
      ["reorder", reorder],
    ] as const) {
      assert.ok(
        /invalidateBadgeOnGalleryChange\(/.test(src),
        `${name} route must call invalidateBadgeOnGalleryChange`,
      );
      // Invalidation must be inside a transaction (same-mutation guarantee).
      assert.ok(/\$transaction\(/.test(src), `${name} route must invalidate in a transaction`);
      assert.ok(/{ tx }/.test(src), `${name} route must pass the mutation tx to the invalidator`);
    }
  });

  // ---- SOURCE CONTRACT: the badge gate itself ----------------------------
  await check(
    "the version gate lives in the ONE resolver; verification delegates + selects it",
    () => {
      // L6.6: the comparison lives in the canonical resolver; isPubliclyVerified
      // delegates to it (see tests/trust-contract-governance.test.ts for the
      // no-fork guard).
      const resolver = read("src/lib/trust/verification-state-machine.ts");
      assert.ok(
        /f\.verifiedGalleryVersion === f\.galleryVersion/.test(resolver),
        "the resolver must compare verifiedGalleryVersion to galleryVersion",
      );
      const v = read("src/lib/services/verification.ts");
      assert.ok(
        /return publicBadgeVisible\(/.test(v),
        "isPubliclyVerified must delegate to the resolver",
      );
      // The compile-forced select carries both fields (anchor on the actual
      // declaration, not the earlier doc-comment mention; read to the closer).
      const decl = v.indexOf("export const PUBLIC_BADGE_SELECT");
      const sel = v.slice(decl, v.indexOf("satisfies Prisma.UserSelect", decl));
      assert.ok(/galleryVersion: true/.test(sel), "PUBLIC_BADGE_SELECT must select galleryVersion");
      assert.ok(
        /verifiedGalleryVersion: true/.test(sel),
        "PUBLIC_BADGE_SELECT must select verifiedGalleryVersion",
      );
    },
  );

  // ---- SOURCE CONTRACT: only a fresh verification restores the badge ------
  await check("badge restored ONLY via snapshotVerifiedGallery on approval", () => {
    const outcome = read("src/lib/services/photo-verification.ts");
    const review = read("src/lib/services/verification.ts");
    assert.ok(
      /snapshotVerifiedGallery\(tx,/.test(outcome),
      "provider approval must snapshot the verified gallery",
    );
    assert.ok(
      /snapshotVerifiedGallery\(tx,/.test(review),
      "admin approval must snapshot the verified gallery",
    );
    // Webhook safety (Phase H): a late approval only snapshots when the gallery
    // is unchanged since the session started.
    assert.ok(
      /galleryVersionAtStart/.test(outcome),
      "approval must guard on galleryVersionAtStart (webhook safety)",
    );
    const start = read("src/app/api/verification/photo/start/route.ts");
    assert.ok(
      /galleryVersionAtStart: me\.galleryVersion/.test(start),
      "start route must pin galleryVersionAtStart",
    );
  });

  console.log(`\n${passed} checks passed`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
