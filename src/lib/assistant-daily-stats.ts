import type { ClaudeCodeEntry } from "./claude-code-analytics";
import type { CursorDailyUsageRow } from "./cursor-admin";

// ─── AssistantDailyStat mappers ───────────────────────────────────────────
// Prisma-free translation from provider API rows to the columns of the
// AssistantDailyStat table (one row per provider × day × person). The sync
// loop in provider-telemetry.ts owns fetching and the Prisma upserts; the
// column semantics live here so they can be unit-tested and so every reader
// (Usage by Person, the Cursor and Claude Code oversight pages, reports)
// agrees on what each column means.

export type AssistantProvider = "claude_code" | "cursor";

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
