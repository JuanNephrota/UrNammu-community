-- CreateTable
CREATE TABLE "DirectoryPerson" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "primaryEmail" TEXT NOT NULL,
    "aliases" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "displayName" TEXT,
    "department" TEXT,
    "title" TEXT,
    "managerEmail" TEXT,
    "orgUnit" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "deactivatedAt" TIMESTAMP(3),
    "lastSyncedAt" TIMESTAMP(3) NOT NULL,
    "raw" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DirectoryPerson_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DirectoryPerson_primaryEmail_idx" ON "DirectoryPerson"("primaryEmail");

-- CreateIndex
CREATE INDEX "DirectoryPerson_department_idx" ON "DirectoryPerson"("department");

-- CreateIndex
CREATE INDEX "DirectoryPerson_active_idx" ON "DirectoryPerson"("active");

-- CreateIndex
CREATE UNIQUE INDEX "DirectoryPerson_source_externalId_key" ON "DirectoryPerson"("source", "externalId");

