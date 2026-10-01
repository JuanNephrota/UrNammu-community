-- AlterTable
ALTER TABLE "AIAgent" ADD COLUMN     "escalationContact" TEXT,
ADD COLUMN     "retiredAt" TIMESTAMP(3),
ADD COLUMN     "retiredById" TEXT,
ADD COLUMN     "retirementAttested" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "retirementNotes" TEXT,
ADD COLUMN     "riskOwnerId" TEXT,
ADD COLUMN     "technicalOwnerId" TEXT;

-- AlterTable
ALTER TABLE "GovernanceIncident" ADD COLUMN     "agentId" TEXT,
ALTER COLUMN "aiSystemId" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "GovernanceIncident_agentId_status_openedAt_idx" ON "GovernanceIncident"("agentId", "status", "openedAt");

-- AddForeignKey
ALTER TABLE "AIAgent" ADD CONSTRAINT "AIAgent_technicalOwnerId_fkey" FOREIGN KEY ("technicalOwnerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AIAgent" ADD CONSTRAINT "AIAgent_riskOwnerId_fkey" FOREIGN KEY ("riskOwnerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AIAgent" ADD CONSTRAINT "AIAgent_retiredById_fkey" FOREIGN KEY ("retiredById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GovernanceIncident" ADD CONSTRAINT "GovernanceIncident_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "AIAgent"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- An incident must reference a system, an agent, or both.
ALTER TABLE "GovernanceIncident"
  ADD CONSTRAINT "GovernanceIncident_subject_check"
  CHECK ("aiSystemId" IS NOT NULL OR "agentId" IS NOT NULL);
