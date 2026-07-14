-- Verification hardening: audit + reconciliation-throttle timestamps.
-- Additive + bounded backfill (statusChangedAt seeded from updatedAt for
-- existing rows - the closest available approximation at migration time).
ALTER TABLE "Verification"
  ADD COLUMN "statusChangedAt" TIMESTAMP(3),
  ADD COLUMN "lastReconciledAt" TIMESTAMP(3);

UPDATE "Verification" SET "statusChangedAt" = "updatedAt" WHERE "statusChangedAt" IS NULL;
