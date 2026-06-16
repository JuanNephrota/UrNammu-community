-- CreateTable
CREATE TABLE "IngestionRun" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'running',
    "inputType" TEXT NOT NULL DEFAULT 'json',
    "fileName" TEXT,
    "triggeredByUserId" TEXT,
    "processed" INTEGER NOT NULL DEFAULT 0,
    "matched" INTEGER NOT NULL DEFAULT 0,
    "newTools" INTEGER NOT NULL DEFAULT 0,
    "updatedTools" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "details" JSONB,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IngestionRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "IngestionRun_createdAt_idx" ON "IngestionRun"("createdAt");

-- CreateIndex
CREATE INDEX "IngestionRun_source_createdAt_idx" ON "IngestionRun"("source", "createdAt");

-- AddForeignKey
ALTER TABLE "IngestionRun" ADD CONSTRAINT "IngestionRun_triggeredByUserId_fkey" FOREIGN KEY ("triggeredByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
