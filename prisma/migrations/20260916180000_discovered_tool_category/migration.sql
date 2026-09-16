-- AlterTable
ALTER TABLE "DiscoveredAITool" ADD COLUMN     "category" TEXT;

-- CreateIndex
CREATE INDEX "DiscoveredAITool_category_idx" ON "DiscoveredAITool"("category");

