-- Per-person inventory of coding-assistant extensions (plugins, MCP servers,
-- skills, hooks, subagents) derived from Claude Code and Cursor OTel
-- telemetry. One row per (client, person, kind, key), merged on repeat.
CREATE TABLE "AssistantExtension" (
    "id" TEXT NOT NULL,
    "client" TEXT NOT NULL,
    "userEmail" TEXT NOT NULL DEFAULT '',
    "userId" TEXT,
    "kind" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "redacted" BOOLEAN NOT NULL DEFAULT false,
    "source" TEXT,
    "marketplace" TEXT,
    "pluginName" TEXT,
    "pluginIdHash" TEXT,
    "version" TEXT,
    "transport" TEXT,
    "lastStatus" TEXT,
    "enabledVia" TEXT,
    "detail" JSONB,
    "observations" INTEGER NOT NULL DEFAULT 0,
    "sessions" INTEGER NOT NULL DEFAULT 0,
    "failures" INTEGER NOT NULL DEFAULT 0,
    "firstSeenAt" TIMESTAMP(3) NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL,
    "lastSessionId" TEXT,
    "lastAppVersion" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AssistantExtension_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AssistantExtension_client_userEmail_kind_key_key" ON "AssistantExtension"("client", "userEmail", "kind", "key");
CREATE INDEX "AssistantExtension_kind_lastSeenAt_idx" ON "AssistantExtension"("kind", "lastSeenAt");
CREATE INDEX "AssistantExtension_userEmail_lastSeenAt_idx" ON "AssistantExtension"("userEmail", "lastSeenAt");
CREATE INDEX "AssistantExtension_client_kind_lastSeenAt_idx" ON "AssistantExtension"("client", "kind", "lastSeenAt");
