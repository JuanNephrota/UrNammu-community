-- AlterTable
ALTER TABLE "VendorProfile"
ADD COLUMN "contractStartDate" TIMESTAMP(3),
ADD COLUMN "renewalNoticeDays" INTEGER NOT NULL DEFAULT 60,
ADD COLUMN "renewalNotes" TEXT;
