-- CreateEnum
CREATE TYPE "InvestigationStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'RESOLVED');

-- CreateEnum
CREATE TYPE "BudgetScopeType" AS ENUM ('PROVIDER', 'AI_SYSTEM', 'DEPARTMENT');

-- CreateTable
CREATE TABLE "Investigation" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT,
    "status" "InvestigationStatus" NOT NULL DEFAULT 'OPEN',
    "ownerUserId" TEXT,
    "aiSystemId" TEXT,
    "alertId" TEXT,
    "governanceIncidentId" TEXT,
    "notes" TEXT,
    "resolutionSummary" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "Investigation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SpendBudget" (
    "id" TEXT NOT NULL,
    "scopeType" "BudgetScopeType" NOT NULL,
    "scopeKey" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "monthlyBudget" DOUBLE PRECISION NOT NULL,
    "warningThresholdPct" INTEGER NOT NULL DEFAULT 80,
    "ownerUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SpendBudget_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Investigation_alertId_key" ON "Investigation"("alertId");

-- CreateIndex
CREATE UNIQUE INDEX "Investigation_governanceIncidentId_key" ON "Investigation"("governanceIncidentId");

-- CreateIndex
CREATE INDEX "Investigation_status_createdAt_idx" ON "Investigation"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Investigation_ownerUserId_status_idx" ON "Investigation"("ownerUserId", "status");

-- CreateIndex
CREATE INDEX "Investigation_aiSystemId_status_idx" ON "Investigation"("aiSystemId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "SpendBudget_scopeType_scopeKey_key" ON "SpendBudget"("scopeType", "scopeKey");

-- CreateIndex
CREATE INDEX "SpendBudget_scopeType_scopeKey_idx" ON "SpendBudget"("scopeType", "scopeKey");

-- AddForeignKey
ALTER TABLE "Investigation" ADD CONSTRAINT "Investigation_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Investigation" ADD CONSTRAINT "Investigation_aiSystemId_fkey" FOREIGN KEY ("aiSystemId") REFERENCES "AISystem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Investigation" ADD CONSTRAINT "Investigation_alertId_fkey" FOREIGN KEY ("alertId") REFERENCES "Alert"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Investigation" ADD CONSTRAINT "Investigation_governanceIncidentId_fkey" FOREIGN KEY ("governanceIncidentId") REFERENCES "GovernanceIncident"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpendBudget" ADD CONSTRAINT "SpendBudget_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
