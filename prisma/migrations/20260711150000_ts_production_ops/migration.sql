-- Trust & safety production ops (2026-07-11)
-- Applied via `prisma db push` (this project has no _prisma_migrations
-- table); this file is the hand-kept record of the SQL involved, per the
-- repo convention in prisma/migrations/.
--
-- Covers: email delivery lifecycle (webhook states + suppression list),
-- moderation SLA/assignment columns, appeal lifecycle states + timeline,
-- and provider health tracking for the moderation fallback chain.

-- ---------------------------------------------------------------------------
-- 1. Email delivery lifecycle
-- ---------------------------------------------------------------------------
ALTER TYPE "DeliveryStatus" ADD VALUE IF NOT EXISTS 'BOUNCED';
ALTER TYPE "DeliveryStatus" ADD VALUE IF NOT EXISTS 'COMPLAINED';

-- Provider webhooks (delivered/bounced/complained) look up by message id.
CREATE INDEX "NotificationDelivery_providerMessageId_idx"
  ON "NotificationDelivery"("providerMessageId");

CREATE TABLE "SuppressedEmail" (
  "id" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "reason" TEXT NOT NULL, -- hard_bounce | complaint | manual
  "sourceMessageId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SuppressedEmail_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SuppressedEmail_email_key" ON "SuppressedEmail"("email");
CREATE INDEX "SuppressedEmail_createdAt_idx" ON "SuppressedEmail"("createdAt");

-- ---------------------------------------------------------------------------
-- 2. Moderation SLA / assignment (policy constants in trust-safety.ts:
--    critical 4h, high 24h, medium 72h, low 7d)
-- ---------------------------------------------------------------------------
ALTER TABLE "ModerationCase"
  ADD COLUMN "priority" "CaseSeverity" NOT NULL DEFAULT 'MEDIUM',
  ADD COLUMN "slaDueAt" TIMESTAMP(3),
  ADD COLUMN "assignedToId" TEXT,
  ADD COLUMN "firstResponseAt" TIMESTAMP(3),
  ADD COLUMN "resolvedAt" TIMESTAMP(3),
  ADD COLUMN "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "escalatedAt" TIMESTAMP(3);

CREATE INDEX "ModerationCase_status_slaDueAt_idx" ON "ModerationCase"("status", "slaDueAt");
CREATE INDEX "ModerationCase_assignedToId_status_idx" ON "ModerationCase"("assignedToId", "status");

-- One-time backfill for rows created before this migration:
-- priority mirrors severity; slaDueAt derives from createdAt + the policy;
-- lastActivityAt approximates from updatedAt; resolved cases stamp
-- resolvedAt from reviewedAt.
UPDATE "ModerationCase" SET
  "priority" = "severity",
  "lastActivityAt" = "updatedAt",
  "slaDueAt" = "createdAt" + CASE "severity"
    WHEN 'CRITICAL' THEN INTERVAL '4 hours'
    WHEN 'HIGH'     THEN INTERVAL '24 hours'
    WHEN 'MEDIUM'   THEN INTERVAL '72 hours'
    ELSE                 INTERVAL '7 days'
  END,
  "resolvedAt" = CASE
    WHEN "status" IN ('ACTION_TAKEN','DISMISSED','REVERSED') THEN COALESCE("reviewedAt", "updatedAt")
    ELSE NULL
  END,
  "firstResponseAt" = CASE
    WHEN "reviewedAt" IS NOT NULL THEN "reviewedAt"
    ELSE NULL
  END;

-- ---------------------------------------------------------------------------
-- 3. Appeal lifecycle + timeline
-- ---------------------------------------------------------------------------
ALTER TYPE "AppealStatus" ADD VALUE IF NOT EXISTS 'UNDER_REVIEW';
ALTER TYPE "AppealStatus" ADD VALUE IF NOT EXISTS 'NEEDS_INFO';
ALTER TYPE "AppealStatus" ADD VALUE IF NOT EXISTS 'EXPIRED';
ALTER TYPE "AppealStatus" ADD VALUE IF NOT EXISTS 'WITHDRAWN';

CREATE TYPE "AppealActorRole" AS ENUM ('USER','STAFF','SYSTEM');

ALTER TABLE "Appeal" ADD COLUMN "needsInfoRequestedAt" TIMESTAMP(3);
CREATE INDEX "Appeal_status_needsInfoRequestedAt_idx"
  ON "Appeal"("status", "needsInfoRequestedAt");

CREATE TABLE "AppealEvent" (
  "id" TEXT NOT NULL,
  "appealId" TEXT NOT NULL,
  -- submitted | under_review | needs_info_requested | user_responded |
  -- approved | rejected | withdrawn | expired
  "type" TEXT NOT NULL,
  "actorRole" "AppealActorRole" NOT NULL,
  "note" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AppealEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AppealEvent_appealId_fkey" FOREIGN KEY ("appealId") REFERENCES "Appeal"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "AppealEvent_appealId_createdAt_idx" ON "AppealEvent"("appealId", "createdAt");

-- ---------------------------------------------------------------------------
-- 4. Provider health (moderation fallback chain)
-- ---------------------------------------------------------------------------
CREATE TABLE "ProviderHealth" (
  "id" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
  "totalFailures" INTEGER NOT NULL DEFAULT 0,
  "totalSuccesses" INTEGER NOT NULL DEFAULT 0,
  "lastError" TEXT,
  "lastErrorAt" TIMESTAMP(3),
  "lastSuccessAt" TIMESTAMP(3),
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProviderHealth_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ProviderHealth_provider_key" ON "ProviderHealth"("provider");

-- ---------------------------------------------------------------------------
-- 5. RLS - same deny-by-default convention as every other table (RLS enabled
--    with ZERO policies; the app reads through Prisma as table owner).
-- ---------------------------------------------------------------------------
ALTER TABLE "SuppressedEmail" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AppealEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ProviderHealth" ENABLE ROW LEVEL SECURITY;
