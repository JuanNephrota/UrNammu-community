-- AlterTable
ALTER TABLE "AISkill" ADD COLUMN     "linkedAgentId" TEXT;

-- CreateIndex
CREATE INDEX "AISkill_linkedAgentId_idx" ON "AISkill"("linkedAgentId");

-- AddForeignKey
ALTER TABLE "AISkill" ADD CONSTRAINT "AISkill_linkedAgentId_fkey" FOREIGN KEY ("linkedAgentId") REFERENCES "AIAgent"("id") ON DELETE SET NULL ON UPDATE CASCADE;
