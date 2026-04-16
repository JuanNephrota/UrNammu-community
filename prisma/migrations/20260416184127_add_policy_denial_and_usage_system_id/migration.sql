-- AlterTable
ALTER TABLE "APIUsageLog" ADD COLUMN     "aiSystemId" TEXT;

-- CreateTable
CREATE TABLE "PolicyDenial" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT,
    "aiSystemId" TEXT,
    "userEmail" TEXT,
    "department" TEXT,
    "mode" TEXT NOT NULL,
    "policyIds" TEXT[],
    "reasons" JSONB NOT NULL,
    "promptExcerpt" TEXT,
    "requestMetadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PolicyDenial_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PolicyDenial_aiSystemId_createdAt_idx" ON "PolicyDenial"("aiSystemId", "createdAt");

-- CreateIndex
CREATE INDEX "PolicyDenial_mode_createdAt_idx" ON "PolicyDenial"("mode", "createdAt");

-- CreateIndex
CREATE INDEX "APIUsageLog_aiSystemId_createdAt_idx" ON "APIUsageLog"("aiSystemId", "createdAt");
