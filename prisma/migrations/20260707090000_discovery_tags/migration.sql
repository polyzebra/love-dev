-- AlterTable
ALTER TABLE "Profile" ADD COLUMN     "availabilityTags" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "communityTags" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "personalityTags" TEXT[] DEFAULT ARRAY[]::TEXT[];

