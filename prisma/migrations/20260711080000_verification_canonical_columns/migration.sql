-- Verification canon: the verdict lives on User columns
-- (emailVerified / phoneVerifiedAt / photoVerifiedAt); Verification rows
-- are provider workflow state only (see src/lib/services/verification.ts).

-- 1) Backfill User.photoVerifiedAt for accounts whose PHOTO review was
--    APPROVED before reviewVerification started stamping the column.
UPDATE "User" u
SET "photoVerifiedAt" = v."updatedAt"
FROM "Verification" v
WHERE v."userId" = u."id"
  AND v."type" = 'PHOTO'
  AND v."status" = 'APPROVED'
  AND u."photoVerifiedAt" IS NULL;

-- 2) Remove phantom EMAIL/PHONE Verification rows (seed artifacts).
--    Email and phone verdicts have always lived on the User columns;
--    no code path creates or reads these rows anymore.
DELETE FROM "Verification" WHERE "type" IN ('EMAIL', 'PHONE');
