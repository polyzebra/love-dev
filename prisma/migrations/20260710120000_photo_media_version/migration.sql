-- Photo.mediaVersion: bumped when the storage objects behind a photoId are
-- rewritten in place (repair/reprocess), so the /api/media ETag changes and
-- clients holding the old immutable response refetch the new bytes.
ALTER TABLE "Photo" ADD COLUMN "mediaVersion" INTEGER NOT NULL DEFAULT 0;
