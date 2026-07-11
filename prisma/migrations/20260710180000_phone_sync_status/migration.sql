-- Phone -> auth.users identity-sync state. Durable reconciliation instead
-- of best-effort fire-and-forget: every verified phone carries an explicit
-- sync disposition, and FAILED rows are repairable (admin re-sync or the
-- reconciliation service) without re-running the Twilio verification.
--
-- NULL phoneSyncStatus = the account has no verified phone (or predates a
-- verification). PENDING = app claim committed, auth.users write not yet
-- confirmed. SYNCED = auth.users.phone proven equal to phoneE164 (GoTrue
-- stores it WITHOUT the leading '+'). FAILED = the admin write failed or
-- the service-role key was absent; phoneSyncErrorCode says why.
DO $$ BEGIN
  CREATE TYPE "PhoneSyncStatus" AS ENUM ('PENDING', 'SYNCED', 'FAILED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "phoneSyncStatus" "PhoneSyncStatus";
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "phoneSyncErrorCode" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "phoneSyncUpdatedAt" TIMESTAMP(3);

-- Backfill: rows verified before this migration never had an admin-client
-- sync attempt - PENDING is the honest state; the reconciliation service
-- picks them up once SUPABASE_SERVICE_ROLE_KEY exists.
UPDATE "User"
SET "phoneSyncStatus" = 'PENDING', "phoneSyncUpdatedAt" = NOW()
WHERE "phoneVerifiedAt" IS NOT NULL AND "phoneSyncStatus" IS NULL;

-- Deliberately NO index on "phoneCountryIso": verified across the codebase
-- (2026-07-10) - the column is only ever written (verify flows) and read by
-- primary key, never used in a WHERE/ORDER BY. Add one only when a real
-- query needs it.
-- Deliberately NO "pendingPhoneE164" column: phoneE164 is written in exactly
-- one place (the final-success transaction after Twilio approval), so a
-- change-in-progress never overwrites the old number early - approval-gated
-- writes already satisfy the "old number stays until approval" requirement.
