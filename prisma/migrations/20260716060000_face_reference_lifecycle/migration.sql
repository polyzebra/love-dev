-- Face reference lifecycle + duplicate identity classification.
-- Additive-only: two enums, seven nullable/defaulted columns on
-- ProfilePhotoVerification. Existing rows: referenceStatus stays NULL
-- (never enrolled) unless a referenceId exists - those become ACTIVE.

-- CreateEnum
CREATE TYPE "FaceReferenceStatus" AS ENUM ('ACTIVE', 'EXPIRING', 'EXPIRED', 'REVOKED', 'DELETED', 'ROTATING');

-- CreateEnum
CREATE TYPE "DuplicateIdentityClass" AS ENUM ('UNKNOWN', 'SELF_RESTORE', 'LIKELY_DUPLICATE', 'LIKELY_IMPERSONATION', 'TWIN_RISK', 'FAMILY_RESEMBLANCE', 'LOW_CONFIDENCE');

-- AlterTable
ALTER TABLE "ProfilePhotoVerification"
  ADD COLUMN "referenceStatus" "FaceReferenceStatus",
  ADD COLUMN "providerModelVersion" TEXT,
  ADD COLUMN "providerRegion" TEXT,
  ADD COLUMN "lastValidatedAt" TIMESTAMP(3),
  ADD COLUMN "rotationReason" TEXT,
  ADD COLUMN "duplicateClass" "DuplicateIdentityClass" NOT NULL DEFAULT 'UNKNOWN',
  ADD COLUMN "duplicateCheckedAt" TIMESTAMP(3);

-- Backfill: rows that already hold a provider reference are ACTIVE.
UPDATE "ProfilePhotoVerification" SET "referenceStatus" = 'ACTIVE' WHERE "referenceId" IS NOT NULL;
