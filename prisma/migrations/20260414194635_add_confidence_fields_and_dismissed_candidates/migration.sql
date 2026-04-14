-- AlterTable
ALTER TABLE "DiscoveredAITool" ADD COLUMN     "matchConfidence" TEXT,
ADD COLUMN     "matchReasons" JSONB,
ADD COLUMN     "matchScore" INTEGER;

-- CreateTable
CREATE TABLE "DismissedCandidate" (
    "id" TEXT NOT NULL,
    "toolName" TEXT NOT NULL,
    "vendor" TEXT,
    "detectedDomain" TEXT,
    "reason" TEXT NOT NULL,
    "dismissedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DismissedCandidate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DismissedCandidate_dismissedByUserId_idx" ON "DismissedCandidate"("dismissedByUserId");

-- CreateIndex
CREATE UNIQUE INDEX "DismissedCandidate_toolName_detectedDomain_key" ON "DismissedCandidate"("toolName", "detectedDomain");

-- CreateIndex
CREATE INDEX "DiscoveredAITool_status_matchConfidence_idx" ON "DiscoveredAITool"("status", "matchConfidence");

-- AddForeignKey
ALTER TABLE "DismissedCandidate" ADD CONSTRAINT "DismissedCandidate_dismissedByUserId_fkey" FOREIGN KEY ("dismissedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
