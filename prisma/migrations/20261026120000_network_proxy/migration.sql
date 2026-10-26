-- CreateEnum
CREATE TYPE "NetworkRuleAction" AS ENUM ('BLOCK', 'ALLOW');

-- CreateTable
CREATE TABLE "NetworkBlockRule" (
    "id" TEXT NOT NULL,
    "pattern" TEXT NOT NULL,
    "action" "NetworkRuleAction" NOT NULL DEFAULT 'BLOCK',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "reason" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NetworkBlockRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NetworkRequestLog" (
    "id" TEXT NOT NULL,
    "proxy" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "host" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "status" INTEGER,
    "ruleId" TEXT,
    "rulePattern" TEXT,
    "ruleSource" TEXT,
    "reason" TEXT,
    "userEmail" TEXT,
    "department" TEXT,
    "aiSystemId" TEXT,
    "agentId" TEXT,
    "requestBytes" INTEGER NOT NULL DEFAULT 0,
    "responseBytes" INTEGER,
    "durationMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NetworkRequestLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "NetworkBlockRule_enabled_idx" ON "NetworkBlockRule"("enabled");

-- CreateIndex
CREATE UNIQUE INDEX "NetworkBlockRule_pattern_action_key" ON "NetworkBlockRule"("pattern", "action");

-- CreateIndex
CREATE INDEX "NetworkRequestLog_createdAt_idx" ON "NetworkRequestLog"("createdAt");

-- CreateIndex
CREATE INDEX "NetworkRequestLog_host_createdAt_idx" ON "NetworkRequestLog"("host", "createdAt");

-- CreateIndex
CREATE INDEX "NetworkRequestLog_action_createdAt_idx" ON "NetworkRequestLog"("action", "createdAt");

-- AddForeignKey
ALTER TABLE "NetworkBlockRule" ADD CONSTRAINT "NetworkBlockRule_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
