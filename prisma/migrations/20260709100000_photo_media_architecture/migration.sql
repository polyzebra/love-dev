-- CreateEnum
CREATE TYPE "PhotoStatus" AS ENUM ('PROCESSING', 'ACTIVE', 'REJECTED', 'DELETED');

-- AlterTable
ALTER TABLE "Photo" ADD COLUMN     "aiScore" DOUBLE PRECISION,
ADD COLUMN     "blurhash" TEXT,
ADD COLUMN     "dominantColor" TEXT,
ADD COLUMN     "faceDetected" BOOLEAN,
ADD COLUMN     "facesCount" INTEGER,
ADD COLUMN     "mimeType" TEXT,
ADD COLUMN     "sizeBytes" INTEGER,
ADD COLUMN     "status" "PhotoStatus" NOT NULL DEFAULT 'PROCESSING',
ADD COLUMN     "storagePath" TEXT;

-- CreateTable
CREATE TABLE "PhotoModerationEvent" (
    "id" TEXT NOT NULL,
    "photoId" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "reason" TEXT,
    "aiScore" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PhotoModerationEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PhotoModerationEvent_photoId_createdAt_idx" ON "PhotoModerationEvent"("photoId", "createdAt");

-- AddForeignKey
ALTER TABLE "PhotoModerationEvent" ADD CONSTRAINT "PhotoModerationEvent_photoId_fkey" FOREIGN KEY ("photoId") REFERENCES "Photo"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Backfill: every pre-existing photo is live, and rows that point at the
-- listing-images bucket get their bucket-relative folder derived from the
-- public URL (strip the public prefix, any query string, and the filename).
UPDATE "Photo"
SET "status" = 'ACTIVE',
    "storagePath" = CASE
      WHEN "url" LIKE '%/storage/v1/object/public/listing-images/%'
      THEN regexp_replace(
             split_part(split_part("url", '/storage/v1/object/public/listing-images/', 2), '?', 1),
             '/[^/]+$', '')
      ELSE "storagePath"
    END;
