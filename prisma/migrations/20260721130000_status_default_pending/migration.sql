-- L7.3.9: make PENDING the DB-level default for User.status. This is the
-- backward-compatible companion to the activation-integrity CHECK constraint:
-- any code path that inserts a User WITHOUT an explicit status (including a
-- build that predates the "born PENDING" change) now gets PENDING - which is
-- both the intended lifecycle start AND constraint-safe (ACTIVE would require
-- registrationCompletedAt). New rows are correctly invisible until activated.
ALTER TABLE "User" ALTER COLUMN "status" SET DEFAULT 'PENDING';
