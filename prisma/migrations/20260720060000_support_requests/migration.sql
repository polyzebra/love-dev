-- P1.3 Support platform: SupportRequest + SupportNote (+ enums).
-- Forward-only, idempotent, non-destructive. Applied via db:apply-migration.

DO $$ BEGIN
  CREATE TYPE "SupportCategory" AS ENUM (
    'TECHNICAL','ACCOUNT','SUBSCRIPTION','REFUND','IDENTITY_VERIFICATION',
    'PHOTO_VERIFICATION','PRIVACY','SAFETY','APPEAL','BUSINESS','PRESS','OTHER'
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "SupportStatus" AS ENUM ('OPEN','IN_PROGRESS','WAITING_USER','RESOLVED','CLOSED');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "SupportPriority" AS ENUM ('LOW','NORMAL','HIGH','URGENT');
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE TABLE IF NOT EXISTS "SupportRequest" (
  "id"             TEXT NOT NULL,
  "category"       "SupportCategory" NOT NULL,
  "status"         "SupportStatus" NOT NULL DEFAULT 'OPEN',
  "priority"       "SupportPriority" NOT NULL DEFAULT 'NORMAL',
  "name"           TEXT NOT NULL,
  "email"          TEXT NOT NULL,
  "accountEmail"   TEXT,
  "reference"      TEXT,
  "message"        TEXT NOT NULL,
  "ipHash"         TEXT,
  "userId"         TEXT,
  "spam"           BOOLEAN NOT NULL DEFAULT false,
  "assignedAdmin"  TEXT,
  "dedupeHash"     TEXT,
  "emailDelivered" BOOLEAN NOT NULL DEFAULT false,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "closedAt"       TIMESTAMP(3),
  CONSTRAINT "SupportRequest_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "SupportNote" (
  "id"        TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "authorId"  TEXT,
  "body"      TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SupportNote_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
  ALTER TABLE "SupportNote"
    ADD CONSTRAINT "SupportNote_requestId_fkey"
    FOREIGN KEY ("requestId") REFERENCES "SupportRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE INDEX IF NOT EXISTS "SupportRequest_status_createdAt_idx"    ON "SupportRequest"("status","createdAt");
CREATE INDEX IF NOT EXISTS "SupportRequest_category_status_idx"     ON "SupportRequest"("category","status");
CREATE INDEX IF NOT EXISTS "SupportRequest_assignedAdmin_status_idx" ON "SupportRequest"("assignedAdmin","status");
CREATE INDEX IF NOT EXISTS "SupportRequest_email_createdAt_idx"     ON "SupportRequest"("email","createdAt");
CREATE INDEX IF NOT EXISTS "SupportRequest_dedupeHash_createdAt_idx" ON "SupportRequest"("dedupeHash","createdAt");
CREATE INDEX IF NOT EXISTS "SupportNote_requestId_createdAt_idx"    ON "SupportNote"("requestId","createdAt");
