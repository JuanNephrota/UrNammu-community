-- AlterTable
ALTER TABLE "DiscoveredAITool" ADD COLUMN     "firstSeenAt" TIMESTAMP(3),
ADD COLUMN     "lastSeenAt" TIMESTAMP(3),
ADD COLUMN     "scopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "userEmails" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "ClaudeCodeMetric" ADD COLUMN     "dedupeKey" TEXT;

-- AlterTable
ALTER TABLE "ClaudeCodeEvent" ADD COLUMN     "dedupeKey" TEXT;

-- AlterTable
ALTER TABLE "CursorMetric" ADD COLUMN     "dedupeKey" TEXT;

-- AlterTable
ALTER TABLE "CursorSpan" ADD COLUMN     "dedupeKey" TEXT;

-- CreateIndex
CREATE INDEX "DiscoveredAITool_lastSeenAt_idx" ON "DiscoveredAITool"("lastSeenAt");

-- CreateIndex
CREATE UNIQUE INDEX "ClaudeCodeMetric_dedupeKey_key" ON "ClaudeCodeMetric"("dedupeKey");

-- CreateIndex
CREATE UNIQUE INDEX "ClaudeCodeEvent_dedupeKey_key" ON "ClaudeCodeEvent"("dedupeKey");

-- CreateIndex
CREATE UNIQUE INDEX "CursorMetric_dedupeKey_key" ON "CursorMetric"("dedupeKey");

-- CreateIndex
CREATE UNIQUE INDEX "CursorSpan_dedupeKey_key" ON "CursorSpan"("dedupeKey");

