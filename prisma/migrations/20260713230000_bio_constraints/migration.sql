-- Bio feature: database-level protection to back the API validation.
-- Forward-only and expand-safe:
--  1. Normalize the historical '' rows to NULL (bounded backfill - the
--     canonical "no bio" is NULL; verified 3 rows at authoring time).
--  2. CHECK constraint mirroring BIO_MAX_LENGTH = 500. Chosen over a
--     Text -> VarChar(500) type change: identical protection, no table
--     rewrite, no risk to concurrent reads.
UPDATE "Profile" SET bio = NULL WHERE bio = '';

ALTER TABLE "Profile"
  ADD CONSTRAINT "Profile_bio_max_length" CHECK (bio IS NULL OR char_length(bio) <= 500);
