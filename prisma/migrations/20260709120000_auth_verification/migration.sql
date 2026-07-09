-- Auth hardening: phone verification (E.164 canonical), risk/ban fields,
-- login stamps, and the AuthVerificationEvent audit/rate-limit trail.

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "phoneE164" TEXT,
ADD COLUMN     "phoneCountryIso" TEXT,
ADD COLUMN     "phoneDialCode" TEXT,
ADD COLUMN     "phoneVerifiedAt" TIMESTAMP(3),
ADD COLUMN     "authCompleted" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "riskScore" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "bannedAt" TIMESTAMP(3),
ADD COLUMN     "banReason" TEXT,
ADD COLUMN     "lastLoginAt" TIMESTAMP(3),
ADD COLUMN     "lastLoginIpHash" TEXT,
ADD COLUMN     "lastUserAgentHash" TEXT;

-- CreateTable
CREATE TABLE "AuthVerificationEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "email" TEXT,
    "phoneE164" TEXT,
    "type" TEXT NOT NULL,
    "ipHash" TEXT,
    "userAgentHash" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuthVerificationEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_phoneE164_key" ON "User"("phoneE164");

-- CreateIndex
CREATE INDEX "AuthVerificationEvent_email_createdAt_idx" ON "AuthVerificationEvent"("email", "createdAt");

-- CreateIndex
CREATE INDEX "AuthVerificationEvent_phoneE164_createdAt_idx" ON "AuthVerificationEvent"("phoneE164", "createdAt");

-- CreateIndex
CREATE INDEX "AuthVerificationEvent_userId_createdAt_idx" ON "AuthVerificationEvent"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "AuthVerificationEvent_ipHash_createdAt_idx" ON "AuthVerificationEvent"("ipHash", "createdAt");

-- AddForeignKey
ALTER TABLE "AuthVerificationEvent" ADD CONSTRAINT "AuthVerificationEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
