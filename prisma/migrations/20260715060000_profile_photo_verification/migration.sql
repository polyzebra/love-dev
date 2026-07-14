-- Profile-photo verification (face match) - the SECOND verification layer.
-- Identity verification (Stripe, Verification type PHOTO + photoVerifiedAt)
-- is untouched. Fully additive: new enums, three new tables, one nullable
-- User column. No backfill required; the layer is dormant until
-- FACE_MATCH_PROVIDER is configured.

-- CreateEnum
CREATE TYPE "ProfilePhotoVerificationStatus" AS ENUM ('QUEUED', 'CHECKING', 'AUTO_VERIFIED', 'MANUAL_REVIEW', 'REJECTED', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "FaceBadgeStatus" AS ENUM ('NONE', 'ACTIVE', 'REVIEWING', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "FaceCheckClassification" AS ENUM ('OWNER_MATCHED', 'NO_FACE', 'GROUP_PHOTO', 'OTHER_PERSON_ONLY', 'UNCERTAIN', 'MANIPULATION_RISK');

-- CreateEnum
CREATE TYPE "FaceCheckDecision" AS ENUM ('PENDING', 'PASSED', 'ALLOWED', 'FLAGGED', 'REJECTED');

-- AlterTable: public badge = photoVerifiedAt && faceBadgeSuspendedAt IS NULL
ALTER TABLE "User" ADD COLUMN "faceBadgeSuspendedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "ProfilePhotoVerification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" TEXT,
    "referenceId" TEXT,
    "referenceVersion" INTEGER NOT NULL DEFAULT 0,
    "status" "ProfilePhotoVerificationStatus" NOT NULL DEFAULT 'QUEUED',
    "badgeStatus" "FaceBadgeStatus" NOT NULL DEFAULT 'NONE',
    "riskLevel" INTEGER NOT NULL DEFAULT 0,
    "consentVersion" TEXT,
    "consentAt" TIMESTAMP(3),
    "identitySessionId" TEXT,
    "lastRunAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProfilePhotoVerification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PhotoFaceCheck" (
    "id" TEXT NOT NULL,
    "verificationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "photoId" TEXT NOT NULL,
    "photoVersion" INTEGER NOT NULL,
    "isCoverAtCheck" BOOLEAN NOT NULL DEFAULT false,
    "classification" "FaceCheckClassification" NOT NULL,
    "decision" "FaceCheckDecision" NOT NULL DEFAULT 'PENDING',
    "faceCount" INTEGER,
    "ownerDetected" BOOLEAN,
    "similarityScore" DOUBLE PRECISION,
    "confidenceBand" TEXT,
    "qualityScore" DOUBLE PRECISION,
    "manipulationRisk" DOUBLE PRECISION,
    "failureReason" TEXT,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PhotoFaceCheck_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerificationAuditEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "verificationId" TEXT,
    "eventType" TEXT NOT NULL,
    "actorType" TEXT NOT NULL,
    "actorId" TEXT,
    "previousStatus" TEXT,
    "newStatus" TEXT,
    "reasonCode" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VerificationAuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProfilePhotoVerification_userId_key" ON "ProfilePhotoVerification"("userId");
CREATE INDEX "ProfilePhotoVerification_status_idx" ON "ProfilePhotoVerification"("status");
CREATE INDEX "ProfilePhotoVerification_badgeStatus_idx" ON "ProfilePhotoVerification"("badgeStatus");
CREATE UNIQUE INDEX "PhotoFaceCheck_photoId_photoVersion_verificationId_key" ON "PhotoFaceCheck"("photoId", "photoVersion", "verificationId");
CREATE INDEX "PhotoFaceCheck_userId_createdAt_idx" ON "PhotoFaceCheck"("userId", "createdAt");
CREATE INDEX "PhotoFaceCheck_decision_idx" ON "PhotoFaceCheck"("decision");
CREATE INDEX "VerificationAuditEvent_userId_createdAt_idx" ON "VerificationAuditEvent"("userId", "createdAt");
CREATE INDEX "VerificationAuditEvent_eventType_createdAt_idx" ON "VerificationAuditEvent"("eventType", "createdAt");

-- AddForeignKey
ALTER TABLE "ProfilePhotoVerification" ADD CONSTRAINT "ProfilePhotoVerification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PhotoFaceCheck" ADD CONSTRAINT "PhotoFaceCheck_verificationId_fkey" FOREIGN KEY ("verificationId") REFERENCES "ProfilePhotoVerification"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PhotoFaceCheck" ADD CONSTRAINT "PhotoFaceCheck_photoId_fkey" FOREIGN KEY ("photoId") REFERENCES "Photo"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "VerificationAuditEvent" ADD CONSTRAINT "VerificationAuditEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
