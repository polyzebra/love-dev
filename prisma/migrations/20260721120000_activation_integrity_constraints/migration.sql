-- L7.3.9: make impossible activation states impossible at the DATABASE.
-- Two CHECK constraints turn the registration contract into a hard invariant
-- no future code (or migration bug) can violate. Idempotent (guarded adds).

-- 1) An ACTIVE account MUST have a completed registration. This is the core
--    immutable contract: you cannot be ACTIVE without registrationCompletedAt,
--    so no feature/admin/migration can activate an account that did not finish
--    the ladder. (PENDING/LIMITED/SUSPENDED/... are unaffected.)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'User_active_requires_completed_registration'
      AND conrelid = 'public."User"'::regclass
  ) THEN
    ALTER TABLE public."User"
      ADD CONSTRAINT "User_active_requires_completed_registration"
      CHECK ("status" <> 'ACTIVE' OR "registrationCompletedAt" IS NOT NULL);
  END IF;
END
$$;

-- 2) A completed registration implies onboarding is done - completion is never
--    stamped without the terminal rung. Prevents a stray registrationCompletedAt
--    write from marking an un-onboarded account complete.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'User_completed_requires_onboarding'
      AND conrelid = 'public."User"'::regclass
  ) THEN
    ALTER TABLE public."User"
      ADD CONSTRAINT "User_completed_requires_onboarding"
      CHECK ("registrationCompletedAt" IS NULL OR "onboardingDone" = true);
  END IF;
END
$$;
