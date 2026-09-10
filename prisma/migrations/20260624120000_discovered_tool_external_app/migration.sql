-- AlterTable
ALTER TABLE "DiscoveredAITool" ADD COLUMN     "externalAppId" TEXT,
ADD COLUMN     "externalAppProvider" TEXT;

-- CreateIndex
CREATE INDEX "DiscoveredAITool_externalAppProvider_externalAppId_idx" ON "DiscoveredAITool"("externalAppProvider", "externalAppId");
