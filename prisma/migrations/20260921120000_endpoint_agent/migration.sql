-- CreateTable
CREATE TABLE "EndpointDevice" (
    "id" TEXT NOT NULL,
    "machineId" TEXT NOT NULL,
    "hostname" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "osVersion" TEXT,
    "arch" TEXT,
    "agentVersion" TEXT,
    "userEmail" TEXT,
    "userName" TEXT,
    "tokenHash" TEXT NOT NULL,
    "tokenIssuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "statusReason" TEXT,
    "enrolledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3),
    "lastReportAt" TIMESTAMP(3),
    "collectorStatus" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EndpointDevice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EndpointDetection" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "signal" TEXT NOT NULL,
    "toolName" TEXT NOT NULL,
    "vendor" TEXT,
    "category" TEXT,
    "matchConfidence" TEXT,
    "evidence" TEXT NOT NULL DEFAULT '',
    "detail" JSONB,
    "observations" INTEGER NOT NULL DEFAULT 0,
    "firstSeenAt" TIMESTAMP(3) NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EndpointDetection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EndpointDevice_machineId_key" ON "EndpointDevice"("machineId");

-- CreateIndex
CREATE INDEX "EndpointDevice_status_lastReportAt_idx" ON "EndpointDevice"("status", "lastReportAt");

-- CreateIndex
CREATE INDEX "EndpointDevice_userEmail_idx" ON "EndpointDevice"("userEmail");

-- CreateIndex
CREATE INDEX "EndpointDevice_platform_idx" ON "EndpointDevice"("platform");

-- CreateIndex
CREATE INDEX "EndpointDetection_toolName_lastSeenAt_idx" ON "EndpointDetection"("toolName", "lastSeenAt");

-- CreateIndex
CREATE INDEX "EndpointDetection_signal_lastSeenAt_idx" ON "EndpointDetection"("signal", "lastSeenAt");

-- CreateIndex
CREATE INDEX "EndpointDetection_lastSeenAt_idx" ON "EndpointDetection"("lastSeenAt");

-- CreateIndex
CREATE UNIQUE INDEX "EndpointDetection_deviceId_signal_toolName_evidence_key" ON "EndpointDetection"("deviceId", "signal", "toolName", "evidence");

-- AddForeignKey
ALTER TABLE "EndpointDetection" ADD CONSTRAINT "EndpointDetection_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "EndpointDevice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

