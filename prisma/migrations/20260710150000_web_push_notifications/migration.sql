-- Web Push notification backend.
--
-- UserSettings gains safety/account per-channel toggles and quiet hours
-- (UserSettings IS the spec's NotificationPreference model). New tables:
--   PushSubscription     - one browser/device endpoint per row; public
--                          subscription material ONLY (endpoint/p256dh/auth).
--                          The VAPID private key is env-only, never stored.
--   NotificationDelivery - per-channel outbox rows for a Notification with
--                          retry bookkeeping (attempt/nextAttemptAt).
--   ConversationPresence - "user is viewing this conversation" heartbeats
--                          used to suppress push for visible messages.

-- Enums ----------------------------------------------------------------
CREATE TYPE "DeliveryChannel" AS ENUM ('PUSH', 'EMAIL', 'SMS', 'IN_APP');
CREATE TYPE "DeliveryStatus" AS ENUM ('PENDING', 'SENT', 'DELIVERED', 'FAILED', 'DEAD', 'SUPPRESSED');

-- UserSettings ----------------------------------------------------------
ALTER TABLE "UserSettings"
  ADD COLUMN "safetyPush"        BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "accountPush"       BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "safetyEmail"       BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "accountEmail"      BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "safetySms"         BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "accountSms"        BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "quietHoursEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "quietHoursStart"   INTEGER,
  ADD COLUMN "quietHoursEnd"     INTEGER,
  ADD COLUMN "timezone"          TEXT;

-- PushSubscription -------------------------------------------------------
CREATE TABLE "PushSubscription" (
  "id"             TEXT NOT NULL,
  "userId"         TEXT NOT NULL,
  "endpoint"       TEXT NOT NULL,
  "p256dh"         TEXT NOT NULL,
  "auth"           TEXT NOT NULL,
  "userAgent"      TEXT,
  "platform"       TEXT,
  "browser"        TEXT,
  "deviceLabel"    TEXT,
  "installationId" TEXT,
  "enabled"        BOOLEAN NOT NULL DEFAULT true,
  "lastSeenAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSuccessAt"  TIMESTAMP(3),
  "lastFailureAt"  TIMESTAMP(3),
  "failureCount"   INTEGER NOT NULL DEFAULT 0,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL,
  "revokedAt"      TIMESTAMP(3),

  CONSTRAINT "PushSubscription_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PushSubscription_endpoint_key" ON "PushSubscription"("endpoint");
CREATE INDEX "PushSubscription_userId_enabled_idx" ON "PushSubscription"("userId", "enabled");

ALTER TABLE "PushSubscription"
  ADD CONSTRAINT "PushSubscription_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- NotificationDelivery ----------------------------------------------------
CREATE TABLE "NotificationDelivery" (
  "id"                TEXT NOT NULL,
  "notificationId"    TEXT NOT NULL,
  "channel"           "DeliveryChannel" NOT NULL,
  "status"            "DeliveryStatus" NOT NULL DEFAULT 'PENDING',
  "provider"          TEXT,
  "providerMessageId" TEXT,
  "attempt"           INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt"     TIMESTAMP(3),
  "errorCode"         TEXT,
  "errorMessage"      TEXT,
  "idempotencyKey"    TEXT NOT NULL,
  "sentAt"            TIMESTAMP(3),
  "deliveredAt"       TIMESTAMP(3),
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "NotificationDelivery_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "NotificationDelivery_idempotencyKey_key" ON "NotificationDelivery"("idempotencyKey");
CREATE INDEX "NotificationDelivery_notificationId_channel_idx" ON "NotificationDelivery"("notificationId", "channel");
CREATE INDEX "NotificationDelivery_status_createdAt_idx" ON "NotificationDelivery"("status", "createdAt");

ALTER TABLE "NotificationDelivery"
  ADD CONSTRAINT "NotificationDelivery_notificationId_fkey"
  FOREIGN KEY ("notificationId") REFERENCES "Notification"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ConversationPresence ------------------------------------------------------
CREATE TABLE "ConversationPresence" (
  "id"             TEXT NOT NULL,
  "userId"         TEXT NOT NULL,
  "conversationId" TEXT NOT NULL,
  "lastSeenAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ConversationPresence_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ConversationPresence_userId_conversationId_key" ON "ConversationPresence"("userId", "conversationId");
CREATE INDEX "ConversationPresence_conversationId_lastSeenAt_idx" ON "ConversationPresence"("conversationId", "lastSeenAt");

ALTER TABLE "ConversationPresence"
  ADD CONSTRAINT "ConversationPresence_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
