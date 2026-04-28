-- CreateEnum
CREATE TYPE "VendorContractStatus" AS ENUM ('UNKNOWN', 'IN_REVIEW', 'ACTIVE', 'EXPIRED', 'TERMINATED');

-- CreateEnum
CREATE TYPE "VendorReviewStatus" AS ENUM ('NOT_REVIEWED', 'IN_PROGRESS', 'APPROVED', 'CONDITIONAL', 'REJECTED');

-- CreateTable
CREATE TABLE "VendorProfile" (
    "id" TEXT NOT NULL,
    "vendor" TEXT NOT NULL,
    "contractStatus" "VendorContractStatus" NOT NULL DEFAULT 'UNKNOWN',
    "contractOwner" TEXT,
    "contractRenewalDate" TIMESTAMP(3),
    "securityReviewStatus" "VendorReviewStatus" NOT NULL DEFAULT 'NOT_REVIEWED',
    "dataResidency" JSONB,
    "approvedUseCases" JSONB,
    "subprocessors" JSONB,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VendorProfile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "VendorProfile_vendor_key" ON "VendorProfile"("vendor");

-- CreateIndex
CREATE INDEX "VendorProfile_vendor_idx" ON "VendorProfile"("vendor");
