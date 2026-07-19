-- L6.7.2 (F-5): database-level protection backing the Trust Contract's
-- application invariants. Defense-in-depth against a manual DB edit or a future
-- stray writer forging a badge by tampering with the version columns.
--
-- Both constraints are guaranteed valid against ALL existing data:
--   * galleryVersion defaults to 0 and is only ever incremented -> always >= 0.
--   * verifiedGalleryVersion is stamped EQUAL to galleryVersion at snapshot time
--     and galleryVersion only increases afterwards -> always <= galleryVersion;
--     it is NULL for never-verified users (allowed). The L6.5/L6.6 backfills set
--     both to 0 for preserved badges (0 <= 0). No legitimate row is rejected.
--
-- Prisma does not model CHECK constraints in the schema; this repo already adds
-- raw CHECKs the same way (see 20260713230000_bio_constraints), and migrate diff
-- tolerates them (no schema drift). Forward-only.

ALTER TABLE "User"
  ADD CONSTRAINT "User_galleryVersion_nonneg" CHECK ("galleryVersion" >= 0);

ALTER TABLE "User"
  ADD CONSTRAINT "User_verifiedGalleryVersion_bounded"
  CHECK ("verifiedGalleryVersion" IS NULL OR "verifiedGalleryVersion" <= "galleryVersion");
