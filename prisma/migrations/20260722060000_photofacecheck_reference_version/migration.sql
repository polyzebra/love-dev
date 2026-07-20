-- L6.13: persist the reference generation each PhotoFaceCheck was computed
-- against (reference-currency stamp). Additive + nullable + non-destructive:
-- existing rows stay NULL and therefore fail the per-photo badge predicate
-- (fail-closed), and the legacy whole-gallery badge is unaffected. Written
-- transactionally with the verdict by the worker; never inferred later.
ALTER TABLE "PhotoFaceCheck" ADD COLUMN IF NOT EXISTS "referenceVersion" INTEGER;

-- The badge predicate resolves the current-version check per photo; this index
-- keeps that lookup (userId + photoId + version + reference) efficient at the
-- max gallery size without an N+1.
CREATE INDEX IF NOT EXISTS "PhotoFaceCheck_userId_photoId_photoVersion_referenceVersion_idx"
  ON "PhotoFaceCheck" ("userId", "photoId", "photoVersion", "referenceVersion");
