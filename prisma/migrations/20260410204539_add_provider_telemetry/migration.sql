-- CreateEnum
CREATE TYPE "ProviderSyncStatus" AS ENUM ('RUNNING', 'SUCCEEDED', 'FAILED');

-- CreateTable
CREATE TABLE "ProviderSyncRun" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "syncType" TEXT NOT NULL,
    "status" "ProviderSyncStatus" NOT NULL DEFAULT 'RUNNING',
    "triggeredByUserId" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "recordsProcessed" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "metadata" JSONB,

    CONSTRAINT "ProviderSyncRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProviderRawSnapshot" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "resourceType" TEXT NOT NULL,
    "externalId" TEXT,
    "payload" JSONB NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "syncRunId" TEXT NOT NULL,

    CONSTRAINT "ProviderRawSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UsageBucket" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "bucketStart" TIMESTAMP(3) NOT NULL,
    "bucketEnd" TIMESTAMP(3) NOT NULL,
    "granularity" TEXT NOT NULL,
    "dimensionKey" TEXT NOT NULL,
    "model" TEXT,
    "projectExternalId" TEXT,
    "projectName" TEXT,
    "actorExternalId" TEXT,
    "actorName" TEXT,
    "apiKeyExternalId" TEXT,
    "apiKeyName" TEXT,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "totalTokens" INTEGER NOT NULL DEFAULT 0,
    "requestCount" INTEGER,
    "metadata" JSONB,
    "syncRunId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UsageBucket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CostBucket" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "bucketStart" TIMESTAMP(3) NOT NULL,
    "bucketEnd" TIMESTAMP(3) NOT NULL,
    "granularity" TEXT NOT NULL,
    "dimensionKey" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'usd',
    "model" TEXT,
    "projectExternalId" TEXT,
    "projectName" TEXT,
    "actorExternalId" TEXT,
    "actorName" TEXT,
    "lineItem" TEXT,
    "metadata" JSONB,
    "syncRunId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CostBucket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProviderProject" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "name" TEXT,
    "status" TEXT,
    "metadata" JSONB,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "syncRunId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProviderProject_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProviderActor" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "email" TEXT,
    "name" TEXT,
    "role" TEXT,
    "metadata" JSONB,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "syncRunId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProviderActor_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProviderRawSnapshot_provider_resourceType_capturedAt_idx" ON "ProviderRawSnapshot"("provider", "resourceType", "capturedAt");

-- CreateIndex
CREATE INDEX "ProviderRawSnapshot_syncRunId_idx" ON "ProviderRawSnapshot"("syncRunId");

-- CreateIndex
CREATE UNIQUE INDEX "UsageBucket_provider_bucketStart_bucketEnd_granularity_dimension_key" ON "UsageBucket"("provider", "bucketStart", "bucketEnd", "granularity", "dimensionKey");

-- CreateIndex
CREATE INDEX "UsageBucket_provider_bucketStart_granularity_idx" ON "UsageBucket"("provider", "bucketStart", "granularity");

-- CreateIndex
CREATE INDEX "UsageBucket_syncRunId_idx" ON "UsageBucket"("syncRunId");

-- CreateIndex
CREATE UNIQUE INDEX "CostBucket_provider_bucketStart_bucketEnd_granularity_dimensionKe_key" ON "CostBucket"("provider", "bucketStart", "bucketEnd", "granularity", "dimensionKey");

-- CreateIndex
CREATE INDEX "CostBucket_provider_bucketStart_granularity_idx" ON "CostBucket"("provider", "bucketStart", "granularity");

-- CreateIndex
CREATE INDEX "CostBucket_syncRunId_idx" ON "CostBucket"("syncRunId");

-- CreateIndex
CREATE UNIQUE INDEX "ProviderProject_provider_externalId_key" ON "ProviderProject"("provider", "externalId");

-- CreateIndex
CREATE INDEX "ProviderProject_syncRunId_idx" ON "ProviderProject"("syncRunId");

-- CreateIndex
CREATE UNIQUE INDEX "ProviderActor_provider_externalId_key" ON "ProviderActor"("provider", "externalId");

-- CreateIndex
CREATE INDEX "ProviderActor_syncRunId_idx" ON "ProviderActor"("syncRunId");

-- AddForeignKey
ALTER TABLE "ProviderSyncRun" ADD CONSTRAINT "ProviderSyncRun_triggeredByUserId_fkey" FOREIGN KEY ("triggeredByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderRawSnapshot" ADD CONSTRAINT "ProviderRawSnapshot_syncRunId_fkey" FOREIGN KEY ("syncRunId") REFERENCES "ProviderSyncRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UsageBucket" ADD CONSTRAINT "UsageBucket_syncRunId_fkey" FOREIGN KEY ("syncRunId") REFERENCES "ProviderSyncRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostBucket" ADD CONSTRAINT "CostBucket_syncRunId_fkey" FOREIGN KEY ("syncRunId") REFERENCES "ProviderSyncRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderProject" ADD CONSTRAINT "ProviderProject_syncRunId_fkey" FOREIGN KEY ("syncRunId") REFERENCES "ProviderSyncRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderActor" ADD CONSTRAINT "ProviderActor_syncRunId_fkey" FOREIGN KEY ("syncRunId") REFERENCES "ProviderSyncRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
