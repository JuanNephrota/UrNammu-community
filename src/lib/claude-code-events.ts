import type { Prisma } from "@prisma/client";

// Shared shape + formatting for Claude Code event (audit) rows, used by both
// the inline "Recent Events" preview on the oversight page and the full
// /oversight/claude-code/events audit log. Metadata only — no content.

export interface ClaudeCodeEventRow {
  id: string;
  timestamp: Date;
  userEmail: string | null;
  eventName: string;
  toolName: string | null;
  decision: string | null;
  success: boolean | null;
  durationMs: number | null;
  model: string | null;
  statusCode: number | null;
  errorType: string | null;
  sessionId: string | null;
  entrypoint: string | null;
  riskSeverity: string | null;
  riskCategory: string | null;
  attributes: Prisma.JsonValue;
}

// Prisma select for the columns the audit views need (excludes nothing
// sensitive — content keys are never stored).
export const CLAUDE_CODE_EVENT_SELECT = {
  id: true,
  timestamp: true,
  userEmail: true,
  eventName: true,
  toolName: true,
  decision: true,
  success: true,
  durationMs: true,
  model: true,
  statusCode: true,
  errorType: true,
  sessionId: true,
  entrypoint: true,
  riskSeverity: true,
  riskCategory: true,
  attributes: true,
} as const;

// Map the OTel app.entrypoint to a friendly "surface" label. Cowork sessions
// run in the Claude Desktop VM and report entrypoint "local-agent".
export function surfaceLabel(entrypoint: string | null | undefined): string {
  switch (entrypoint) {
    case "cli":
      return "CLI";
    case "claude-desktop":
      return "Desktop";
    case "claude-vscode":
      return "VS Code";
    case "local-agent":
      return "Cowork";
    case "sdk-cli":
    case "sdk-ts":
    case "sdk-py":
      return "SDK";
    default:
      return entrypoint || "—";
  }
}

export function formatMs(ms: number | null): string {
  if (ms == null) return "";
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms.toFixed(0)}ms`;
}

// One-line, per-event-type summary of the metadata for the audit table.
export function eventDetail(e: ClaudeCodeEventRow): string {
  const attrs = (e.attributes ?? {}) as Record<string, unknown>;
  const s = (k: string) =>
    typeof attrs[k] === "string" ? (attrs[k] as string) : undefined;
  switch (e.eventName) {
    case "tool_result": {
      const parts = [e.toolName ?? "tool", e.success === false ? "failed" : "ok"];
      if (e.durationMs != null) parts.push(formatMs(e.durationMs));
      if (e.errorType) parts.push(e.errorType);
      return parts.join(" · ");
    }
    case "tool_decision":
      return [e.toolName ?? "tool", e.decision, s("source")]
        .filter(Boolean)
        .join(" · ");
    case "api_error":
      return [e.model, e.statusCode, e.errorType].filter(Boolean).join(" · ");
    case "api_request":
      return [e.model, formatMs(e.durationMs)].filter(Boolean).join(" · ");
    case "mcp_server_connection":
      return [s("status"), s("transport_type"), s("server_scope")]
        .filter(Boolean)
        .join(" · ");
    case "permission_mode_changed":
      return [s("from_mode"), "→", s("to_mode")].filter(Boolean).join(" ");
    case "auth":
      return [s("action"), e.success === false ? "failed" : "ok"]
        .filter(Boolean)
        .join(" · ");
    case "user_prompt": {
      const len = attrs["prompt_length"];
      const cmd = s("command_name");
      return [
        cmd ? `/${cmd}` : undefined,
        typeof len === "number" ? `${len} chars` : undefined,
      ]
        .filter(Boolean)
        .join(" · ");
    }
    default:
      return "";
  }
}
