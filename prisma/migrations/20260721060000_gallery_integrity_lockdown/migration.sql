-- L6.5 Verified Badge Integrity Lockdown.
-- The blue Verified badge must represent the CURRENT verified gallery, never a
-- historical verification. galleryVersion increments on every MATERIAL gallery
-- change; verifiedGalleryVersion is the snapshot stamped when verification
-- passes. The public badge requires the two to be equal, so any material change
-- turns the badge off synchronously (no worker/cache/webhook/provider dependency).

ALTER TABLE "User" ADD COLUMN "galleryVersion" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "User" ADD COLUMN "verifiedGalleryVersion" INTEGER;
ALTER TABLE "User" ADD COLUMN "verifiedCoverPhotoId" TEXT;
ALTER TABLE "User" ADD COLUMN "verifiedGalleryHash" TEXT;
ALTER TABLE "User" ADD COLUMN "photoVerificationInvalidatedAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN "photoVerificationInvalidationReason" TEXT;

ALTER TABLE "Verification" ADD COLUMN "galleryVersionAtStart" INTEGER;

-- Backfill: preserve the badge for users who are ALREADY verified (identity
-- stamped and not face-suspended) by adopting their CURRENT gallery as the
-- verified baseline. galleryVersion starts at 0 for everyone, so setting
-- verifiedGalleryVersion = 0 makes the badge gate (verifiedGalleryVersion ===
-- galleryVersion) pass today. The first material change after this migration
-- bumps galleryVersion to 1 and invalidates the badge until reverification.
UPDATE "User"
SET "verifiedGalleryVersion" = 0
WHERE "photoVerifiedAt" IS NOT NULL AND "faceBadgeSuspendedAt" IS NULL;

-- Record the current cover for those same users (audit + cover-equality checks).
-- The gallery hash is intentionally left NULL at backfill: it is recomputed on
-- the next reverification. The authoritative badge gate is version equality, so
-- a NULL hash never resurrects or withholds a badge on its own.
UPDATE "User" AS u
SET "verifiedCoverPhotoId" = p."id"
FROM "Photo" AS p
WHERE p."userId" = u."id"
  AND p."isCover" = TRUE
  AND u."photoVerifiedAt" IS NOT NULL
  AND u."faceBadgeSuspendedAt" IS NULL;
