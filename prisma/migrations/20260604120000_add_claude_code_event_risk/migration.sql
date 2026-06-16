-- Dangerous-prompt detection verdict for Claude Code events (Option A).
-- The raw prompt is never stored; only the in-memory analysis verdict.
ALTER TABLE "ClaudeCodeEvent" ADD COLUMN "riskSeverity" TEXT;
ALTER TABLE "ClaudeCodeEvent" ADD COLUMN "riskCategory" TEXT;

CREATE INDEX "ClaudeCodeEvent_riskSeverity_timestamp_idx"
  ON "ClaudeCodeEvent"("riskSeverity", "timestamp");
