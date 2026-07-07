-- CreateEnum
CREATE TYPE "AppearanceMode" AS ENUM ('SYSTEM', 'LIGHT', 'DARK');

-- CreateTable
CREATE TABLE "UserSettings" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "emailNewMatches" BOOLEAN NOT NULL DEFAULT true,
    "emailMessages" BOOLEAN NOT NULL DEFAULT true,
    "emailPromotions" BOOLEAN NOT NULL DEFAULT false,
    "pushNewMatches" BOOLEAN NOT NULL DEFAULT true,
    "pushMessages" BOOLEAN NOT NULL DEFAULT true,
    "pushMessageLikes" BOOLEAN NOT NULL DEFAULT true,
    "pushSuperLikes" BOOLEAN NOT NULL DEFAULT true,
    "pushDailyPicks" BOOLEAN NOT NULL DEFAULT false,
    "pushOffers" BOOLEAN NOT NULL DEFAULT false,
    "smsEnabled" BOOLEAN NOT NULL DEFAULT false,
    "inAppVibrations" BOOLEAN NOT NULL DEFAULT true,
    "inAppSounds" BOOLEAN NOT NULL DEFAULT false,
    "appearance" "AppearanceMode" NOT NULL DEFAULT 'SYSTEM',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserSettings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UserSettings_userId_key" ON "UserSettings"("userId");

-- AddForeignKey
ALTER TABLE "UserSettings" ADD CONSTRAINT "UserSettings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

