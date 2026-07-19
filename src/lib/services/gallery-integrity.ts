import { createHash } from "node:crypto";
import { db } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";

/**
 * L6.5 - Verified Badge Integrity Lockdown.
 *
 * THE canonical source of truth for "did the gallery MATERIALLY change, so the
 * blue Verified badge must turn OFF now?" and for stamping the snapshot that
 * turns it back on.
 *
 * PRODUCT CONTRACT: the blue badge promises "the current public profile belongs
 * to the verified person and the currently visible photos have passed
 * verification." If the system can no longer guarantee that, the badge MUST
 * disappear immediately.
 *
 * MECHANISM (provider-independent, synchronous, no worker/cache/webhook wait):
 *   - every material gallery mutation increments User.galleryVersion INSIDE the
 *     mutation transaction (invalidateBadgeOnGalleryChange);
 *   - the public badge (isPubliclyVerified) requires
 *     verifiedGalleryVersion === galleryVersion, so the increment ALONE turns
 *     the badge off - even when the face-match layer is dormant;
 *   - verification approval stamps verifiedGalleryVersion = galleryVersion
 *     (snapshotVerifiedGallery) - the ONLY thing that turns the badge back on.
 *
 * SERVER-ONLY (imports @/lib/db). Never pull into a client bundle.
 */

/**
 * PHASE A - the canonical material-change vocabulary. Every gallery-mutating
 * path passes exactly one of these. A MATERIAL change alters the visible
 * gallery identity and MUST invalidate the badge. Pure reordering is the ONLY
 * non-material change, and only because product policy explicitly allows it
 * (the verified set and cover are unchanged - see computeGalleryHash).
 */
export const MATERIAL_GALLERY_REASONS = [
  "photo_uploaded", // any new image (incl. screenshot / AI / another person / group / child)
  "photo_deleted", // a visible photo removed
  "cover_changed", // the cover photo replaced or re-crowned
  "photo_replaced", // an existing slot swapped for a different image
  "bytes_replaced", // same slot, rewritten bytes (crop / rotate / recompress)
  "photo_restored", // a previously deleted photo brought back
  "moderation_rejected", // a photo pulled by moderation
  "admin_removed", // staff removed a photo
] as const;

/** Non-material changes (product-policy allowed to keep the badge). */
export const NON_MATERIAL_GALLERY_REASONS = ["photos_reordered"] as const;

export type MaterialGalleryReason = (typeof MATERIAL_GALLERY_REASONS)[number];
export type NonMaterialGalleryReason = (typeof NON_MATERIAL_GALLERY_REASONS)[number];
export type GalleryChangeReason = MaterialGalleryReason | NonMaterialGalleryReason;

const MATERIAL = new Set<string>(MATERIAL_GALLERY_REASONS);

/**
 * PHASE A - the single canonical classifier. One implementation, one source of
 * truth. Anything not explicitly non-material is treated as material
 * (fail-safe: an unknown reason invalidates rather than silently keeping a
 * badge).
 */
export function isMaterialGalleryChange(reason: GalleryChangeReason | string): boolean {
  return reason !== "photos_reordered";
}

/** Narrow assertion companion (kept in sync with MATERIAL_GALLERY_REASONS). */
export function isKnownMaterialReason(reason: string): reason is MaterialGalleryReason {
  return MATERIAL.has(reason);
}

type HashPhoto = { id: string; mediaVersion: number; isCover: boolean };

/**
 * Deterministic verified-gallery hash: the cover id plus the SORTED set of
 * `id@mediaVersion` for every photo. Order-insensitive for non-cover photos, so
 * a pure reorder yields the SAME hash (policy), while any add / delete /
 * byte-replace (mediaVersion bump) / cover change yields a DIFFERENT hash.
 * Stored as an audit + defense-in-depth anchor alongside the version.
 */
export function computeGalleryHash(photos: HashPhoto[]): string {
  const cover = photos.find((p) => p.isCover)?.id ?? "none";
  const set = photos
    .map((p) => `${p.id}@${p.mediaVersion}`)
    .sort()
    .join(",");
  return createHash("sha256").update(`cover:${cover}|set:${set}`).digest("hex");
}

/**
 * PHASE B/G - IMMEDIATE, synchronous badge invalidation on a material gallery
 * change. Two writes, both in the caller's transaction when `tx` is supplied:
 *
 *   1. Increment galleryVersion. This is the AUTHORITATIVE gate: it makes
 *      verifiedGalleryVersion !== galleryVersion, so isPubliclyVerified() is
 *      false on every surface on the next read - no worker, no cache, no
 *      provider dependency.
 *   2. For a currently-verified, not-yet-suspended user, set
 *      faceBadgeSuspendedAt + invalidation stamp (atomic conditional). This is
 *      the queryable projection that keeps PHOTO_VERIFIED_WHERE list filters and
 *      the owner reverification UX in lockstep with the version gate.
 *
 * Pass the mutation's `tx` so the badge-off commit is atomic with the gallery
 * write ("no delay, no background job" per contract).
 */
export async function invalidateBadgeOnGalleryChange(
  userId: string,
  reason: MaterialGalleryReason,
  opts: { tx?: Prisma.TransactionClient } = {},
): Promise<void> {
  const client = opts.tx ?? db;
  const now = new Date();
  // (1) Authoritative gate.
  await client.user.update({
    where: { id: userId },
    data: { galleryVersion: { increment: 1 } },
  });
  // (2) Projection for list filters + owner UX (only flips a live badge).
  await client.user.updateMany({
    where: { id: userId, photoVerifiedAt: { not: null }, faceBadgeSuspendedAt: null },
    data: {
      faceBadgeSuspendedAt: now,
      photoVerificationInvalidatedAt: now,
      photoVerificationInvalidationReason: reason,
    },
  });
}

/**
 * Best-effort side effects to run AFTER the invalidation transaction commits:
 * clear the dormant positive grant (faceVerifiedAt - a 0-row no-op in prod) and
 * write the audit event. Deliberately OUTSIDE the mutation transaction so a
 * telemetry/grant hiccup can never roll back the badge-off write. Never throws.
 */
export async function recordGalleryInvalidationSideEffects(
  userId: string,
  reason: MaterialGalleryReason,
): Promise<void> {
  try {
    const { clearPhotoVerification, PhotoClearReason } = await import("@/lib/services/photo-grant");
    await clearPhotoVerification(userId, PhotoClearReason.PHOTO_CHANGED, { actorType: "system" });
  } catch {
    // faceVerifiedAt is inert in production; nothing to clear.
  }
  try {
    const { recordVerificationAudit } = await import("@/lib/services/face-verification");
    await recordVerificationAudit({
      userId,
      eventType: "gallery_change_invalidated",
      actorType: "system",
      reasonCode: reason,
    });
  } catch {
    // Audit is best-effort and must never break the mutation.
  }
}

/**
 * PHASE D/F - stamp the verified-gallery snapshot: verifiedGalleryVersion =
 * current galleryVersion (+ cover + hash) and CLEAR the suspension/invalidation
 * stamps. This is the ONLY way the blue badge turns back on. Call inside the
 * verification-approval transaction (identity approval, face-match pass, or an
 * admin restore that follows a successful verification).
 */
export async function snapshotVerifiedGallery(
  tx: Prisma.TransactionClient,
  userId: string,
): Promise<{ version: number; hash: string; coverPhotoId: string | null }> {
  const photos = await tx.photo.findMany({
    where: { userId },
    orderBy: { position: "asc" },
    select: { id: true, mediaVersion: true, isCover: true },
  });
  const hash = computeGalleryHash(photos);
  const coverPhotoId = photos.find((p) => p.isCover)?.id ?? null;
  const u = await tx.user.findUnique({ where: { id: userId }, select: { galleryVersion: true } });
  const version = u?.galleryVersion ?? 0;
  await tx.user.update({
    where: { id: userId },
    data: {
      verifiedGalleryVersion: version,
      verifiedCoverPhotoId: coverPhotoId,
      verifiedGalleryHash: hash,
      // L6.6 immutable snapshot: the exact verified photo id set + timestamp.
      verifiedPhotoIds: photos.map((p) => p.id),
      verifiedGallerySnapshotAt: new Date(),
      faceBadgeSuspendedAt: null,
      photoVerificationInvalidatedAt: null,
      photoVerificationInvalidationReason: null,
    },
  });
  return { version, hash, coverPhotoId };
}
