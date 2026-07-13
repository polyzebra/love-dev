-- Phase 0H: generalize PushSubscription into a transport-neutral device
-- registry (model NotificationDevice, same physical table). Purely
-- additive: web push rows keep working untouched (transport defaults to
-- WEB_PUSH); endpoint/keys become nullable so APNS/FCM rows can carry an
-- opaque token instead.

-- CreateEnum
CREATE TYPE "NotificationTransport" AS ENUM ('WEB_PUSH', 'APNS', 'FCM');

-- AlterTable
ALTER TABLE "PushSubscription"
  ADD COLUMN "transport" "NotificationTransport" NOT NULL DEFAULT 'WEB_PUSH',
  ADD COLUMN "token" TEXT,
  ADD COLUMN "appVersion" TEXT,
  ADD COLUMN "environment" TEXT NOT NULL DEFAULT 'production',
  ALTER COLUMN "endpoint" DROP NOT NULL,
  ALTER COLUMN "p256dh" DROP NOT NULL,
  ALTER COLUMN "auth" DROP NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "PushSubscription_token_key" ON "PushSubscription"("token");
