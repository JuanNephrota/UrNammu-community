-- CreateTable
CREATE TABLE "ScanHistory" (
    "id" TEXT NOT NULL,
    "scanType" TEXT NOT NULL DEFAULT 'google_workspace',
    "status" TEXT NOT NULL DEFAULT 'running',
    "toolsFound" INTEGER NOT NULL DEFAULT 0,
    "newToolsAdded" INTEGER NOT NULL DEFAULT 0,
    "updatedTools" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "triggeredBy" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScanHistory_pkey" PRIMARY KEY ("id")
);
