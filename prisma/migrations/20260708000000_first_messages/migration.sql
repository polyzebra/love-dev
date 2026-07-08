-- CreateEnum
CREATE TYPE "FirstMessageStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED', 'EXPIRED', 'DELETED');

-- CreateTable
CREATE TABLE "FirstMessage" (
    "id" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "receiverId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" "FirstMessageStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acceptedAt" TIMESTAMP(3),
    "declinedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "FirstMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FirstMessage_receiverId_status_idx" ON "FirstMessage"("receiverId", "status");

-- CreateIndex
CREATE INDEX "FirstMessage_senderId_receiverId_status_idx" ON "FirstMessage"("senderId", "receiverId", "status");

-- AddForeignKey
ALTER TABLE "FirstMessage" ADD CONSTRAINT "FirstMessage_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FirstMessage" ADD CONSTRAINT "FirstMessage_receiverId_fkey" FOREIGN KEY ("receiverId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
