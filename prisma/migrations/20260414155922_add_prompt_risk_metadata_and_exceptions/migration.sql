-- AlterTable
ALTER TABLE "Alert" ADD COLUMN     "falsePositive" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "falsePositiveAt" TIMESTAMP(3),
ADD COLUMN     "falsePositiveByUserId" TEXT,
ADD COLUMN     "falsePositiveReason" TEXT,
ADD COLUMN     "promptRiskMetadata" JSONB;

-- CreateTable
CREATE TABLE "PromptRiskException" (
    "id" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "pattern" TEXT,
    "reason" TEXT NOT NULL,
    "sourceAlertId" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PromptRiskException_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PromptRiskException_category_active_idx" ON "PromptRiskException"("category", "active");

-- CreateIndex
CREATE INDEX "PromptRiskException_createdByUserId_idx" ON "PromptRiskException"("createdByUserId");

-- CreateIndex
CREATE INDEX "Alert_source_falsePositive_idx" ON "Alert"("source", "falsePositive");

-- AddForeignKey
ALTER TABLE "Alert" ADD CONSTRAINT "Alert_falsePositiveByUserId_fkey" FOREIGN KEY ("falsePositiveByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromptRiskException" ADD CONSTRAINT "PromptRiskException_sourceAlertId_fkey" FOREIGN KEY ("sourceAlertId") REFERENCES "Alert"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromptRiskException" ADD CONSTRAINT "PromptRiskException_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
