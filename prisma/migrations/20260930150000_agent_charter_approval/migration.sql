-- AlterTable
ALTER TABLE "AIAgent" ADD COLUMN     "decisionBoundaries" TEXT,
ADD COLUMN     "inScopeActions" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "nextReviewDate" TIMESTAMP(3),
ADD COLUMN     "outOfScopeActions" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "purpose" TEXT,
ADD COLUMN     "requireComplianceApproval" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "requireLegalApproval" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "requireOwnerApproval" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "requireSecurityApproval" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "reviewIntervalDays" INTEGER NOT NULL DEFAULT 365,
ADD COLUMN     "successCriteria" TEXT;

-- CreateTable
CREATE TABLE "AgentApproval" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "decidedByUserId" TEXT NOT NULL,
    "decision" "ApprovalDecision" NOT NULL,
    "rationale" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentApproval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentGovernanceReview" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "stage" "GovernanceReviewStage" NOT NULL,
    "decidedByUserId" TEXT NOT NULL,
    "approved" BOOLEAN NOT NULL DEFAULT false,
    "rationale" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentGovernanceReview_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AgentApproval_agentId_createdAt_idx" ON "AgentApproval"("agentId", "createdAt");

-- CreateIndex
CREATE INDEX "AgentApproval_decidedByUserId_createdAt_idx" ON "AgentApproval"("decidedByUserId", "createdAt");

-- CreateIndex
CREATE INDEX "AgentGovernanceReview_agentId_stage_createdAt_idx" ON "AgentGovernanceReview"("agentId", "stage", "createdAt");

-- CreateIndex
CREATE INDEX "AgentGovernanceReview_decidedByUserId_createdAt_idx" ON "AgentGovernanceReview"("decidedByUserId", "createdAt");

-- AddForeignKey
ALTER TABLE "AgentApproval" ADD CONSTRAINT "AgentApproval_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "AIAgent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentApproval" ADD CONSTRAINT "AgentApproval_decidedByUserId_fkey" FOREIGN KEY ("decidedByUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentGovernanceReview" ADD CONSTRAINT "AgentGovernanceReview_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "AIAgent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentGovernanceReview" ADD CONSTRAINT "AgentGovernanceReview_decidedByUserId_fkey" FOREIGN KEY ("decidedByUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

