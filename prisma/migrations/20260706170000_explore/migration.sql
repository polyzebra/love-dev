-- CreateEnum
CREATE TYPE "ExploreGroup" AS ENUM ('LIFESTYLE', 'INTERESTS', 'GOALS', 'TODAY', 'PERSONALITY', 'COMMUNITIES');

-- CreateTable
CREATE TABLE "ExploreCategory" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "group" "ExploreGroup" NOT NULL,
    "iconKey" TEXT NOT NULL,
    "imageUrl" TEXT,
    "gradientFrom" TEXT NOT NULL DEFAULT '#fb7185',
    "gradientTo" TEXT NOT NULL DEFAULT '#be123c',
    "matcher" JSONB,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExploreCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserExplorePreference" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "weight" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserExplorePreference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnalyticsEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "name" TEXT NOT NULL,
    "data" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnalyticsEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ExploreCategory_slug_key" ON "ExploreCategory"("slug");

-- CreateIndex
CREATE INDEX "ExploreCategory_isActive_group_sortOrder_idx" ON "ExploreCategory"("isActive", "group", "sortOrder");

-- CreateIndex
CREATE INDEX "UserExplorePreference_categoryId_idx" ON "UserExplorePreference"("categoryId");

-- CreateIndex
CREATE UNIQUE INDEX "UserExplorePreference_userId_categoryId_key" ON "UserExplorePreference"("userId", "categoryId");

-- CreateIndex
CREATE INDEX "AnalyticsEvent_name_createdAt_idx" ON "AnalyticsEvent"("name", "createdAt");

-- AddForeignKey
ALTER TABLE "UserExplorePreference" ADD CONSTRAINT "UserExplorePreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserExplorePreference" ADD CONSTRAINT "UserExplorePreference_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ExploreCategory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

