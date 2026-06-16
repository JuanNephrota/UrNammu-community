-- Live OTel *events* (logs/events protocol) from Claude Code clients — the
-- audit-trail companion to "ClaudeCodeMetric". Content fields (prompt,
-- tool_input, …) are stripped at the collector gateway and again on ingest,
-- so this table never stores source code or prompt text.
CREATE TABLE "ClaudeCodeEvent" (
  "id"             TEXT NOT NULL,
  "timestamp"      TIMESTAMP(3) NOT NULL,
  "receivedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "sessionId"      TEXT,
  "promptId"       TEXT,
  "eventSequence"  INTEGER,
  "userId"         TEXT,
  "userEmail"      TEXT,
  "organizationId" TEXT,
  "accountUuid"    TEXT,
  "appVersion"     TEXT,
  "terminalType"   TEXT,
  "eventName"      TEXT NOT NULL,
  "toolName"       TEXT,
  "decision"       TEXT,
  "decisionSource" TEXT,
  "success"        BOOLEAN,
  "durationMs"     INTEGER,
  "model"          TEXT,
  "statusCode"     INTEGER,
  "errorType"      TEXT,
  "attributes"     JSONB,
  CONSTRAINT "ClaudeCodeEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ClaudeCodeEvent_timestamp_idx"
  ON "ClaudeCodeEvent"("timestamp");
CREATE INDEX "ClaudeCodeEvent_eventName_timestamp_idx"
  ON "ClaudeCodeEvent"("eventName", "timestamp");
CREATE INDEX "ClaudeCodeEvent_userEmail_timestamp_idx"
  ON "ClaudeCodeEvent"("userEmail", "timestamp");
CREATE INDEX "ClaudeCodeEvent_sessionId_timestamp_idx"
  ON "ClaudeCodeEvent"("sessionId", "timestamp");
CREATE INDEX "ClaudeCodeEvent_promptId_idx"
  ON "ClaudeCodeEvent"("promptId");
