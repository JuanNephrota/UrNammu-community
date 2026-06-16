-- CreateEnum
CREATE TYPE "ReportDataSource" AS ENUM ('AI_SYSTEMS', 'AI_AGENTS', 'RISK_ASSESSMENTS', 'COMPLIANCE', 'API_USAGE', 'ALERTS', 'SHADOW_AI', 'AUDIT_LOG');

-- CreateEnum
CREATE TYPE "ReportFormat" AS ENUM ('PDF', 'CSV', 'JSON');

-- CreateEnum
CREATE TYPE "ReportVisibility" AS ENUM ('PRIVATE', 'SHARED');

-- CreateEnum
CREATE TYPE "ReportFrequency" AS ENUM ('DAILY', 'WEEKLY', 'MONTHLY');

-- CreateEnum
CREATE TYPE "ReportRunStatus" AS ENUM ('PENDING', 'SUCCESS', 'FAILED');

-- CreateTable
CREATE TABLE "ReportDefinition" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "dataSource" "ReportDataSource" NOT NULL,
    "templateKey" TEXT,
    "config" JSONB NOT NULL,
    "visibility" "ReportVisibility" NOT NULL DEFAULT 'PRIVATE',
    "ownerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReportDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReportSchedule" (
    "id" TEXT NOT NULL,
    "definitionId" TEXT NOT NULL,
    "frequency" "ReportFrequency" NOT NULL,
    "hourUtc" INTEGER NOT NULL DEFAULT 8,
    "dayOfWeek" INTEGER,
    "dayOfMonth" INTEGER,
    "format" "ReportFormat" NOT NULL DEFAULT 'PDF',
    "recipients" TEXT[],
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "lastRunAt" TIMESTAMP(3),
    "nextRunAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReportSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReportRun" (
    "id" TEXT NOT NULL,
    "definitionId" TEXT NOT NULL,
    "scheduleId" TEXT,
    "format" "ReportFormat" NOT NULL,
    "status" "ReportRunStatus" NOT NULL DEFAULT 'PENDING',
    "rowCount" INTEGER,
    "content" BYTEA,
    "contentType" TEXT,
    "filename" TEXT,
    "error" TEXT,
    "deliveredTo" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "triggeredById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReportRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReportDefinition_ownerId_createdAt_idx" ON "ReportDefinition"("ownerId", "createdAt");

-- CreateIndex
CREATE INDEX "ReportDefinition_visibility_createdAt_idx" ON "ReportDefinition"("visibility", "createdAt");

-- CreateIndex
CREATE INDEX "ReportSchedule_enabled_nextRunAt_idx" ON "ReportSchedule"("enabled", "nextRunAt");

-- CreateIndex
CREATE INDEX "ReportSchedule_definitionId_idx" ON "ReportSchedule"("definitionId");

-- CreateIndex
CREATE INDEX "ReportRun_definitionId_createdAt_idx" ON "ReportRun"("definitionId", "createdAt");

-- CreateIndex
CREATE INDEX "ReportRun_scheduleId_createdAt_idx" ON "ReportRun"("scheduleId", "createdAt");

-- AddForeignKey
ALTER TABLE "ReportDefinition" ADD CONSTRAINT "ReportDefinition_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportSchedule" ADD CONSTRAINT "ReportSchedule_definitionId_fkey" FOREIGN KEY ("definitionId") REFERENCES "ReportDefinition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportRun" ADD CONSTRAINT "ReportRun_definitionId_fkey" FOREIGN KEY ("definitionId") REFERENCES "ReportDefinition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportRun" ADD CONSTRAINT "ReportRun_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "ReportSchedule"("id") ON DELETE SET NULL ON UPDATE CASCADE;
