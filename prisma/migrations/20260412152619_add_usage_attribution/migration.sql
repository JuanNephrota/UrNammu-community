-- AlterTable
ALTER TABLE "UsageBucket" ADD COLUMN     "aiSystemId" TEXT;

-- CreateIndex
CREATE INDEX "UsageBucket_aiSystemId_idx" ON "UsageBucket"("aiSystemId");

-- AddForeignKey
ALTER TABLE "UsageBucket" ADD CONSTRAINT "UsageBucket_aiSystemId_fkey" FOREIGN KEY ("aiSystemId") REFERENCES "AISystem"("id") ON DELETE SET NULL ON UPDATE CASCADE;
