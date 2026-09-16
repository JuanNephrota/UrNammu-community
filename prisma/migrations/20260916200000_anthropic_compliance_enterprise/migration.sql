-- Anthropic Compliance API activity feed + Claude Enterprise analytics.
-- Builds on 20260916170000_chatgpt_enterprise_compliance, which already
-- creates "ProviderSyncWatermark" and "ComplianceActivity" (provider="openai").

-- AlterTable: AssistantDailyStat gains a product surface (Claude Enterprise
-- reports several products per person per day); the unique key widens to it.
DROP INDEX IF EXISTS "AssistantDailyStat_provider_day_actorExternalId_key";
ALTER TABLE "AssistantDailyStat" ADD COLUMN     "product" TEXT NOT NULL DEFAULT '';
CREATE UNIQUE INDEX "AssistantDailyStat_provider_day_actorExternalId_product_key" ON "AssistantDailyStat"("provider", "day", "actorExternalId", "product");

-- AlterTable: upstream pagination cursor for feed-style providers whose
-- backfill was cut short by the page cap (Anthropic Compliance `last_id`).
ALTER TABLE "ProviderSyncWatermark" ADD COLUMN     "cursor" TEXT;

-- AlterTable: country derived from the Anthropic activity record, when present.
ALTER TABLE "ComplianceActivity" ADD COLUMN     "ipCountry" TEXT;

-- CreateTable
CREATE TABLE "ComplianceSession" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "sessionKind" TEXT NOT NULL,
    "productSurface" TEXT,
    "userEmail" TEXT,
    "userExternalId" TEXT,
    "workspaceId" TEXT,
    "startedAt" TIMESTAMP(3),
    "lastActivityAt" TIMESTAMP(3),
    "status" TEXT,
    "raw" JSONB NOT NULL,
    "ingestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ComplianceSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ComplianceSession_userEmail_lastActivityAt_idx" ON "ComplianceSession"("userEmail", "lastActivityAt");

-- CreateIndex
CREATE INDEX "ComplianceSession_productSurface_lastActivityAt_idx" ON "ComplianceSession"("productSurface", "lastActivityAt");

-- CreateIndex
CREATE INDEX "ComplianceSession_provider_lastActivityAt_idx" ON "ComplianceSession"("provider", "lastActivityAt");
