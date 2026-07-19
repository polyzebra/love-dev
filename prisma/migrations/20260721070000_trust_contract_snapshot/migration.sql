-- L6.6 Trust Contract: enrich the immutable verified-gallery snapshot with the
-- explicit verified photo id set and the snapshot timestamp. Additive only.

ALTER TABLE "User" ADD COLUMN "verifiedPhotoIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "User" ADD COLUMN "verifiedGallerySnapshotAt" TIMESTAMP(3);

-- Backfill: for users whose badge is preserved (verified + not suspended),
-- record their current photo id set + a snapshot timestamp so the snapshot is
-- complete from day one. The version gate remains the authoritative check.
UPDATE "User" AS u
SET "verifiedPhotoIds" = COALESCE(sub.ids, ARRAY[]::TEXT[]),
    "verifiedGallerySnapshotAt" = NOW()
FROM (
  SELECT "userId", array_agg("id") AS ids
  FROM "Photo"
  GROUP BY "userId"
) AS sub
WHERE sub."userId" = u."id"
  AND u."photoVerifiedAt" IS NOT NULL
  AND u."faceBadgeSuspendedAt" IS NULL;
