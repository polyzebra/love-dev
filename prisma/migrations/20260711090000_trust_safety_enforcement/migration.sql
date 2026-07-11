-- Trust & safety enforcement backbone (2026-07-11)
-- Applied via `prisma db push` (this project has no _prisma_migrations
-- table); this file is the hand-kept record of the SQL involved, per the
-- repo convention in prisma/migrations/.

-- ---------------------------------------------------------------------------
-- 1. AccountStatus ladder: active | limited | photo_review_required |
--    suspended | banned (mapped onto the EXISTING enum - no parallel field).
-- ---------------------------------------------------------------------------
ALTER TYPE "AccountStatus" ADD VALUE IF NOT EXISTS 'LIMITED';
ALTER TYPE "AccountStatus" ADD VALUE IF NOT EXISTS 'PHOTO_REVIEW_REQUIRED';
ALTER TYPE "AccountStatus" ADD VALUE IF NOT EXISTS 'BANNED';

-- ---------------------------------------------------------------------------
-- 2. New enums
-- ---------------------------------------------------------------------------
CREATE TYPE "ModerationCaseType" AS ENUM ('PHOTO_MISMATCH','STOLEN_IMAGES','EXPLICIT_CONTENT','MINOR_SAFETY','IMPERSONATION','SPAM','HARASSMENT','SCAM','PAYMENT_ABUSE','OTHER');
CREATE TYPE "ModerationCaseStatus" AS ENUM ('OPEN','UNDER_REVIEW','ACTION_TAKEN','DISMISSED','APPEALED','REVERSED');
CREATE TYPE "CaseSeverity" AS ENUM ('LOW','MEDIUM','HIGH','CRITICAL');
CREATE TYPE "CaseSource" AS ENUM ('AUTOMATED','USER_REPORT','ADMIN','SYSTEM');
CREATE TYPE "PhotoModerationResultStatus" AS ENUM ('APPROVED','REJECTED','NEEDS_REVIEW','FAILED');
CREATE TYPE "EnforcementAction" AS ENUM ('WARNING','PHOTO_REMOVED','UPLOAD_BLOCKED','LIMITED','SUSPENDED','BANNED');
CREATE TYPE "AppealStatus" AS ENUM ('SUBMITTED','PENDING_REVIEW','APPROVED','REJECTED');
CREATE TYPE "BannedCredentialKind" AS ENUM ('PHONE','DEVICE');
CREATE TYPE "SafetyRecommendedAction" AS ENUM ('NO_ACTION','SHOW_WARNING','REQUIRE_PHOTO_VERIFICATION','HIDE_PROFILE','LIMIT_MESSAGING','SUSPEND_ACCOUNT','BAN_ACCOUNT','SEND_TO_MANUAL_REVIEW');

-- ---------------------------------------------------------------------------
-- 3. Trust-engine composite columns on User (separate from the login risk
--    engine's riskScore - risk.ts owns that; see schema comment).
-- ---------------------------------------------------------------------------
ALTER TABLE "User"
  ADD COLUMN "safetyRiskScore" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "safetyRiskReasons" TEXT,
  ADD COLUMN "safetyRecommendedAction" "SafetyRecommendedAction",
  ADD COLUMN "safetyRiskUpdatedAt" TIMESTAMP(3);

-- ---------------------------------------------------------------------------
-- 4. New tables
-- ---------------------------------------------------------------------------
CREATE TABLE "ModerationCase" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "caseType" "ModerationCaseType" NOT NULL,
  "status" "ModerationCaseStatus" NOT NULL DEFAULT 'OPEN',
  "severity" "CaseSeverity" NOT NULL,
  "source" "CaseSource" NOT NULL,
  "confidence" DOUBLE PRECISION,
  "summary" TEXT NOT NULL,
  "evidence" JSONB,
  "photoId" TEXT,
  "reportId" TEXT,
  "reviewedById" TEXT,
  "reviewedAt" TIMESTAMP(3),
  "decisionReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ModerationCase_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ModerationCase_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "ModerationCase_userId_status_idx" ON "ModerationCase"("userId", "status");
CREATE INDEX "ModerationCase_status_severity_createdAt_idx" ON "ModerationCase"("status", "severity", "createdAt");

CREATE TABLE "PhotoModerationResult" (
  "id" TEXT NOT NULL,
  "photoId" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "resultStatus" "PhotoModerationResultStatus" NOT NULL,
  "detectedLabels" JSONB NOT NULL DEFAULT '[]',
  "faceCount" INTEGER,
  "adultScore" DOUBLE PRECISION,
  "violenceScore" DOUBLE PRECISION,
  "minorRiskScore" DOUBLE PRECISION,
  "aiGeneratedScore" DOUBLE PRECISION,
  "duplicateMatchScore" DOUBLE PRECISION,
  "reverseImageRisk" DOUBLE PRECISION,
  "confidence" DOUBLE PRECISION,
  "rawProviderReference" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PhotoModerationResult_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PhotoModerationResult_photoId_fkey" FOREIGN KEY ("photoId") REFERENCES "Photo"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "PhotoModerationResult_photoId_createdAt_idx" ON "PhotoModerationResult"("photoId", "createdAt");

CREATE TABLE "AccountViolation" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "violationType" "ModerationCaseType" NOT NULL,
  "actionTaken" "EnforcementAction" NOT NULL,
  "description" TEXT NOT NULL,
  "userVisibleReason" TEXT NOT NULL,
  "internalReason" TEXT,
  "expiresAt" TIMESTAMP(3),
  "appealAllowed" BOOLEAN NOT NULL DEFAULT true,
  "reversedAt" TIMESTAMP(3),
  "moderationCaseId" TEXT,
  -- On the violation itself (not only the case): cases dedupe per
  -- user+type, so a merged case's photoId cannot drive an accurate
  -- reversal.
  "photoId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AccountViolation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AccountViolation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "AccountViolation_moderationCaseId_fkey" FOREIGN KEY ("moderationCaseId") REFERENCES "ModerationCase"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "AccountViolation_userId_createdAt_idx" ON "AccountViolation"("userId", "createdAt");
CREATE INDEX "AccountViolation_userId_actionTaken_expiresAt_idx" ON "AccountViolation"("userId", "actionTaken", "expiresAt");

CREATE TABLE "Appeal" (
  "id" TEXT NOT NULL,
  "violationId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "status" "AppealStatus" NOT NULL DEFAULT 'SUBMITTED',
  "appealText" TEXT NOT NULL,
  "adminNotes" TEXT,
  "reviewedById" TEXT,
  "reviewedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Appeal_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Appeal_violationId_fkey" FOREIGN KEY ("violationId") REFERENCES "AccountViolation"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "Appeal_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "Appeal_violationId_status_idx" ON "Appeal"("violationId", "status");
CREATE INDEX "Appeal_userId_createdAt_idx" ON "Appeal"("userId", "createdAt");
CREATE INDEX "Appeal_status_createdAt_idx" ON "Appeal"("status", "createdAt");

CREATE TABLE "BannedCredential" (
  "id" TEXT NOT NULL,
  "kind" "BannedCredentialKind" NOT NULL,
  "value" TEXT NOT NULL,
  "reason" TEXT,
  "sourceUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3),
  CONSTRAINT "BannedCredential_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "BannedCredential_kind_value_key" ON "BannedCredential"("kind", "value");
CREATE INDEX "BannedCredential_sourceUserId_idx" ON "BannedCredential"("sourceUserId");

-- ---------------------------------------------------------------------------
-- 5. RLS - defense in depth against PostgREST.
--
-- Audit finding (2026-07-11): the anon/authenticated roles hold table grants
-- on every public table, PostgREST is enabled on this Supabase project, and
-- the pre-existing convention is "RLS enabled with ZERO policies" (deny by
-- default) - 20 of 32 tables already ship that way; 12 newer tables were
-- missed and were readable through PostgREST. The app itself reads
-- exclusively through Prisma as the table OWNER (postgres), which RLS does
-- not apply to (no FORCE ROW LEVEL SECURITY), so enabling RLS is a no-op for
-- the app and a hard deny for PostgREST.
--
-- DELIBERATE choice: deny-by-default ONLY, no user-own-read policies. The
-- spec's user-own-read policies would expose AccountViolation.internalReason
-- and ModerationCase confidence/evidence to their subject via PostgREST -
-- exactly the fields the read model (getAccountStatusView) exists to strip.
-- All user reads go through the server API, which returns user-visible
-- fields only.
-- ---------------------------------------------------------------------------
ALTER TABLE "ModerationCase" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PhotoModerationResult" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AccountViolation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Appeal" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "BannedCredential" ENABLE ROW LEVEL SECURITY;

-- Close the pre-existing gap on the 12 exposed tables from earlier
-- milestones (same deny-by-default convention as the other 20).
ALTER TABLE "AnalyticsEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AuthVerificationEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "BlockedIdentity" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ConversationPresence" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ExploreCategory" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "FirstMessage" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "NotificationDelivery" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PhotoModerationEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ProfilePrompt" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PushSubscription" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "UserExplorePreference" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "UserSettings" ENABLE ROW LEVEL SECURITY;
