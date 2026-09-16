import type { ClaudeCodeEntry } from "./claude-code-analytics";
import type { CursorDailyUsageRow } from "./cursor-admin";
import type { ChatGPTDailyCounts, CodexDailyCounts } from "./chatgpt-enterprise-compliance";

// ─── AssistantDailyStat mappers ───────────────────────────────────────────
// Prisma-free translation from provider API rows to the columns of the
// AssistantDailyStat table (one row per provider × day × person). The sync
// loop in provider-telemetry.ts owns fetching and the Prisma upserts; the
// column semantics live here so they can be unit-tested and so every reader
// (Usage by Person, the Cursor and Claude Code oversight pages, reports)
// agrees on what each column means. The GitHub Copilot mapper lives in
// github-copilot-metrics.ts next to its Zod schemas.

export type AssistantProvider =
  | "claude_code"
  | "cursor"
  | "github_copilot"
  | "chatgpt"
  | "codex";

/** Column values for one AssistantDailyStat row, minus id / sync-run bookkeeping. */
export interface AssistantDailyStatValues {
  provider: AssistantProvider;
  /** UTC midnight of the reported day. */
  day: Date;
  actorExternalId: string;
  actorName: string | null;
  isActive: boolean | null;
  sessions: number | null;
  requests: number | null;
  linesAdded: number | null;
  linesRemoved: number | null;
  linesAccepted: number | null;
  commits: number | null;
  pullRequests: number | null;
  toolAccepted: number | null;
  toolRejected: number | null;
  /** USD. See the schema comment for per-provider semantics. */
  estimatedCost: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadTokens: number | null;
  cacheCreationTokens: number | null;
  metadata: Record<string, unknown>;
}

/** "YYYY-MM-DD" (or any ISO timestamp) → UTC midnight of that calendar day. */
export function assistantDay(date: string): Date {
  return new Date(`${date.slice(0, 10)}T00:00:00.000Z`);
}

function num(v: unknown): number {
  const x = typeof v === "number" ? v : typeof v === "string" && v !== "" ? Number(v) : NaN;
  return Number.isFinite(x) ? x : 0;
}

/** Whole-number column value; null when the provider did not report it. */
function intOrNull(v: unknown): number | null {
  if (v == null || v === "") return null;
  const x = typeof v === "number" ? v : Number(v);
  return Number.isFinite(x) ? Math.round(x) : null;
}

/** Display name for an actor id: the local part of an email, else the id. */
export function assistantActorName(actorExternalId: string): string {
  return actorExternalId.includes("@") ? actorExternalId.split("@")[0] : actorExternalId;
}

// ─── Claude Code (Anthropic Admin API analytics report) ───────────────────

/**
 * Map one Claude Code analytics entry (one actor × day) to stat columns.
 * `estimated_cost.amount` is reported in cents; the column is USD.
 */
export function claudeCodeEntryToDailyStat(
  entry: ClaudeCodeEntry,
  actor: { externalId: string; name: string | null },
  day: Date,
): AssistantDailyStatValues {
  const core = entry.core_metrics;
  let toolAccepted = 0;
  let toolRejected = 0;
  for (const action of Object.values(entry.tool_actions ?? {})) {
    toolAccepted += num(action?.accepted);
    toolRejected += num(action?.rejected);
  }

  let inputTokens = 0;
  let outputTokens = 0;
  let cacheReadTokens = 0;
  let cacheCreationTokens = 0;
  let estimatedCostCents = 0;
  for (const mb of entry.model_breakdown ?? []) {
    inputTokens += num(mb.tokens?.input);
    outputTokens += num(mb.tokens?.output);
    cacheReadTokens += num(mb.tokens?.cache_read);
    cacheCreationTokens += num(mb.tokens?.cache_creation);
    estimatedCostCents += num(mb.estimated_cost?.amount);
  }

  return {
    provider: "claude_code",
    day,
    actorExternalId: actor.externalId,
    actorName: actor.name,
    // The analytics report has no activity flag; a row exists only for days
    // the actor used Claude Code, but leave the column null rather than infer.
    isActive: null,
    sessions: intOrNull(core?.num_sessions),
    requests: null,
    linesAdded: intOrNull(core?.lines_of_code?.added),
    linesRemoved: intOrNull(core?.lines_of_code?.removed),
    linesAccepted: null,
    commits: intOrNull(core?.commits_by_claude_code),
    pullRequests: intOrNull(core?.pull_requests_by_claude_code),
    toolAccepted,
    toolRejected,
    estimatedCost: estimatedCostCents / 100,
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheCreationTokens,
    metadata: {
      terminal_type: entry.terminal_type ?? null,
      customer_type: entry.customer_type ?? null,
      model_breakdown: entry.model_breakdown ?? [],
      tool_actions: entry.tool_actions ?? {},
    },
  };
}

// ─── Cursor (Admin API daily-usage + usage-events) ────────────────────────

export interface CursorTokenTotals {
  input: number;
  output: number;
  cacheRead: number;
  cacheCreation: number;
}

/** Sum of the request counters Cursor's daily-usage row breaks out. */
export function cursorRequestCount(row: CursorDailyUsageRow): number {
  return (
    num(row.composerRequests) +
    num(row.chatRequests) +
    num(row.agentRequests) +
    num(row.cmdkUsages)
  );
}

/**
 * Map one Cursor daily-usage row (one member × day) to stat columns.
 * Tokens and charged spend come from the separate usage-events feed, keyed by
 * (email, day) by the caller. `chargedCents` must be null — not zero — when
 * that feed returned nothing for the sync window, so readers can tell
 * "unknown" from "free".
 */
export function cursorDailyRowToStat(
  row: CursorDailyUsageRow,
  actor: { externalId: string; name: string | null },
  day: Date,
  enrichment: { tokens: CursorTokenTotals | null; chargedCents: number | null },
): AssistantDailyStatValues {
  const { tokens, chargedCents } = enrichment;
  return {
    provider: "cursor",
    day,
    actorExternalId: actor.externalId,
    actorName: actor.name,
    isActive: typeof row.isActive === "boolean" ? row.isActive : null,
    sessions: null,
    requests: cursorRequestCount(row),
    linesAdded: intOrNull(row.totalLinesAdded),
    linesRemoved: intOrNull(row.totalLinesDeleted),
    linesAccepted: intOrNull(row.acceptedLinesAdded),
    commits: null,
    pullRequests: null,
    toolAccepted: null,
    toolRejected: null,
    estimatedCost: chargedCents == null ? null : chargedCents / 100,
    inputTokens: tokens ? Math.round(tokens.input) : null,
    outputTokens: tokens ? Math.round(tokens.output) : null,
    cacheReadTokens: tokens ? Math.round(tokens.cacheRead) : null,
    cacheCreationTokens: tokens ? Math.round(tokens.cacheCreation) : null,
    metadata: {
      mostUsedModel: typeof row.mostUsedModel === "string" ? row.mostUsedModel : null,
      composerRequests: intOrNull(row.composerRequests),
      chatRequests: intOrNull(row.chatRequests),
      agentRequests: intOrNull(row.agentRequests),
      cmdkUsages: intOrNull(row.cmdkUsages),
      subscriptionIncludedReqs: intOrNull(row.subscriptionIncludedReqs),
      usageBasedReqs: intOrNull(row.usageBasedReqs),
      apiKeyReqs: intOrNull(row.apiKeyReqs),
      acceptedLinesDeleted: intOrNull(row.acceptedLinesDeleted),
    },
  };
}

// ─── ChatGPT Enterprise (Compliance Logs Platform CONVERSATION_MESSAGE) ────

/**
 * Map one day of ChatGPT conversation-message counts (one member × day) to
 * stat columns. `requests` = human messages sent, `sessions` = distinct
 * conversations touched that day. Content is never part of the input.
 */
export function chatgptDailyCountsToStat(
  counts: ChatGPTDailyCounts,
  actor: { externalId: string; name: string | null },
  day: Date,
): AssistantDailyStatValues {
  return {
    provider: "chatgpt",
    day,
    actorExternalId: actor.externalId,
    actorName: actor.name,
    // A row exists only for days with at least one message.
    isActive: true,
    sessions: counts.conversations,
    requests: counts.userMessages,
    linesAdded: null,
    linesRemoved: null,
    linesAccepted: null,
    commits: null,
    pullRequests: null,
    toolAccepted: null,
    toolRejected: null,
    // Seat-based product; the compliance feed carries no per-message cost.
    estimatedCost: null,
    inputTokens: null,
    outputTokens: null,
    cacheReadTokens: null,
    cacheCreationTokens: null,
    metadata: {
      assistantMessages: counts.assistantMessages,
      gptConversations: counts.gptConversations,
      projectConversations: counts.projectConversations,
      distinctGpts: counts.gpts,
      models: counts.models,
      clientTypes: counts.clientTypes,
      source: "chatgpt_compliance_api",
    },
  };
}

// ─── Codex (Compliance Logs Platform CODEX_LOG + CODEX_TURN) ──────────────

/**
 * Map one day of Codex activity (one member × day) to stat columns.
 * `requests` = prompts sent (falling back to turns when the CODEX_LOG scope
 * is missing), `toolAccepted` = completed tool calls + approved decisions,
 * `toolRejected` = failed tool calls + denied decisions. Cost is USD from
 * CODEX_TURN when present, else null (unknown, not zero).
 */
export function codexDailyCountsToStat(
  counts: CodexDailyCounts,
  actor: { externalId: string; name: string | null },
  day: Date,
): AssistantDailyStatValues {
  const hasTokens = counts.tokenSource !== null;
  return {
    provider: "codex",
    day,
    actorExternalId: actor.externalId,
    actorName: actor.name,
    isActive: true,
    sessions: counts.sessions,
    requests: counts.prompts > 0 ? counts.prompts : counts.turns,
    linesAdded: null,
    linesRemoved: null,
    linesAccepted: null,
    commits: null,
    pullRequests: null,
    toolAccepted: counts.toolCallsCompleted + counts.toolDecisionsApproved,
    toolRejected: counts.toolCallsFailed + counts.toolDecisionsDenied,
    estimatedCost: counts.costUsd,
    inputTokens: hasTokens ? Math.round(counts.tokens.input) : null,
    outputTokens: hasTokens ? Math.round(counts.tokens.output) : null,
    cacheReadTokens: hasTokens ? Math.round(counts.tokens.cachedInput) : null,
    cacheCreationTokens: null,
    metadata: {
      responses: counts.responses,
      turns: counts.turns,
      tokenSource: counts.tokenSource,
      reasoningOutputTokens: hasTokens ? Math.round(counts.tokens.reasoningOutput) : null,
      credits: counts.credits,
      clients: counts.clients,
      models: counts.models,
      source: "chatgpt_compliance_api",
    },
  };
}

// ─── Incremental merge ────────────────────────────────────────────────────

export interface AssistantDailyStatExisting {
  isActive: boolean | null;
  sessions: number | null;
  requests: number | null;
  linesAdded: number | null;
  linesRemoved: number | null;
  linesAccepted: number | null;
  commits: number | null;
  pullRequests: number | null;
  toolAccepted: number | null;
  toolRejected: number | null;
  estimatedCost: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadTokens: number | null;
  cacheCreationTokens: number | null;
  metadata: unknown;
}

const ADDITIVE_COLUMNS = [
  "sessions",
  "requests",
  "linesAdded",
  "linesRemoved",
  "linesAccepted",
  "commits",
  "pullRequests",
  "toolAccepted",
  "toolRejected",
  "estimatedCost",
  "inputTokens",
  "outputTokens",
  "cacheReadTokens",
  "cacheCreationTokens",
] as const;

function addNullable(a: number | null, b: number | null): number | null {
  if (a == null && b == null) return null;
  return num(a) + num(b);
}

function mergeCountMaps(a: unknown, b: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  for (const source of [a, b]) {
    if (typeof source !== "object" || source === null) continue;
    for (const [k, v] of Object.entries(source as Record<string, unknown>)) {
      out[k] = (out[k] ?? 0) + num(v);
    }
  }
  return out;
}

/**
 * Add a freshly aggregated batch onto an existing row for the same
 * (provider, day, actor). Log-derived providers (chatgpt, codex) receive a
 * day's events across several sync runs — the cursor moves forward, files
 * are ~10-minute windows — so a plain upsert would drop everything ingested
 * earlier that day. Numeric columns add; null + null stays null; `isActive`
 * is true once either side saw activity. In metadata, per-key count maps
 * (`models`, `clientTypes`, `clients`) add, `assistantMessages`/`responses`/
 * `turns`/`reasoningOutputTokens`/`credits` add, and everything else takes
 * the incoming value. Distinct counts (`sessions`, `distinctGpts`) add too,
 * so a conversation spanning two runs is counted once per run.
 */
export function mergeAssistantDailyStat(
  existing: AssistantDailyStatExisting | null,
  incoming: AssistantDailyStatValues,
): AssistantDailyStatValues {
  if (!existing) return incoming;
  const merged: AssistantDailyStatValues = { ...incoming };
  for (const column of ADDITIVE_COLUMNS) {
    merged[column] = addNullable(existing[column], incoming[column]);
  }
  merged.isActive =
    existing.isActive === true || incoming.isActive === true
      ? true
      : existing.isActive == null && incoming.isActive == null
        ? null
        : false;

  const prev =
    typeof existing.metadata === "object" && existing.metadata !== null
      ? (existing.metadata as Record<string, unknown>)
      : {};
  const metadata: Record<string, unknown> = { ...prev, ...incoming.metadata };
  for (const key of ["models", "clientTypes", "clients"]) {
    if (key in prev || key in incoming.metadata) {
      metadata[key] = mergeCountMaps(prev[key], incoming.metadata[key]);
    }
  }
  for (const key of [
    "assistantMessages",
    "gptConversations",
    "projectConversations",
    "distinctGpts",
    "responses",
    "turns",
    "reasoningOutputTokens",
    "credits",
  ]) {
    const a = prev[key];
    const b = incoming.metadata[key];
    if (a == null && b == null) continue;
    if (typeof a === "number" || typeof b === "number") metadata[key] = num(a) + num(b);
  }
  merged.metadata = metadata;
  return merged;
}
