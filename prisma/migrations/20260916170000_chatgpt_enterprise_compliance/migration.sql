-- CreateTable
CREATE TABLE "ProviderSyncWatermark" (
    "provider" TEXT NOT NULL,
    "watermark" TIMESTAMP(3) NOT NULL,
    "earliest" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProviderSyncWatermark_pkey" PRIMARY KEY ("provider")
);

-- CreateTable
CREATE TABLE "ComplianceActivity" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "organizationId" TEXT,
    "actorType" TEXT,
    "actorEmail" TEXT,
    "actorUserId" TEXT,
    "actorApiKeyId" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "payload" JSONB NOT NULL,
    "ingestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ComplianceActivity_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ComplianceActivity_occurredAt_idx" ON "ComplianceActivity"("occurredAt");

-- CreateIndex
CREATE INDEX "ComplianceActivity_actorEmail_occurredAt_idx" ON "ComplianceActivity"("actorEmail", "occurredAt");

-- CreateIndex
CREATE INDEX "ComplianceActivity_type_occurredAt_idx" ON "ComplianceActivity"("type", "occurredAt");

-- CreateIndex
CREATE INDEX "ComplianceActivity_provider_occurredAt_idx" ON "ComplianceActivity"("provider", "occurredAt");

