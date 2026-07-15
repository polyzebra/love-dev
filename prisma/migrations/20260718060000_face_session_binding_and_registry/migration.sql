-- Blocker remediation: liveness session ownership binding (C-1), reference
-- registry + saga (H-1/H-3), queue lease (H-2), LIVENESS_REQUIRED state
-- (C-2). Additive only. No production AWS FaceIds exist (provider dormant),
-- so no biometric backfill is required.

-- Enum additions (Postgres: ADD VALUE is additive, non-destructive)
ALTER TYPE "ProfilePhotoVerificationStatus" ADD VALUE IF NOT EXISTS 'LIVENESS_REQUIRED';
ALTER TYPE "ProfilePhotoVerificationStatus" ADD VALUE IF NOT EXISTS 'CLAIMED';

-- New enums
CREATE TYPE "LivenessSessionStatus" AS ENUM ('CREATED','PROCESSING','PASSED','FAILED','CONSUMED','EXPIRED','INVALIDATED');
CREATE TYPE "FaceReferenceRecordStatus" AS ENUM ('PENDING_PROVIDER','PROVIDER_CREATED','LINKED','LINK_FAILED','DELETE_PENDING','DELETED','DELETE_FAILED');

-- Queue lease fields (H-2)
ALTER TABLE "ProfilePhotoVerification"
  ADD COLUMN "leaseToken" TEXT,
  ADD COLUMN "leaseExpiresAt" TIMESTAMP(3),
  ADD COLUMN "claimedBy" TEXT,
  ADD COLUMN "attemptCount" INTEGER NOT NULL DEFAULT 0;

-- LivenessSession (C-1)
CREATE TABLE "LivenessSession" (
  "id" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "verificationId" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "environment" TEXT NOT NULL,
  "status" "LivenessSessionStatus" NOT NULL DEFAULT 'CREATED',
  "attemptNumber" INTEGER NOT NULL DEFAULT 1,
  "flowId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "consumedAt" TIMESTAMP(3),
  "invalidatedAt" TIMESTAMP(3),
  CONSTRAINT "LivenessSession_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "LivenessSession_sessionId_key" ON "LivenessSession"("sessionId");
CREATE UNIQUE INDEX "LivenessSession_flowId_key" ON "LivenessSession"("flowId");
CREATE INDEX "LivenessSession_userId_status_idx" ON "LivenessSession"("userId","status");
CREATE INDEX "LivenessSession_expiresAt_idx" ON "LivenessSession"("expiresAt");
ALTER TABLE "LivenessSession" ADD CONSTRAINT "LivenessSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LivenessSession" ADD CONSTRAINT "LivenessSession_verificationId_fkey" FOREIGN KEY ("verificationId") REFERENCES "ProfilePhotoVerification"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- FaceReferenceRecord registry (H-1/H-3)
CREATE TABLE "FaceReferenceRecord" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "verificationId" TEXT NOT NULL,
  "referenceVersion" INTEGER NOT NULL,
  "provider" TEXT NOT NULL,
  "environment" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "externalImageId" TEXT NOT NULL,
  "externalFaceId" TEXT,
  "status" "FaceReferenceRecordStatus" NOT NULL DEFAULT 'PENDING_PROVIDER',
  "livenessSessionId" TEXT,
  "deleteAttempts" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "linkedAt" TIMESTAMP(3),
  "deletedAt" TIMESTAMP(3),
  CONSTRAINT "FaceReferenceRecord_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "FaceReferenceRecord_idempotencyKey_key" ON "FaceReferenceRecord"("idempotencyKey");
CREATE INDEX "FaceReferenceRecord_userId_status_idx" ON "FaceReferenceRecord"("userId","status");
CREATE INDEX "FaceReferenceRecord_status_idx" ON "FaceReferenceRecord"("status");
CREATE INDEX "FaceReferenceRecord_externalFaceId_idx" ON "FaceReferenceRecord"("externalFaceId");
ALTER TABLE "FaceReferenceRecord" ADD CONSTRAINT "FaceReferenceRecord_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FaceReferenceRecord" ADD CONSTRAINT "FaceReferenceRecord_verificationId_fkey" FOREIGN KEY ("verificationId") REFERENCES "ProfilePhotoVerification"("id") ON DELETE CASCADE ON UPDATE CASCADE;
