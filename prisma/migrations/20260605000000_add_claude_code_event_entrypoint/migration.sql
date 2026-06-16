-- app.entrypoint for Claude Code events — distinguishes the launch surface
-- (cli, claude-vscode, sdk-*, and the Cowork VM's "local-agent").
ALTER TABLE "ClaudeCodeEvent" ADD COLUMN "entrypoint" TEXT;

CREATE INDEX "ClaudeCodeEvent_entrypoint_timestamp_idx"
  ON "ClaudeCodeEvent"("entrypoint", "timestamp");
