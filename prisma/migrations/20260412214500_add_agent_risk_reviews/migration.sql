-- CreateTable
CREATE TABLE "AgentRiskReview" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "recommendedRiskLevel" "RiskLevel" NOT NULL,
    "reviewNeeded" BOOLEAN NOT NULL DEFAULT false,
    "summary" TEXT NOT NULL,
    "concerns" JSONB NOT NULL DEFAULT '[]',
    "recommendations" JSONB NOT NULL DEFAULT '[]',
    "scores" JSONB NOT NULL,
    "generatedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentRiskReview_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AgentRiskReview_agentId_createdAt_idx" ON "AgentRiskReview"("agentId", "createdAt");

-- AddForeignKey
ALTER TABLE "AgentRiskReview" ADD CONSTRAINT "AgentRiskReview_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "AIAgent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
