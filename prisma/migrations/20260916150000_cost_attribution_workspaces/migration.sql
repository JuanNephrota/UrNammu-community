-- AlterTable
ALTER TABLE "UsageBucket" ADD COLUMN     "workspaceExternalId" TEXT,
ADD COLUMN     "workspaceName" TEXT;

-- AlterTable
ALTER TABLE "CostBucket" ADD COLUMN     "aiSystemId" TEXT,
ADD COLUMN     "apiKeyExternalId" TEXT,
ADD COLUMN     "apiKeyName" TEXT,
ADD COLUMN     "workspaceExternalId" TEXT,
ADD COLUMN     "workspaceName" TEXT;

-- CreateIndex
CREATE INDEX "CostBucket_aiSystemId_bucketStart_idx" ON "CostBucket"("aiSystemId", "bucketStart");

-- AddForeignKey
ALTER TABLE "CostBucket" ADD CONSTRAINT "CostBucket_aiSystemId_fkey" FOREIGN KEY ("aiSystemId") REFERENCES "AISystem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

