-- AlterTable
ALTER TABLE "AIAgent" ADD COLUMN     "scopeEnforcement" TEXT NOT NULL DEFAULT 'monitor';

-- CreateTable
CREATE TABLE "ToolClassification" (
    "id" TEXT NOT NULL,
    "server" TEXT NOT NULL DEFAULT '*',
    "tool" TEXT NOT NULL,
    "access" TEXT NOT NULL,
    "system" TEXT,
    "notes" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ToolClassification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ToolClassification_server_tool_key" ON "ToolClassification"("server", "tool");

-- AddForeignKey
ALTER TABLE "ToolClassification" ADD CONSTRAINT "ToolClassification_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

