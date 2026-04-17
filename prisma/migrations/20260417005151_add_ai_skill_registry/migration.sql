-- CreateTable
CREATE TABLE "AISkill" (
    "id" TEXT NOT NULL,
    "forgeId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "fileType" TEXT,
    "fileName" TEXT,
    "fileSizeBytes" INTEGER,
    "sha256" TEXT,
    "status" TEXT NOT NULL DEFAULT 'published',
    "appUrl" TEXT,
    "tags" TEXT[],
    "currentVersion" INTEGER NOT NULL DEFAULT 1,
    "categoryForgeId" TEXT,
    "categoryName" TEXT,
    "departmentForgeId" TEXT,
    "departmentName" TEXT,
    "authorForgeId" TEXT,
    "authorName" TEXT,
    "authorDepartmentName" TEXT,
    "isFeaturedGlobal" BOOLEAN NOT NULL DEFAULT false,
    "upvoteCount" INTEGER NOT NULL DEFAULT 0,
    "downloadCount" INTEGER NOT NULL DEFAULT 0,
    "forgeCreatedAt" TIMESTAMP(3) NOT NULL,
    "forgeUpdatedAt" TIMESTAMP(3) NOT NULL,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "retiredAt" TIMESTAMP(3),
    "linkedSystemId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AISkill_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ForgeSyncRun" (
    "id" TEXT NOT NULL,
    "triggeredByUserId" TEXT,
    "trigger" TEXT NOT NULL DEFAULT 'manual',
    "status" TEXT NOT NULL DEFAULT 'running',
    "cursorUsed" TEXT,
    "sinceUsed" TIMESTAMP(3),
    "skillsFetched" INTEGER NOT NULL DEFAULT 0,
    "skillsCreated" INTEGER NOT NULL DEFAULT 0,
    "skillsUpdated" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "ForgeSyncRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AISkill_forgeId_key" ON "AISkill"("forgeId");

-- CreateIndex
CREATE INDEX "AISkill_contentType_status_idx" ON "AISkill"("contentType", "status");

-- CreateIndex
CREATE INDEX "AISkill_forgeUpdatedAt_idx" ON "AISkill"("forgeUpdatedAt");

-- CreateIndex
CREATE INDEX "AISkill_linkedSystemId_idx" ON "AISkill"("linkedSystemId");

-- CreateIndex
CREATE INDEX "ForgeSyncRun_status_startedAt_idx" ON "ForgeSyncRun"("status", "startedAt");

-- CreateIndex
CREATE INDEX "ForgeSyncRun_startedAt_idx" ON "ForgeSyncRun"("startedAt");

-- AddForeignKey
ALTER TABLE "AISkill" ADD CONSTRAINT "AISkill_linkedSystemId_fkey" FOREIGN KEY ("linkedSystemId") REFERENCES "AISystem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ForgeSyncRun" ADD CONSTRAINT "ForgeSyncRun_triggeredByUserId_fkey" FOREIGN KEY ("triggeredByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
