-- CreateTable
CREATE TABLE "DiscoveredAgent" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "platform" TEXT,
    "framework" TEXT,
    "status" "DiscoveryStatus" NOT NULL DEFAULT 'DISCOVERED',
    "confidence" TEXT,
    "score" INTEGER,
    "signals" JSONB NOT NULL DEFAULT '[]',
    "tools" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "mcpServers" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "models" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "userEmails" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "ownerEmail" TEXT,
    "department" TEXT,
    "aiSystemId" TEXT,
    "linkedAgentId" TEXT,
    "requestCount" INTEGER NOT NULL DEFAULT 0,
    "firstSeenAt" TIMESTAMP(3),
    "lastSeenAt" TIMESTAMP(3),
    "metadata" JSONB,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DiscoveredAgent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DiscoveredAgent_status_lastSeenAt_idx" ON "DiscoveredAgent"("status", "lastSeenAt");

-- CreateIndex
CREATE INDEX "DiscoveredAgent_linkedAgentId_idx" ON "DiscoveredAgent"("linkedAgentId");

-- CreateIndex
CREATE UNIQUE INDEX "DiscoveredAgent_source_externalId_key" ON "DiscoveredAgent"("source", "externalId");

-- AddForeignKey
ALTER TABLE "DiscoveredAgent" ADD CONSTRAINT "DiscoveredAgent_linkedAgentId_fkey" FOREIGN KEY ("linkedAgentId") REFERENCES "AIAgent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

