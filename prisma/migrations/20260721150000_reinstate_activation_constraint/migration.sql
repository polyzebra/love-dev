-- L7.3.9: reinstate the immutable activation invariant at the database.
-- DEPLOY-COUPLED: this migration is intended to be applied by `migrate deploy`
-- as part of the L7.3.8/L7.3.9 CODE deploy (the release gate applies migrations
-- immediately before the new build is activated - docs/RELEASE.md), because the
-- new build is the first one that creates accounts as PENDING and activates
-- them only via the canonical activator. On a fresh database (CI) it applies in
-- sequence with everything else, so CI always tests the constraint live.
--
-- An ACTIVE account MUST have a completed registration: no feature, admin, or
-- future migration can activate an account that did not finish the ladder.
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
