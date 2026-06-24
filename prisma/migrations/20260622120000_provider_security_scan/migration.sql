-- CreateTable
CREATE TABLE "ProviderSecurityScan" (
    "id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'running',
    "providersScanned" INTEGER NOT NULL DEFAULT 0,
    "findingsFound" INTEGER NOT NULL DEFAULT 0,
    "criticalCount" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "triggeredBy" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProviderSecurityScan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProviderSecurityResult" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "overallScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "grade" TEXT NOT NULL DEFAULT 'F',
    "dataHandlingScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "retentionScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "trainingUseScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "encryptionScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "accessControlScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "residencyScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "liveChecksRan" BOOLEAN NOT NULL DEFAULT false,
    "checks" JSONB NOT NULL,
    "scanId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProviderSecurityResult_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProviderSecurityResult_scanId_idx" ON "ProviderSecurityResult"("scanId");

-- CreateIndex
CREATE INDEX "ProviderSecurityResult_provider_idx" ON "ProviderSecurityResult"("provider");

-- AddForeignKey
ALTER TABLE "ProviderSecurityResult" ADD CONSTRAINT "ProviderSecurityResult_scanId_fkey" FOREIGN KEY ("scanId") REFERENCES "ProviderSecurityScan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
