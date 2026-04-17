-- AlterTable
ALTER TABLE "APIUsageLog" ADD COLUMN     "flagCategory" TEXT;

-- Backfill known flagReason shapes into the new category column.
-- "API error: 400 …" / "API error: 429 …"  → upstream_error
-- "Proxy error: fetch failed" / "Network error" → proxy_error
-- Everything else with flagged=true → prompt_risk (the prompt-risk rule
-- labels are free-form human strings, but they're the only other producer
-- of flagged=true in the current data).
UPDATE "APIUsageLog"
SET "flagCategory" = CASE
  WHEN "flagReason" LIKE 'API error%' THEN 'upstream_error'
  WHEN "flagReason" LIKE 'Proxy error%' THEN 'proxy_error'
  WHEN "flagged" = TRUE THEN 'prompt_risk'
  ELSE NULL
END
WHERE "flagged" = TRUE;

-- CreateIndex
CREATE INDEX "APIUsageLog_flagCategory_createdAt_idx" ON "APIUsageLog"("flagCategory", "createdAt");
