-- CreateTable
CREATE TABLE "AssistantDailyStat" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "day" TIMESTAMP(3) NOT NULL,
    "actorExternalId" TEXT NOT NULL,
    "actorName" TEXT,
    "isActive" BOOLEAN,
    "sessions" INTEGER,
    "requests" INTEGER,
    "linesAdded" INTEGER,
    "linesRemoved" INTEGER,
    "linesAccepted" INTEGER,
    "commits" INTEGER,
    "pullRequests" INTEGER,
    "toolAccepted" INTEGER,
    "toolRejected" INTEGER,
    "estimatedCost" DOUBLE PRECISION,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "cacheReadTokens" INTEGER,
    "cacheCreationTokens" INTEGER,
    "metadata" JSONB,
    "syncRunId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AssistantDailyStat_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AssistantDailyStat_provider_day_idx" ON "AssistantDailyStat"("provider", "day");

-- CreateIndex
CREATE INDEX "AssistantDailyStat_actorExternalId_day_idx" ON "AssistantDailyStat"("actorExternalId", "day");

-- CreateIndex
CREATE INDEX "AssistantDailyStat_syncRunId_idx" ON "AssistantDailyStat"("syncRunId");

-- CreateIndex
CREATE UNIQUE INDEX "AssistantDailyStat_provider_day_actorExternalId_key" ON "AssistantDailyStat"("provider", "day", "actorExternalId");

-- AddForeignKey
ALTER TABLE "AssistantDailyStat" ADD CONSTRAINT "AssistantDailyStat_syncRunId_fkey" FOREIGN KEY ("syncRunId") REFERENCES "ProviderSyncRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

