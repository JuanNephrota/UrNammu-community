-- What a marketplace plugin actually ships (manifest, skills, hooks, MCP
-- servers, commands, agents), fetched from its GitHub source at the pinned
-- commit, with review tracking. Companion to AssistantExtension.
CREATE TABLE "PluginContent" (
    "id" TEXT NOT NULL,
    "marketplace" TEXT NOT NULL,
    "plugin" TEXT NOT NULL,
    "repo" TEXT,
    "path" TEXT,
    "ref" TEXT,
    "commitSha" TEXT,
    "version" TEXT,
    "status" TEXT NOT NULL,
    "statusReason" TEXT,
    "manifest" JSONB,
    "skillCount" INTEGER NOT NULL DEFAULT 0,
    "hookCount" INTEGER NOT NULL DEFAULT 0,
    "mcpServerCount" INTEGER NOT NULL DEFAULT 0,
    "commandCount" INTEGER NOT NULL DEFAULT 0,
    "agentCount" INTEGER NOT NULL DEFAULT 0,
    "contentHash" TEXT,
    "previousContentHash" TEXT,
    "changedAt" TIMESTAMP(3),
    "fetchedAt" TIMESTAMP(3) NOT NULL,
    "reviewedAt" TIMESTAMP(3),
    "reviewedBy" TEXT,
    "reviewedHash" TEXT,
    "reviewNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PluginContent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PluginContentFile" (
    "id" TEXT NOT NULL,
    "contentId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "name" TEXT,
    "sha" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "text" TEXT,
    "truncated" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "PluginContentFile_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PluginContent_marketplace_plugin_key" ON "PluginContent"("marketplace", "plugin");
CREATE INDEX "PluginContent_status_fetchedAt_idx" ON "PluginContent"("status", "fetchedAt");
CREATE UNIQUE INDEX "PluginContentFile_contentId_path_key" ON "PluginContentFile"("contentId", "path");
CREATE INDEX "PluginContentFile_contentId_kind_idx" ON "PluginContentFile"("contentId", "kind");

ALTER TABLE "PluginContentFile" ADD CONSTRAINT "PluginContentFile_contentId_fkey" FOREIGN KEY ("contentId") REFERENCES "PluginContent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
