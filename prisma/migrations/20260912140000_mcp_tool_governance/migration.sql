-- AlterTable
ALTER TABLE "AIAgent" ADD COLUMN     "mcpEnforcement" TEXT NOT NULL DEFAULT 'monitor',
ADD COLUMN     "mcpServerAllowlist" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "mcpToolAllowlist" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "AgentToolCall" (
    "id" TEXT NOT NULL,
    "agentId" TEXT,
    "aiSystemId" TEXT,
    "provider" TEXT NOT NULL,
    "model" TEXT,
    "kind" TEXT NOT NULL,
    "serverName" TEXT,
    "toolName" TEXT NOT NULL,
    "approved" BOOLEAN NOT NULL DEFAULT true,
    "requestId" TEXT,
    "userEmail" TEXT,
    "department" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentToolCall_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentToolProfile" (
    "id" TEXT NOT NULL,
    "scopeKey" TEXT NOT NULL,
    "agentId" TEXT,
    "aiSystemId" TEXT,
    "serverKey" TEXT NOT NULL,
    "serverName" TEXT,
    "serverHost" TEXT,
    "toolName" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "approved" BOOLEAN NOT NULL DEFAULT true,
    "callCount" INTEGER NOT NULL DEFAULT 0,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentToolProfile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AgentToolCall_agentId_createdAt_idx" ON "AgentToolCall"("agentId", "createdAt");

-- CreateIndex
CREATE INDEX "AgentToolCall_aiSystemId_createdAt_idx" ON "AgentToolCall"("aiSystemId", "createdAt");

-- CreateIndex
CREATE INDEX "AgentToolCall_approved_createdAt_idx" ON "AgentToolCall"("approved", "createdAt");

-- CreateIndex
CREATE INDEX "AgentToolCall_createdAt_idx" ON "AgentToolCall"("createdAt");

-- CreateIndex
CREATE INDEX "AgentToolProfile_agentId_lastSeenAt_idx" ON "AgentToolProfile"("agentId", "lastSeenAt");

-- CreateIndex
CREATE INDEX "AgentToolProfile_aiSystemId_lastSeenAt_idx" ON "AgentToolProfile"("aiSystemId", "lastSeenAt");

-- CreateIndex
CREATE INDEX "AgentToolProfile_approved_lastSeenAt_idx" ON "AgentToolProfile"("approved", "lastSeenAt");

-- CreateIndex
CREATE UNIQUE INDEX "AgentToolProfile_scopeKey_serverKey_toolName_key" ON "AgentToolProfile"("scopeKey", "serverKey", "toolName");

-- AddForeignKey
ALTER TABLE "AgentToolCall" ADD CONSTRAINT "AgentToolCall_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "AIAgent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentToolProfile" ADD CONSTRAINT "AgentToolProfile_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "AIAgent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

