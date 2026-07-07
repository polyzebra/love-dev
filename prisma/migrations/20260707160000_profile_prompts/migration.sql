-- CreateTable
CREATE TABLE "ProfilePrompt" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "promptKey" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProfilePrompt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProfilePrompt_profileId_sortOrder_idx" ON "ProfilePrompt"("profileId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "ProfilePrompt_profileId_promptKey_key" ON "ProfilePrompt"("profileId", "promptKey");

-- AddForeignKey
ALTER TABLE "ProfilePrompt" ADD CONSTRAINT "ProfilePrompt_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

