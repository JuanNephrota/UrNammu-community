-- AlterTable
ALTER TABLE "AIAgent" ADD COLUMN     "inheritMcpCatalog" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "McpCatalogEntry" (
    "id" TEXT NOT NULL,
    "server" TEXT NOT NULL,
    "tools" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "label" TEXT,
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "approvedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "McpCatalogEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentBehaviorBaseline" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "windowDays" INTEGER NOT NULL DEFAULT 28,
    "activeDays" INTEGER NOT NULL DEFAULT 0,
    "computedAt" TIMESTAMP(3) NOT NULL,
    "stats" JSONB NOT NULL,
    "lastEvaluatedAt" TIMESTAMP(3),
    "lastFindings" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentBehaviorBaseline_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "McpCatalogEntry_server_key" ON "McpCatalogEntry"("server");

-- CreateIndex
CREATE INDEX "McpCatalogEntry_active_idx" ON "McpCatalogEntry"("active");

-- CreateIndex
CREATE UNIQUE INDEX "AgentBehaviorBaseline_agentId_key" ON "AgentBehaviorBaseline"("agentId");

-- AddForeignKey
ALTER TABLE "McpCatalogEntry" ADD CONSTRAINT "McpCatalogEntry_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentBehaviorBaseline" ADD CONSTRAINT "AgentBehaviorBaseline_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "AIAgent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

