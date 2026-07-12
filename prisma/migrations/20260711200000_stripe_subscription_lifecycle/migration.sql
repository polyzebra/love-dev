-- Canonical Stripe subscription lifecycle (2026-07-11)
-- Applied via `prisma db push` (this project has no _prisma_migrations
-- table); this file is the hand-kept record of the SQL involved, per the
-- repo convention in prisma/migrations/. The PlanTier rename was executed
-- FIRST via `prisma db execute` because db push cannot rename enum values
-- (it would drop/recreate and lose existing PREMIUM rows).

-- ---------------------------------------------------------------------------
-- 1. Plan naming: PREMIUM -> GOLD (in-place value rename, data preserved)
-- ---------------------------------------------------------------------------
ALTER TYPE "PlanTier" RENAME VALUE 'PREMIUM' TO 'GOLD';

-- ---------------------------------------------------------------------------
-- 2. Subscription status: full Stripe lifecycle + CHECKOUT_PENDING
--    (EXPIRED is kept as a legacy value; nothing writes it anymore)
-- ---------------------------------------------------------------------------
ALTER TYPE "SubscriptionStatus" ADD VALUE IF NOT EXISTS 'INCOMPLETE_EXPIRED';
ALTER TYPE "SubscriptionStatus" ADD VALUE IF NOT EXISTS 'UNPAID';
ALTER TYPE "SubscriptionStatus" ADD VALUE IF NOT EXISTS 'PAUSED';
ALTER TYPE "SubscriptionStatus" ADD VALUE IF NOT EXISTS 'CHECKOUT_PENDING';

-- ---------------------------------------------------------------------------
-- 3. Subscription: verified-Stripe-state columns + unique customer mapping
-- ---------------------------------------------------------------------------
ALTER TABLE "Subscription"
  ADD COLUMN "stripePriceId" TEXT,
  ADD COLUMN "currentPeriodStart" TIMESTAMP(3),
  ADD COLUMN "canceledAt" TIMESTAMP(3),
  ADD COLUMN "trialStart" TIMESTAMP(3),
  ADD COLUMN "trialEnd" TIMESTAMP(3),
  ADD COLUMN "checkoutSessionId" TEXT,
  ADD COLUMN "lastStripeEventId" TEXT,
  ADD COLUMN "syncedAt" TIMESTAMP(3);

-- One Stripe customer maps to exactly one user, ever.
CREATE UNIQUE INDEX "Subscription_providerCustomerId_key"
  ON "Subscription"("providerCustomerId");

-- ---------------------------------------------------------------------------
-- 4. Durable webhook idempotency ledger
-- ---------------------------------------------------------------------------
CREATE TABLE "StripeEvent" (
  "id" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "processedAt" TIMESTAMP(3),

  CONSTRAINT "StripeEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "StripeEvent_type_receivedAt_idx"
  ON "StripeEvent"("type", "receivedAt");
