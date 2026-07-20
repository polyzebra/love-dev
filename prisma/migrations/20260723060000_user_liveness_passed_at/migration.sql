-- L8.1 Trust entry gate: the AWS Face Liveness pass timestamp.
-- Additive + nullable + idempotent: safe to apply while the entry gate is
-- dormant (the column is written by the liveness PASS handler but gates
-- nothing until LIVENESS_ENTRY_GATE + a configured provider make it active).
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "livenessPassedAt" TIMESTAMP(3);
