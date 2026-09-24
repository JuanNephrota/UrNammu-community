-- CreateEnum
CREATE TYPE "VendorAssessmentStatus" AS ENUM ('IN_PROGRESS', 'COMPLETED');

-- AlterTable
ALTER TABLE "VendorProfile" ADD COLUMN     "description" TEXT,
ADD COLUMN     "website" TEXT;

-- CreateTable
CREATE TABLE "VendorAssessment" (
    "id" TEXT NOT NULL,
    "vendorProfileId" TEXT NOT NULL,
    "status" "VendorAssessmentStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "answers" JSONB NOT NULL DEFAULT '{}',
    "score" INTEGER,
    "tier" TEXT,
    "decision" "VendorReviewStatus",
    "decisionNotes" TEXT,
    "startedBy" TEXT NOT NULL,
    "completedBy" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VendorAssessment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VendorAssessment_vendorProfileId_createdAt_idx" ON "VendorAssessment"("vendorProfileId", "createdAt");

-- AddForeignKey
ALTER TABLE "VendorAssessment" ADD CONSTRAINT "VendorAssessment_vendorProfileId_fkey" FOREIGN KEY ("vendorProfileId") REFERENCES "VendorProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

