-- Epic 1 / F1: positive "Photo Verified" projection (User.faceVerifiedAt) +
-- identity<->liveness binding evidence (FaceIdentityBinding). ADDITIVE and
-- IDEMPOTENT only - safe to re-apply. INERT while the face provider is
-- dormant: faceVerifiedAt stays NULL and nothing reads it in this phase. No
-- production AWS FaceIds exist (provider dormant), so no biometric backfill.
-- No destructive statements.

-- 1. Positive grant projection (NULL for every existing user).
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "faceVerifiedAt" TIMESTAMP(3);

-- 2. Binding enums (guarded so re-apply is a no-op).
DO $$ BEGIN
  CREATE TYPE "FaceBindingMethod" AS ENUM ('STRIPE_SELFIE_COMPARE','HUMAN_REVIEW','PROVIDER_NATIVE');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "FaceBindingStatus" AS ENUM ('NOT_BOUND','BINDING_REQUIRED','BINDING_IN_PROGRESS','BOUND','BINDING_FAILED','MANUAL_REVIEW','PROVIDER_UNAVAILABLE','CONSENT_WITHDRAWN');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- 3. Binding evidence table (normalized evidence only - no images/templates/payloads).
CREATE TABLE IF NOT EXISTS "FaceIdentityBinding" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "faceReferenceId" TEXT,
  "identityVerificationId" TEXT,
  "identitySessionId" TEXT,
  "livenessFlowId" TEXT,
  "method" "FaceBindingMethod" NOT NULL,
  "provider" TEXT NOT NULL,
  "status" "FaceBindingStatus" NOT NULL DEFAULT 'BINDING_REQUIRED',
  "similarityBand" TEXT,
  "modelVersion" TEXT,
  "thresholdVersion" TEXT,
  "failureReasonCode" TEXT,
  "boundAt" TIMESTAMP(3),
  "reviewedById" TEXT,
  "reviewedAt" TIMESTAMP(3),
  "reviewReasonCode" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "FaceIdentityBinding_pkey" PRIMARY KEY ("id")
);

-- 4. Indexes (lifecycle policy: one binding per liveness capture).
CREATE UNIQUE INDEX IF NOT EXISTS "FaceIdentityBinding_livenessFlowId_key" ON "FaceIdentityBinding"("livenessFlowId");
CREATE INDEX IF NOT EXISTS "FaceIdentityBinding_userId_status_idx" ON "FaceIdentityBinding"("userId", "status");
CREATE INDEX IF NOT EXISTS "FaceIdentityBinding_faceReferenceId_idx" ON "FaceIdentityBinding"("faceReferenceId");
CREATE INDEX IF NOT EXISTS "FaceIdentityBinding_status_idx" ON "FaceIdentityBinding"("status");

-- 5. Foreign keys (guarded for idempotent re-apply). Cross-user integrity is
-- enforced here: a binding's userId/reviewedById/faceReferenceId must exist.
DO $$ BEGIN
  ALTER TABLE "FaceIdentityBinding" ADD CONSTRAINT "FaceIdentityBinding_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "FaceIdentityBinding" ADD CONSTRAINT "FaceIdentityBinding_reviewedById_fkey"
    FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "FaceIdentityBinding" ADD CONSTRAINT "FaceIdentityBinding_faceReferenceId_fkey"
    FOREIGN KEY ("faceReferenceId") REFERENCES "FaceReferenceRecord"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
