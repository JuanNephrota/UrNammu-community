-- CreateTable
CREATE TABLE "SensitiveScan" (
    "id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'running',
    "targetsProbed" INTEGER NOT NULL DEFAULT 0,
    "findingsFound" INTEGER NOT NULL DEFAULT 0,
    "criticalCount" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "triggeredBy" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SensitiveScan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SensitiveFinding" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT,
    "probeLabel" TEXT,
    "severity" TEXT NOT NULL,
    "ruleKeys" TEXT[],
    "categories" TEXT[],
    "matchedSignals" TEXT[],
    "excerpt" TEXT,
    "aiSystemId" TEXT,
    "apiUsageLogId" TEXT,
    "alertId" TEXT,
    "scanId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SensitiveFinding_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SensitiveFinding_source_createdAt_idx" ON "SensitiveFinding"("source", "createdAt");

-- CreateIndex
CREATE INDEX "SensitiveFinding_scanId_idx" ON "SensitiveFinding"("scanId");

-- AddForeignKey
ALTER TABLE "SensitiveFinding" ADD CONSTRAINT "SensitiveFinding_scanId_fkey" FOREIGN KEY ("scanId") REFERENCES "SensitiveScan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
