-- L7.3.8: add the PENDING account status (registration in progress). MUST be
-- its own migration: Postgres forbids USING a new enum value in the same
-- transaction that ADDs it, so the backfill that sets status='PENDING' lives
-- in the next migration. Idempotent + additive; no data touched here.
ALTER TYPE "AccountStatus" ADD VALUE IF NOT EXISTS 'PENDING' BEFORE 'ACTIVE';
