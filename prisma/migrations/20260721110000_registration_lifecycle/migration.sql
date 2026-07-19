-- L7.3.8: registration lifecycle columns + safe backfill for existing users.
-- Additive, non-destructive, idempotent. Preserves every existing ACTIVE user.

-- 1) New metadata columns.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "registrationStartedAt"   TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "onboardingCompletedAt"   TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "registrationCompletedAt" TIMESTAMP(3);

-- 2) Every existing row started registering when its app row was created.
UPDATE "User"
   SET "registrationStartedAt" = "createdAt"
 WHERE "registrationStartedAt" IS NULL;

-- 3) Backfill completion for users who ALREADY finished (onboardingDone=true),
--    regardless of current status - completion is a historical fact orthogonal
--    to a later suspension. Grandfathered accounts keep their status and become
--    registration-complete (they never lose access, and are never re-laddered
--    by this migration).
UPDATE "User"
   SET "registrationCompletedAt" = COALESCE("registrationCompletedAt", "createdAt"),
       "onboardingCompletedAt"   = COALESCE("onboardingCompletedAt", "createdAt")
 WHERE "onboardingDone" = true;

-- 4) The correctness fix: any account currently ACTIVE but NOT onboarded was
--    prematurely active (the exact bug L7.3.8 closes). Move it to PENDING so it
--    is invisible/unusable until it finishes. Its session still mints and the
--    gate routes it to the next step, so it loses no ability to COMPLETE
--    registration - only its premature visibility. ACTIVE+onboarded users are
--    untouched.
UPDATE "User"
   SET "status" = 'PENDING'
 WHERE "status" = 'ACTIVE'
   AND "onboardingDone" = false;
