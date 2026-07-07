-- CreateTable
CREATE TABLE "BlockedIdentity" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "provider" TEXT,
    "reason" TEXT,
    "blockedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "createdBy" TEXT,

    CONSTRAINT "BlockedIdentity_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BlockedIdentity_email_key" ON "BlockedIdentity"("email");

-- CreateIndex
CREATE INDEX "BlockedIdentity_email_idx" ON "BlockedIdentity"("email");

