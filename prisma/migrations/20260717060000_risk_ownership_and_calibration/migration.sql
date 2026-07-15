-- Risk signal ownership + calibration stamping + admin queue performance.
-- Additive only.

-- AlterTable: signal-ownership marker (double-count fix, PRR TD-2)
ALTER TABLE "AccountViolation" ADD COLUMN "source" TEXT;

-- Backfill: face-created violations are identifiable by their stable
-- internalReason codes (set exclusively by createFaceViolation).
UPDATE "AccountViolation" SET "source" = 'face_verification'
WHERE "internalReason" IN ('cover_not_confirmed', 'aggregate_mismatch_risk', 'duplicate_impersonation')
  AND "source" IS NULL;

-- AlterTable: risk band snapshot (PRR TD-3) + calibration versioning
ALTER TABLE "ProfilePhotoVerification"
  ADD COLUMN "riskBand" TEXT,
  ADD COLUMN "calibrationVersion" TEXT;
ALTER TABLE "PhotoFaceCheck" ADD COLUMN "calibrationVersion" TEXT;

-- CreateIndex: queue claiming path (status, updatedAt) - oldest-first
CREATE INDEX "ProfilePhotoVerification_status_updatedAt_idx" ON "ProfilePhotoVerification"("status", "updatedAt");
