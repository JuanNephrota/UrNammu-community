-- Live OTel telemetry from Claude Code clients, pushed through the Azure
-- Container Apps collector gateway. Complementary to the daily Admin-API
-- pull that populates UsageBucket(provider="claude_code").
CREATE TABLE "ClaudeCodeMetric" (
  "id"             TEXT NOT NULL,
  "timestamp"      TIMESTAMP(3) NOT NULL,
  "receivedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "userId"         TEXT,
  "userEmail"      TEXT,
  "sessionId"      TEXT,
  "organizationId" TEXT,
  "accountUuid"    TEXT,
  "appVersion"     TEXT,
  "hostType"       TEXT,
  "osType"         TEXT,
  "osVersion"      TEXT,
  "terminalType"   TEXT,
  "metricName"     TEXT NOT NULL,
  "value"          DOUBLE PRECISION NOT NULL,
  "unit"           TEXT,
  "model"          TEXT,
  "tokenType"      TEXT,
  "tool"           TEXT,
  "decision"       TEXT,
  "linesType"      TEXT,
  "attributes"     JSONB,
  CONSTRAINT "ClaudeCodeMetric_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ClaudeCodeMetric_timestamp_idx"
  ON "ClaudeCodeMetric"("timestamp");
CREATE INDEX "ClaudeCodeMetric_metricName_timestamp_idx"
  ON "ClaudeCodeMetric"("metricName", "timestamp");
CREATE INDEX "ClaudeCodeMetric_userEmail_timestamp_idx"
  ON "ClaudeCodeMetric"("userEmail", "timestamp");
CREATE INDEX "ClaudeCodeMetric_sessionId_timestamp_idx"
  ON "ClaudeCodeMetric"("sessionId", "timestamp");
