/**
 * Agent charter scope — turns the declared access level and connected
 * systems into an enforced control instead of documentation.
 *
 * Pure logic shared (by copy) between the Next.js app and the Azure Functions
 * proxy; `ai-proxy/src/lib/agent-scope.ts` is a byte-identical mirror
 * (guarded by scripts/check-mirror-drift.mjs).
 *
 * Every tool the model calls is classified as read, write or admin and
 * optionally attributed to a system:
 * - org-wide ToolClassification rules (server/tool glob patterns, most
 *   specific wins) take precedence;
 * - otherwise a name heuristic (get_/list_/search_ → read, create_/update_/
 *   send_ → write, delete_/grant_/deploy_ → admin);
 * - a name the heuristic cannot place is treated as WRITE, so a read-only
 *   agent cannot slip past the control with an unrecognised tool. Classify it
 *   on the agent's MCP card to settle it either way.
 *
 * The verdict compares that against the agent's charter:
 * - `accessLevel` ranks restricted < read-only < read-write < admin; a tool
 *   above the agent's rank is out of scope. `restricted` additionally refuses
 *   every tool that is not on the agent's OWN tool allowlist (the org catalog
 *   does not count), and allows only read tools among those.
 * - a classification that names a system is out of scope when the agent's
 *   `connectedSystems` is non-empty and does not list that system
 *   (case-insensitive). An empty list is "not documented" and is not enforced;
 *   the posture score already asks for it.
 *
 * Violations are returned as HumanReviewMatch entries carrying a synthetic
 * `scope` trigger so they flow through the same withholding, denial and alert
 * plumbing as human-review triggers. `scopeEnforcement` decides whether a
 * violation withholds the response (enforce) or only records it (monitor). A
 * scope violation is never queued for review: the charter is changed, not
 * waived.
 */

import { toolLabel, type ObservedToolUse } from "./mcp-tool-governance";
import { toolMatches, triggerLabel, type HumanReviewMatch, type ScopeViolationRule } from "./human-review-triggers";

export type ToolAccess = "read" | "write" | "admin";
export const TOOL_ACCESS_LEVELS: readonly ToolAccess[] = ["read", "write", "admin"];

export type AgentAccessLevel = "restricted" | "read-only" | "read-write" | "admin";
export const AGENT_ACCESS_LEVELS: readonly AgentAccessLevel[] = ["restricted", "read-only", "read-write", "admin"];

export type ScopeEnforcement = "monitor" | "enforce";

/** One org-wide classification rule (ToolClassification row). */
export type ToolClassificationRule = {
  /** MCP server name or glob; `*` any server, `-` only tools with no server (client/provider tools). */
  server: string;
  /** Tool name or glob. */
  tool: string;
  access: ToolAccess;
  /** Business system the tool reaches (matched against AIAgent.connectedSystems). */
  system?: string | null;
};

export type AgentScopeConfig = {
  accessLevel: AgentAccessLevel;
  connectedSystems: string[];
  enforcement: ScopeEnforcement;
  /** The agent's OWN tool allowlist (not the catalog); `restricted` agents may only call these. */
  toolAllowlist: string[];
  rules: ToolClassificationRule[];
};

export type ToolClassification = {
  access: ToolAccess;
  system: string | null;
  /** Where the verdict came from: a rule, the name heuristic, or the unknown-name default. */
  source: "rule" | "heuristic" | "default";
  rule?: ToolClassificationRule;
};

/** Access assumed for a tool whose name the heuristic cannot place. */
export const UNKNOWN_TOOL_ACCESS: ToolAccess = "write";

// ─── Normalisation ─────────────────────────────────────────────────────────

export function normalizeAccessLevel(value: unknown): AgentAccessLevel {
  return typeof value === "string" && (AGENT_ACCESS_LEVELS as readonly string[]).includes(value)
    ? (value as AgentAccessLevel)
    : "read-only";
}

export function normalizeScopeEnforcement(value: unknown): ScopeEnforcement {
  return value === "enforce" ? "enforce" : "monitor";
}

export function normalizeToolAccess(value: unknown): ToolAccess | null {
  return typeof value === "string" && (TOOL_ACCESS_LEVELS as readonly string[]).includes(value)
    ? (value as ToolAccess)
    : null;
}

const ACCESS_RANK: Record<ToolAccess, number> = { read: 1, write: 2, admin: 3 };
const LEVEL_RANK: Record<AgentAccessLevel, number> = { restricted: 0, "read-only": 1, "read-write": 2, admin: 3 };

export function accessRank(access: ToolAccess): number {
  return ACCESS_RANK[access];
}

export function accessLevelRank(level: AgentAccessLevel): number {
  return LEVEL_RANK[level];
}

/** Highest tool access an agent at this level may use ("restricted" → read, allowlisted only). */
export function maxToolAccessFor(level: AgentAccessLevel): ToolAccess {
  return level === "admin" ? "admin" : level === "read-write" ? "write" : "read";
}

// ─── Classification ────────────────────────────────────────────────────────

function globToRegex(pattern: string): RegExp {
  const escaped = pattern
    .toLowerCase()
    .split("*")
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${escaped}$`);
}

function serverPatternMatches(pattern: string, serverName: string | null): boolean {
  const p = pattern.trim().toLowerCase();
  if (!p || p === "*") return true;
  if (p === "-") return serverName === null;
  if (serverName === null) return false;
  return p.includes("*") ? globToRegex(p).test(serverName.toLowerCase()) : p === serverName.toLowerCase();
}

function toolPatternMatches(pattern: string, toolName: string): boolean {
  const p = pattern.trim().toLowerCase();
  if (!p || p === "*") return true;
  return p.includes("*") ? globToRegex(p).test(toolName.toLowerCase()) : p === toolName.toLowerCase();
}

/** Higher is more specific: exact names beat globs beat wildcards; server outranks tool. */
function specificity(rule: ToolClassificationRule): number {
  const score = (p: string) => {
    const t = p.trim();
    if (!t || t === "*") return 0;
    return t.includes("*") ? 1 : 2;
  };
  return score(rule.server) * 10 + score(rule.tool);
}

export function ruleMatchesTool(rule: ToolClassificationRule, use: { serverName: string | null; toolName: string }): boolean {
  return serverPatternMatches(rule.server, use.serverName) && toolPatternMatches(rule.tool, use.toolName);
}

/** The most specific rule that matches the tool, if any. */
export function findClassificationRule(
  use: { serverName: string | null; toolName: string },
  rules: ToolClassificationRule[]
): ToolClassificationRule | null {
  let best: ToolClassificationRule | null = null;
  let bestScore = -1;
  for (const rule of rules) {
    if (!ruleMatchesTool(rule, use)) continue;
    const score = specificity(rule);
    if (score > bestScore) {
      best = rule;
      bestScore = score;
    }
  }
  return best;
}

const ADMIN_TOKENS = new Set([
  "delete", "remove", "drop", "destroy", "purge", "truncate", "wipe", "erase",
  "grant", "revoke", "admin", "permission", "permissions", "role", "roles", "privilege", "privileges",
  "deploy", "undeploy", "terminate", "rotate", "suspend", "ban", "deactivate", "reset", "shutdown", "reboot",
]);
const WRITE_TOKENS = new Set([
  "create", "add", "insert", "update", "edit", "modify", "set", "write", "put", "patch", "post",
  "send", "publish", "upload", "submit", "execute", "exec", "execution", "run", "invoke", "trigger",
  "start", "stop", "restart", "move", "rename", "assign", "unassign", "approve", "reject", "merge",
  "push", "commit", "transfer", "pay", "charge", "refund", "book", "cancel",
  "close", "reopen", "save", "store", "append", "import", "sync", "apply", "mark", "reply",
  "notify", "archive", "unarchive", "enable", "disable", "generate", "register",
  "resolve", "complete", "enqueue", "dispatch", "bash", "shell",
]);
const READ_TOKENS = new Set([
  "get", "list", "search", "read", "fetch", "find", "query", "describe", "show", "view", "lookup",
  "retrieve", "count", "check", "browse", "download", "export", "head", "status", "info", "inspect",
  "preview", "summarize", "summarise", "analyze", "analyse", "validate", "verify", "compare", "diff",
  "history", "log", "logs", "tail", "watch", "whoami", "me", "ping", "health", "exists", "cat", "grep",
  "glob", "ls", "select", "explain", "estimate", "calculate", "translate", "classify", "detect",
]);

function tokens(toolName: string): string[] {
  return toolName
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/**
 * Best-effort access from the tool's name alone. A destructive or privilege
 * token anywhere makes it admin (`force_delete`); otherwise the leading verb
 * decides (`get_order` is read even though orders get placed elsewhere); when
 * the leading token is unknown, any recognised token does (`bulk_create` is
 * write). Null when nothing is recognised. Only verbs are listed, so nouns
 * such as "issue", "order" or "message" never tip a `get_*` tool into write.
 */
export function heuristicToolAccess(toolName: string): ToolAccess | null {
  const parts = tokens(toolName);
  if (parts.length === 0) return null;
  if (parts.some((t) => ADMIN_TOKENS.has(t))) return "admin";
  const head = parts[0];
  if (WRITE_TOKENS.has(head)) return "write";
  if (READ_TOKENS.has(head)) return "read";
  if (parts.some((t) => WRITE_TOKENS.has(t))) return "write";
  if (parts.some((t) => READ_TOKENS.has(t))) return "read";
  return null;
}

export function classifyTool(
  use: { serverName: string | null; toolName: string },
  rules: ToolClassificationRule[]
): ToolClassification {
  const rule = findClassificationRule(use, rules);
  if (rule) return { access: rule.access, system: rule.system?.trim() || null, source: "rule", rule };
  const guess = heuristicToolAccess(use.toolName);
  if (guess) return { access: guess, system: null, source: "heuristic" };
  return { access: UNKNOWN_TOOL_ACCESS, system: null, source: "default" };
}

// ─── Evaluation ────────────────────────────────────────────────────────────

function norm(value: string): string {
  return value.trim().toLowerCase();
}

export function isConnectedSystem(connectedSystems: string[], system: string): boolean {
  const wanted = norm(system);
  return connectedSystems.some((s) => norm(s) === wanted);
}

export function isOnOwnAllowlist(toolAllowlist: string[], use: { serverName: string | null; toolName: string }): boolean {
  return toolAllowlist.some((pattern) => pattern.trim() !== "" && pattern.trim() !== "*" && toolMatches(pattern, use));
}

function scopeMatch(use: ObservedToolUse, rule: ScopeViolationRule, detail: string): HumanReviewMatch {
  const trigger = { kind: "scope" as const, rule };
  return { trigger, triggerLabel: triggerLabel(trigger), use, tool: toolLabel(use), detail };
}

/**
 * Charter-scope violations for a set of tool calls. Each call yields at most
 * one access violation (restricted-allowlist or access-level) plus at most
 * one connected-system violation.
 */
export function evaluateAgentScope(scope: AgentScopeConfig, uses: ObservedToolUse[]): HumanReviewMatch[] {
  const matches: HumanReviewMatch[] = [];
  for (const use of uses) {
    const cls = classifyTool(use, scope.rules);
    const via = cls.source === "rule" ? "classified" : cls.source === "heuristic" ? "by name" : "unclassified, treated as";
    let allowedRank: number;
    if (scope.accessLevel === "restricted") {
      if (!isOnOwnAllowlist(scope.toolAllowlist, use)) {
        matches.push(scopeMatch(use, "restricted", `restricted agent; tool is not on its own allowlist`));
        allowedRank = -1;
      } else {
        allowedRank = ACCESS_RANK.read;
      }
    } else {
      allowedRank = LEVEL_RANK[scope.accessLevel];
    }
    if (allowedRank >= 0 && ACCESS_RANK[cls.access] > allowedRank) {
      matches.push(
        scopeMatch(use, "access_level", `${cls.access} tool (${via} ${cls.access}) exceeds access level ${scope.accessLevel}`)
      );
    }
    if (cls.system && scope.connectedSystems.length > 0 && !isConnectedSystem(scope.connectedSystems, cls.system)) {
      matches.push(
        scopeMatch(use, "connected_system", `reaches "${cls.system}", which is not among the agent's connected systems`)
      );
    }
  }
  return matches;
}

/** Convenience for UIs: the verdict for one tool without building a use list. */
export function scopeVerdictFor(
  scope: AgentScopeConfig,
  use: { serverName: string | null; toolName: string }
): { classification: ToolClassification; violations: HumanReviewMatch[] } {
  const observed: ObservedToolUse = { kind: "tool_use", serverName: use.serverName, toolName: use.toolName };
  return { classification: classifyTool(use, scope.rules), violations: evaluateAgentScope(scope, [observed]) };
}

export function summarizeScopeForEffectivePolicy(scope: AgentScopeConfig) {
  return {
    accessLevel: scope.accessLevel,
    maxToolAccess: maxToolAccessFor(scope.accessLevel),
    connectedSystems: scope.connectedSystems,
    enforcement: scope.enforcement,
    unknownToolAccess: UNKNOWN_TOOL_ACCESS,
    rules: scope.rules.map((r) => ({ server: r.server, tool: r.tool, access: r.access, system: r.system ?? null })),
  };
}
