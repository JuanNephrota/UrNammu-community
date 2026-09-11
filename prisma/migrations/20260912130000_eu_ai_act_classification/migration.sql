-- CreateEnum
CREATE TYPE "EuAiActRiskTier" AS ENUM ('PROHIBITED', 'HIGH_RISK', 'LIMITED_RISK', 'MINIMAL_RISK');

-- CreateEnum
CREATE TYPE "EuAiActRole" AS ENUM ('PROVIDER', 'DEPLOYER', 'PROVIDER_AND_DEPLOYER');

-- CreateTable
CREATE TABLE "EuAiActClassification" (
    "id" TEXT NOT NULL,
    "aiSystemId" TEXT NOT NULL,
    "role" "EuAiActRole" NOT NULL,
    "tier" "EuAiActRiskTier" NOT NULL,
    "annexIProduct" BOOLEAN NOT NULL DEFAULT false,
    "annexIiiCategories" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "derogationClaimed" BOOLEAN NOT NULL DEFAULT false,
    "transparencyRequired" BOOLEAN NOT NULL DEFAULT false,
    "friaRequired" BOOLEAN NOT NULL DEFAULT false,
    "gpaiDeployer" BOOLEAN NOT NULL DEFAULT false,
    "gpaiProvider" BOOLEAN NOT NULL DEFAULT false,
    "applicableArticles" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "answers" JSONB NOT NULL,
    "rationale" TEXT,
    "notes" TEXT,
    "obligationDeadline" TIMESTAMP(3),
    "classifiedByUserId" TEXT NOT NULL,
    "classifiedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewDueAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EuAiActClassification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EuAiActClassification_aiSystemId_key" ON "EuAiActClassification"("aiSystemId");

-- CreateIndex
CREATE INDEX "EuAiActClassification_tier_idx" ON "EuAiActClassification"("tier");

-- CreateIndex
CREATE INDEX "EuAiActClassification_classifiedByUserId_createdAt_idx" ON "EuAiActClassification"("classifiedByUserId", "createdAt");

-- AddForeignKey
ALTER TABLE "EuAiActClassification" ADD CONSTRAINT "EuAiActClassification_aiSystemId_fkey" FOREIGN KEY ("aiSystemId") REFERENCES "AISystem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EuAiActClassification" ADD CONSTRAINT "EuAiActClassification_classifiedByUserId_fkey" FOREIGN KEY ("classifiedByUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

