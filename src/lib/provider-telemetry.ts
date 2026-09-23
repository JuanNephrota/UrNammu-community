import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import {
  ANTHROPIC_DEFAULT_MAX_PAGES,
  fetchAnthropicOrgData,
  getAllCostReport,
  getAllUsageReport,
  isAnthropicAdminConfigured,
  listAllAPIKeys,
  listAllMembers,
  listWorkspaces,
} from "./anthropic-admin";
import {
  fetchOpenAIOrgData,
  getAllCosts,
  getAllUsage,
  isOpenAIAdminConfigured,
  listAssistants,
  OPENAI_DEFAULT_MAX_PAGES,
} from "./openai-admin";
import {
  getOpenRouterActivity,
  isOpenRouterConfigured,
  normalizeOpenRouterActivityRows,
} from "./openrouter-admin";
import {
  HELICONE_DEFAULT_MAX_PAGES,
  HELICONE_DEFAULT_PAGE_SIZE,
  isHeliconeConfigured,
  queryHeliconeRequests,
  readHeliconeRequestPages,
} from "./helicone-admin";
import {
  isLiteLLMConfigured,
  normalizeLiteLLMSpendRows,
  queryLiteLLMSpendLogs,
} from "./litellm-admin";
import {
  buildPortkeyDayWindows,
  getPortkeyCostGraph,
  getPortkeyModelGroups,
  getPortkeyTokensGraph,
  getPortkeyUserGroups,
  isPortkeyConfigured,
  normalizePortkeyGraphPoints,
  PORTKEY_COST_DIVISOR,
  PORTKEY_DEFAULT_MAX_PAGES,
  PORTKEY_DEFAULT_PAGE_SIZE,
  portkeyCostToUsd,
  readPortkeyGroupedPages,
  type PortkeyGroupedRow,
} from "./portkey-admin";
import {
  GEMINI_BILLING_ROW_LIMIT,
  getGeminiBillingOverview,
  getGeminiBillingRowsForWindow,
  getGeminiUsageMetadata,
  isGeminiBillingConfigured,
} from "./gemini-admin";
import {
  CLAUDE_CODE_MAX_PAGES_PER_DAY,
  getClaudeCodeActorExternalId,
  getClaudeCodeReportRange,
  isClaudeCodeAnalyticsAvailable,
  type ClaudeCodeRangeResult,
} from "./claude-code-analytics";
import {
  CURSOR_DAILY_USAGE_MAX_PAGES,
  CURSOR_USAGE_EVENTS_MAX_PAGES,
  isCursorAdminConfigured,
  getCursorDailyUsage,
  getCursorSpend,
  getCursorUsageEvents,
} from "./cursor-admin";
import {
  getCopilotAggregateReport,
  getCopilotScope,
  getCopilotUsersReport,
  isGitHubCopilotConfigured,
  listCopilotSeats,
} from "./github-copilot-admin";
import {
  buildSeatIndex,
  COPILOT_MAX_DAYS_PER_RUN,
  copilotActorExternalId,
  copilotOrgDayToTotals,
  copilotUserRowToStat,
  isCopilotReportPending,
  planCopilotDayWalk,
  resolveCopilotWatermarkWindow,
  type CopilotSeat,
} from "./github-copilot-metrics";
import {
  ChatGPTEnterpriseApiError,
  downloadChatGPTLogFile,
  getChatGPTWorkspaceId,
  isChatGPTEnterpriseConfigured,
  listChatGPTLogFiles,
  listChatGPTWorkspaceGpts,
  listChatGPTWorkspaceUsers,
} from "./chatgpt-enterprise-admin";
import {
  advanceStreamWatermark,
  aggregateCodexEvents,
  aggregateConversationMessages,
  CHATGPT_LOG_EVENT_TYPES,
  CHATGPT_LOG_MAX_FILES_PER_RUN,
  CHATGPT_SYNC_PROVIDER,
  chatgptStreamWatermarkKey,
  complianceActivityFromEvent,
  dedupeEvents,
  detectAdminRoleAuditGrants,
  detectAdminRoleGrants,
  detectGptsWithActions,
  detectNewWorkspaceUsers,
  gptToDiscoveredAgent,
  latestGptCreatedAt,
  normalizeWorkspaceUser,
  planLogFileBatch,
  resolveLogCursor,
  type ChatGPTLogEventType,
  type ChatGPTLogFileMetadata,
  type ComplianceActivityValues,
  type ComplianceLogEnvelope,
} from "./chatgpt-enterprise-compliance";
import {
  getSetting,
  PROVIDER_KEY_SYSTEM_MAP_SETTING_KEY,
  PROVIDER_MANAGED_SYSTEM_SETTINGS_KEYS,
} from "./settings";
import { logger } from "./observability";
import { notifyDatadog } from "./datadog-client";
import {
  ANTHROPIC_COMPLIANCE_PROVIDER,
  ANTHROPIC_COMPLIANCE_SETTINGS,
  COMPLIANCE_ALERT_SOURCE,
  COMPLIANCE_FEED_DEFAULT_LOOKBACK_DAYS,
  COMPLIANCE_FEED_MAX_PAGES,
  COMPLIANCE_RECORD_PROVIDER,
  COMPLIANCE_SESSIONS_MAX_PAGES,
  classifyComplianceActivity,
  evaluateComplianceAlerts,
  extractCreatedApiKey,
  fetchComplianceActivities,
  fetchComplianceSessions,
  getOrgTimezone,
  normalizeComplianceActivity,
  normalizeComplianceSession,
  planComplianceFeedPull,
  resolveComplianceKey,
  type ComplianceAlertCandidate,
  type ComplianceSessionKind,
  type ComplianceWatermarkState,
  type NormalizedComplianceActivity,
  type NormalizedComplianceSession,
} from "./anthropic-compliance";
import {
  CLAUDE_ENTERPRISE_PROVIDER,
  CLAUDE_ENTERPRISE_SUMMARY_DIMENSION,
  enterpriseUserToDailyStats,
  getEnterpriseSummaries,
  getEnterpriseUserCostReport,
  getEnterpriseUserUsageReport,
  getEnterpriseUsersForDay,
  isClaudeEnterpriseConfigured,
  mergeEnterpriseDailyStats,
  parseEnterpriseCostRow,
  parseEnterpriseSummary,
  parseEnterpriseUsageRow,
  type EnterpriseCostRow,
  type EnterpriseUsageRow,
} from "./claude-enterprise-analytics";
import {
  assistantActorName,
  assistantDay,
  chatgptDailyCountsToStat,
  claudeCodeEntryToDailyStat,
  codexDailyCountsToStat,
  cursorDailyRowToStat,
  mergeAssistantDailyStat,
  type AssistantDailyStatValues,
} from "./assistant-daily-stats";
import {
  buildSystemResolver,
  collectReferencedSystemIds,
  parseProviderKeySystemMap,
  type SystemResolver,
} from "./system-attribution";
import {
  advanceWatermark,
  SYNC_PROVIDER_LABELS,
  type SyncProvider,
  type SyncWindow,
} from "./provider-sync-window";
import { applyAgentImport } from "./agent-import";

export { SYNC_PROVIDER_LABELS };
export type { SyncProvider, SyncWindow };

type SyncSummary = {
  syncRunId: string;
  usageBucketsUpserted: number;
  costBucketsUpserted: number;
  rawSnapshotsStored: number;
  projectsUpserted: number;
  actorsUpserted: number;
  apiUsageLogsCreated: number;
  /** Anthropic Compliance feed only: ComplianceActivity rows written this run. */
  complianceActivitiesUpserted?: number;
  /** Anthropic Compliance feed only: ComplianceSession rows written this run. */
  complianceSessionsUpserted?: number;
  /** Governance alerts raised by this run (compliance feed). */
  alertsCreated?: number;
};

export type SyncResult =
  | ({
      provider: SyncProvider;
      success: true;
      /** The window this run actually covered. */
      window: SyncWindow;
      /** True when any paginated fetch hit its page cap (see run metadata). */
      truncated: boolean;
    } & SyncSummary)
  | { provider: SyncProvider; success: false; error: string; skipped?: boolean };

/**
 * Per-fetch pagination accounting recorded in `ProviderSyncRun.metadata`.
 * Every paginated upstream read reports `{ pages, truncated }`; `truncated`
 * means the page cap was reached while the provider still had more rows,
 * so the window is under-counted and a `provider_sync_truncated` alert is
 * raised (deduped per provider for 24h).
 */
export type PaginationReport = Record<string, unknown> & { truncated: boolean };

function toJsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function startOfDayUtc(input: Date): Date {
  return new Date(Date.UTC(input.getUTCFullYear(), input.getUTCMonth(), input.getUTCDate()));
}

function endOfDayUtc(input: Date): Date {
  return new Date(Date.UTC(input.getUTCFullYear(), input.getUTCMonth(), input.getUTCDate() + 1));
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function asArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.map(asRecord) : [];
}

function asNumber(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function makeDimensionKey(parts: Record<string, string | null | undefined>): string {
  return Object.entries(parts)
    .filter(([, value]) => !!value)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("|") || "all";
}

/**
 * Load the governed-system attribution for one provider: the provider-wide
 * `<provider>_managed_system_id` default plus the per-API-key overrides in
 * `provider_key_system_map`. Mappings that point at a system that no longer
 * exists are dropped (and logged) so the FK on UsageBucket/CostBucket never
 * fails mid-sync. See src/lib/system-attribution.ts.
 */
async function loadSystemResolver(provider: SyncProvider, settingKey: string): Promise<SystemResolver> {
  const [configuredDefault, rawKeyMap] = await Promise.all([
    getSetting(settingKey),
    getSetting(PROVIDER_KEY_SYSTEM_MAP_SETTING_KEY),
  ]);
  const keyMap = parseProviderKeySystemMap(rawKeyMap);
  const referenced = collectReferencedSystemIds(
    { [provider]: keyMap[provider] ?? {} },
    [configuredDefault]
  );
  const existing = referenced.length
    ? await prisma.aISystem.findMany({
        where: { id: { in: referenced } },
        select: { id: true },
      })
    : [];
  const validIds = new Set(existing.map((system) => system.id));
  const missing = referenced.filter((id) => !validIds.has(id));
  if (missing.length > 0) {
    logger.warn("provider_sync.managed_system_not_found", {
      provider,
      settingKey,
      missingSystemIds: missing,
    });
  }
  return buildSystemResolver({
    provider,
    defaultSystemId: configuredDefault,
    keyMap,
    validSystemIds: validIds,
  });
}

/**
 * Label stored in `workspaceName` for Anthropic rows whose `workspace_id` is
 * null. The Admin API reports the organization's default workspace that way;
 * it has no id and does not appear in `listWorkspaces`.
 */
export const ANTHROPIC_DEFAULT_WORKSPACE_NAME = "Default workspace";

export type AnthropicCostBucketPlan = {
  bucketStart: Date;
  bucketEnd: Date;
  dimensionKey: string;
  amount: number; // USD
  currency: string;
  model: string | null;
  lineItem: string;
  workspaceExternalId: string | null;
  workspaceName: string | null;
};

/**
 * Turn the Anthropic cost report (grouped by workspace_id + description) into
 * one CostBucket per (day, workspace, model, cost_type).
 *
 * The report returns many granular line items per (workspace, model, day):
 * `{ workspace_id, model, cost_type, token_type, context_window, amount }`,
 * e.g. opus may have 6+ entries for the same day (uncached input, cache read,
 * cache creation 5m/1h, output, across context windows). They are summed in
 * cents first and converted to USD once, because `amount` is in CENTS —
 * verified empirically against the published price book.
 *
 * The workspace only enters the dimension key when it is non-null, so an org
 * with no named workspaces keeps exactly the pre-workspace keys and re-syncing
 * the overlap window updates rows in place instead of duplicating them.
 */
export function planAnthropicCostBuckets(args: {
  costReport: unknown;
  fallbackStart: string;
  fallbackEnd: string;
  workspaceNameById: Map<string, string>;
}): AnthropicCostBucketPlan[] {
  const plans: AnthropicCostBucketPlan[] = [];
  for (const bucket of asArray(asRecord(args.costReport).data)) {
    const bucketStart = new Date(asString(bucket.starting_at) ?? args.fallbackStart);
    const bucketEnd = new Date(asString(bucket.ending_at) ?? args.fallbackEnd);
    const date = bucketStart.toISOString().split("T")[0];

    const agg = new Map<
      string,
      { model: string | null; lineItem: string; workspaceId: string | null; amountCents: number; currency: string }
    >();
    for (const entry of asArray(bucket.results)) {
      const amountCents = parseFloat(String(entry.amount) || "0");
      if (!(amountCents > 0)) continue;

      const model = asString(entry.model);
      const lineItem = asString(entry.cost_type) ?? "tokens";
      const workspaceId = asString(entry.workspace_id);
      const aggKey = `${workspaceId ?? ""}|${model ?? ""}|${lineItem}`;
      const existing = agg.get(aggKey);
      if (existing) {
        existing.amountCents += amountCents;
      } else {
        agg.set(aggKey, {
          model,
          lineItem,
          workspaceId,
          amountCents,
          currency: asString(entry.currency) ?? "usd",
        });
      }
    }

    for (const row of agg.values()) {
      plans.push({
        bucketStart,
        bucketEnd,
        dimensionKey: makeDimensionKey({
          model: row.model,
          lineItem: row.lineItem,
          date,
          workspaceId: row.workspaceId,
        }),
        amount: row.amountCents / 100,
        currency: row.currency,
        model: row.model,
        lineItem: row.lineItem,
        workspaceExternalId: row.workspaceId,
        workspaceName: row.workspaceId
          ? (args.workspaceNameById.get(row.workspaceId) ?? null)
          : ANTHROPIC_DEFAULT_WORKSPACE_NAME,
      });
    }
  }
  return plans;
}

async function createSyncRun(provider: SyncProvider, triggeredByUserId: string) {
  // "system" is the sentinel the scheduler passes for cron-triggered runs. It
  // isn't a real User id, so inserting it directly violates the
  // ProviderSyncRun_triggeredByUserId_fkey foreign key and silently breaks
  // every scheduled sync. Map the sentinel to null (the column is nullable).
  // Human-triggered runs still carry their real user id for attribution.
  const resolvedUserId = triggeredByUserId === "system" ? null : triggeredByUserId;
  return prisma.providerSyncRun.create({
    data: {
      provider,
      syncType: "telemetry",
      status: "RUNNING",
      triggeredByUserId: resolvedUserId,
    },
  });
}

async function failSyncRun(syncRunId: string, error: unknown) {
  const errorMessage = error instanceof Error ? error.message : "Unknown sync error";
  await prisma.providerSyncRun.update({
    where: { id: syncRunId },
    data: {
      status: "FAILED",
      errorMessage,
      completedAt: new Date(),
    },
  });
  return errorMessage;
}

const TRUNCATION_ALERT_SOURCE = "provider_sync_truncated";
const TRUNCATION_ALERT_DEDUPE_MS = 24 * 60 * 60 * 1000;

function formatWindow(window: SyncWindow) {
  return `${window.from.toISOString().slice(0, 10)} → ${window.to.toISOString().slice(0, 10)}`;
}

/**
 * Raise a `provider_sync_truncated` alert for a run whose paginated fetches
 * hit a page cap. Deduped per provider: if an alert with the same source and
 * title was created in the last 24h nothing new is written.
 */
async function raiseTruncationAlert(args: {
  provider: SyncProvider;
  syncRunId: string;
  window: SyncWindow;
  pagination: PaginationReport;
}) {
  const label = SYNC_PROVIDER_LABELS[args.provider];
  const title = `Provider sync truncated: ${label}`;
  const since = new Date(Date.now() - TRUNCATION_ALERT_DEDUPE_MS);

  const recent = await prisma.alert.findFirst({
    where: { source: TRUNCATION_ALERT_SOURCE, title, createdAt: { gte: since } },
    select: { id: true },
  });
  if (recent) {
    logger.info("provider_sync.truncated_alert_deduped", {
      provider: args.provider,
      syncRunId: args.syncRunId,
      alertId: recent.id,
    });
    return false;
  }

  const description =
    `The ${label} sync for ${formatWindow(args.window)} reached a pagination cap before reading every row upstream, ` +
    `so Oversight usage and cost for this window are under-counted. ` +
    `Re-run a Backfill for this range in Settings → Provider Admin APIs using a narrower window, or raise the page cap. ` +
    `Pagination: ${JSON.stringify(args.pagination)}. Sync run ${args.syncRunId}.`;

  await prisma.alert.create({
    data: {
      title,
      description,
      severity: "MEDIUM",
      source: TRUNCATION_ALERT_SOURCE,
    },
  });

  await notifyDatadog({
    title: `[UrNammu] ${title}`,
    text: description,
    tags: ["source:urnammu", `alert_source:${TRUNCATION_ALERT_SOURCE}`, "severity:medium", `provider:${args.provider}`],
    alertType: "warning",
    aggregationKey: `urnammu:${TRUNCATION_ALERT_SOURCE}:${args.provider}`,
  });

  logger.warn("provider_sync.truncated", {
    provider: args.provider,
    syncRunId: args.syncRunId,
    window: { from: args.window.from.toISOString(), to: args.window.to.toISOString() },
    pagination: args.pagination,
  });
  return true;
}

/**
 * Mark a sync run SUCCEEDED, persist its window + pagination accounting in
 * `metadata`, advance the provider's watermark, and raise the truncation
 * alert when any paginated fetch was cut short.
 */
async function finishSyncRun(args: {
  syncRunId: string;
  provider: SyncProvider;
  window: SyncWindow;
  summary: Omit<SyncSummary, "syncRunId">;
  pagination?: PaginationReport;
  metadata?: Record<string, unknown>;
}) {
  const truncated = args.pagination?.truncated ?? false;
  const metadata: Record<string, unknown> = {
    ...(args.metadata ?? {}),
    window: { from: args.window.from.toISOString(), to: args.window.to.toISOString() },
    pagination: args.pagination ?? { truncated: false },
    truncated,
  };

  await prisma.providerSyncRun.update({
    where: { id: args.syncRunId },
    data: {
      status: "SUCCEEDED",
      completedAt: new Date(),
      recordsProcessed:
        args.summary.usageBucketsUpserted +
        args.summary.costBucketsUpserted +
        args.summary.projectsUpserted +
        args.summary.actorsUpserted +
        (args.summary.complianceActivitiesUpserted ?? 0) +
        (args.summary.complianceSessionsUpserted ?? 0),
      metadata: toJsonValue(metadata),
    },
  });

  // Watermark: advance even when truncated — the alert tells the operator to
  // backfill the window; re-pulling the same capped window on every schedule
  // would never make progress.
  const existing = await prisma.providerSyncWatermark.findUnique({
    where: { provider: args.provider },
    select: { watermark: true, earliest: true },
  });
  const next = advanceWatermark(existing, args.window);
  await prisma.providerSyncWatermark.upsert({
    where: { provider: args.provider },
    update: { watermark: next.watermark, earliest: next.earliest },
    create: { provider: args.provider, watermark: next.watermark, earliest: next.earliest },
  });

  if (truncated && args.pagination) {
    await raiseTruncationAlert({
      provider: args.provider,
      syncRunId: args.syncRunId,
      window: args.window,
      pagination: args.pagination,
    }).catch((error) => {
      logger.error("provider_sync.truncated_alert_failed", {
        provider: args.provider,
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }

  return truncated;
}

// ─── ProviderSyncWatermark (feed cursor) ─────────────────
// finishSyncRun owns `watermark` / `earliest`; feed-style providers also read
// the upstream `cursor` a page-capped backfill left behind.
async function loadWatermark(provider: SyncProvider): Promise<ComplianceWatermarkState | null> {
  const row = await prisma.providerSyncWatermark.findUnique({ where: { provider } });
  if (!row) return null;
  return { watermark: row.watermark, earliest: row.earliest, cursor: row.cursor };
}

async function storeSnapshot(syncRunId: string, provider: string, resourceType: string, payload: unknown) {
  await prisma.providerRawSnapshot.create({
    data: {
      provider,
      resourceType,
      payload: toJsonValue(payload),
      syncRunId,
    },
  });
}

// One AssistantDailyStat row per (provider, day, actor). Columns come from
// the mappers in ./assistant-daily-stats; this only owns the upsert.
async function upsertAssistantDailyStat(syncRunId: string, values: AssistantDailyStatValues) {
  const { provider, day, actorExternalId, product, metadata, ...columns } = values;
  const data = { ...columns, metadata: toJsonValue(metadata), syncRunId };
  await prisma.assistantDailyStat.upsert({
    where: { provider_day_actorExternalId_product: { provider, day, actorExternalId, product } },
    update: data,
    create: { provider, day, actorExternalId, product, ...data },
  });
}

async function upsertDerivedUsageLog(args: {
  provider: string;
  model: string | null;
  bucketDate: Date;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cost: number;
  metadata: Record<string, unknown>;
}) {
  const existing = await prisma.aPIUsageLog.findFirst({
    where: {
      provider: args.provider,
      model: args.model ?? undefined,
      department: "admin_sync",
      promptTokens: args.inputTokens,
      completionTokens: args.outputTokens,
      totalTokens: args.totalTokens,
      createdAt: {
        gte: startOfDayUtc(args.bucketDate),
        lt: endOfDayUtc(args.bucketDate),
      },
    },
  });

  if (existing) return false;

  await prisma.aPIUsageLog.create({
    data: {
      provider: args.provider,
      model: args.model ?? "unknown",
      department: "admin_sync",
      promptTokens: args.inputTokens,
      completionTokens: args.outputTokens,
      totalTokens: args.totalTokens,
      cost: args.cost,
      flagged: false,
      promptMetadata: toJsonValue(args.metadata),
      createdAt: args.bucketDate,
    },
  });

  return true;
}

export async function getAdminSyncOverview() {
  const [latestRuns, watermarks, anthropicLive, openaiLive, geminiLive] = await Promise.all([
    prisma.providerSyncRun.findMany({
      where: { syncType: "telemetry" },
      orderBy: { startedAt: "desc" },
      take: 8,
    }),
    prisma.providerSyncWatermark.findMany({ orderBy: { provider: "asc" } }),
    isAnthropicAdminConfigured().then((configured) =>
      configured ? fetchAnthropicOrgData().catch((err) => ({ error: err instanceof Error ? err.message : "Failed" })) : null
    ),
    isOpenAIAdminConfigured().then((configured) =>
      configured ? fetchOpenAIOrgData().catch((err) => ({ error: err instanceof Error ? err.message : "Failed" })) : null
    ),
    isGeminiBillingConfigured().then((configured) =>
      configured
        ? getGeminiBillingOverview().catch((err) => ({
            error: err instanceof Error ? err.message : "Failed",
          }))
        : null
    ),
  ]);

  return {
    anthropic: anthropicLive,
    openai: openaiLive,
    gemini: geminiLive,
    syncRuns: latestRuns,
    watermarks,
  };
}

export async function syncAnthropicTelemetry(triggeredByUserId: string, window: SyncWindow): Promise<SyncResult> {
  // Skip cleanly when no admin key is configured — do not create a
  // ProviderSyncRun row, do not call the upstream API.
  if (!(await isAnthropicAdminConfigured())) {
    return {
      provider: "anthropic",
      success: false,
      skipped: true,
      error: "Anthropic Admin API key is not configured",
    };
  }

  const syncRun = await createSyncRun("anthropic", triggeredByUserId);

  try {
    const startingAt = window.from.toISOString();
    const endingAt = window.to.toISOString();

    const systems = await loadSystemResolver("anthropic", PROVIDER_MANAGED_SYSTEM_SETTINGS_KEYS.ANTHROPIC);

    // Every list/report call follows `has_more` (page-capped) — the usage
    // report defaults to 7 one-day buckets per page, so any window longer
    // than a week would otherwise be silently cut off.
    const [org, keys, members, workspaces, usageByModelAndKey, usageByKey, costReport] = await Promise.all([
      fetchAnthropicOrgData(),
      listAllAPIKeys({ status: "active" }).catch(() => null),
      listAllMembers().catch(() => null),
      listWorkspaces({ limit: 100 }).catch(() => null),
      // Multi-dim group_by so each UsageBucket row is attributable to a
      // specific (model, api_key, workspace) triple. Fields missing from the
      // grouping come back null on every result row, so all keys' traffic
      // would collide into one row per (model, day) without api_key_id here.
      // workspace_id is added for the workspace columns; it does not enter the
      // dimension key because a key belongs to exactly one workspace.
      getAllUsageReport({ starting_at: startingAt, ending_at: endingAt, group_by: ["model", "api_key_id", "workspace_id"] }),
      // Kept for forensics / raw snapshot only — the flattened attribution
      // above supersedes this for UsageBucket writes.
      getAllUsageReport({ starting_at: startingAt, ending_at: endingAt, group_by: ["api_key_id"] }).catch(() => null),
      // The cost report cannot be grouped by api_key_id; workspace is the
      // finest attribution the API offers for spend.
      getAllCostReport({ starting_at: startingAt, ending_at: endingAt, group_by: ["workspace_id", "description"] }).catch(() => null),
    ]);

    const pagination: PaginationReport = {
      pageCap: ANTHROPIC_DEFAULT_MAX_PAGES,
      usagePages: usageByModelAndKey.pages,
      usageTruncated: usageByModelAndKey.truncated,
      usageByKeyPages: usageByKey?.pages ?? 0,
      usageByKeyTruncated: usageByKey?.truncated ?? false,
      costPages: costReport?.pages ?? 0,
      costTruncated: costReport?.truncated ?? false,
      keysPages: keys?.pages ?? 0,
      keysTruncated: keys?.truncated ?? false,
      membersPages: members?.pages ?? 0,
      membersTruncated: members?.truncated ?? false,
      truncated:
        usageByModelAndKey.truncated ||
        (usageByKey?.truncated ?? false) ||
        (costReport?.truncated ?? false) ||
        (keys?.truncated ?? false) ||
        (members?.truncated ?? false),
    };

    // Build id → name lookup for API keys so each UsageBucket row carries a
    // human-readable apiKeyName.
    const apiKeyNameById = new Map<string, string>();
    for (const key of asArray(asRecord(keys).data)) {
      const id = asString(key.id);
      const name = asString(key.name);
      if (id && name) apiKeyNameById.set(id, name);
    }
    const workspaceNameById = new Map<string, string>();
    for (const workspace of asArray(asRecord(workspaces).data)) {
      const id = asString(workspace.id);
      const name = asString(workspace.name);
      if (id && name) workspaceNameById.set(id, name);
    }
    const workspaceLabel = (workspaceId: string | null): string | null =>
      workspaceId ? (workspaceNameById.get(workspaceId) ?? null) : ANTHROPIC_DEFAULT_WORKSPACE_NAME;

    let rawSnapshotsStored = 0;
    for (const [resourceType, payload] of Object.entries({
      org,
      keys,
      members,
      workspaces,
      usage_by_model: usageByModelAndKey,
      usage_by_key: usageByKey,
      cost_report: costReport,
    })) {
      if (payload) {
        await storeSnapshot(syncRun.id, "anthropic", resourceType, payload);
        rawSnapshotsStored++;
      }
    }

    let actorsUpserted = 0;
    for (const member of asArray(asRecord(members).data)) {
      const externalId = asString(member.id) ?? asString(member.email);
      if (!externalId) continue;

      await prisma.providerActor.upsert({
        where: { provider_externalId: { provider: "anthropic", externalId } },
        update: {
          email: asString(member.email),
          name: asString(member.name),
          role: asString(member.role),
          metadata: toJsonValue(member),
          lastSeenAt: new Date(),
          syncRunId: syncRun.id,
        },
        create: {
          provider: "anthropic",
          externalId,
          email: asString(member.email),
          name: asString(member.name),
          role: asString(member.role),
          metadata: toJsonValue(member),
          syncRunId: syncRun.id,
        },
      });
      actorsUpserted++;
    }

    // ProviderProject rows for Anthropic are WORKSPACES (the Console's spend
    // and isolation boundary). Earlier releases stored API keys here; those
    // rows (ids prefixed `apikey_`) are removed so the table has one meaning.
    // API-key inventory and status live in the `keys` raw snapshot, which the
    // Claude Platform dashboard reads.
    let projectsUpserted = 0;
    await prisma.providerProject.deleteMany({
      where: { provider: "anthropic", externalId: { startsWith: "apikey_" } },
    });
    for (const workspace of asArray(asRecord(workspaces).data)) {
      const externalId = asString(workspace.id);
      if (!externalId) continue;

      const archived = !!asString(workspace.archived_at);
      await prisma.providerProject.upsert({
        where: { provider_externalId: { provider: "anthropic", externalId } },
        update: {
          name: asString(workspace.name),
          status: archived ? "archived" : "active",
          metadata: toJsonValue({ type: "workspace", ...workspace }),
          lastSeenAt: new Date(),
          syncRunId: syncRun.id,
        },
        create: {
          provider: "anthropic",
          externalId,
          name: asString(workspace.name),
          status: archived ? "archived" : "active",
          metadata: toJsonValue({ type: "workspace", ...workspace }),
          syncRunId: syncRun.id,
        },
      });
      projectsUpserted++;
    }

    // Which API keys were seen in which workspace this window — lets cost rows
    // (reported per workspace, never per key) inherit a governed system when
    // every key in the workspace maps to the same one.
    const keysByWorkspace = new Map<string, Set<string>>();

    let usageBucketsUpserted = 0;
    let costBucketsUpserted = 0;
    let apiUsageLogsCreated = 0;

    // New Anthropic API returns nested structure: data[].{ starting_at, ending_at, results[] }
    for (const bucket of asArray(asRecord(usageByModelAndKey).data)) {
      const bucketStart = new Date(asString(bucket.starting_at) ?? startingAt);
      const bucketEnd = new Date(asString(bucket.ending_at) ?? endingAt);
      const date = bucketStart.toISOString().split("T")[0];

      for (const entry of asArray(bucket.results)) {
        const model = asString(entry.model);
        const apiKeyId = asString(entry.api_key_id);
        const workspaceId = asString(entry.workspace_id);
        const workspaceKey = workspaceId ?? "";
        if (apiKeyId) {
          const set = keysByWorkspace.get(workspaceKey) ?? new Set<string>();
          set.add(apiKeyId);
          keysByWorkspace.set(workspaceKey, set);
        }
        const aiSystemId = systems.forKey(apiKeyId);

        // Token breakdown from the Anthropic usage report:
        //   uncached_input_tokens  — standard (non-cached) input tokens
        //   cache_read_input_tokens — tokens read from prompt cache
        //   cache_creation.ephemeral_{5m,1h}_input_tokens — tokens used to
        //       populate the prompt cache (billed at a premium rate)
        //   output_tokens — model-generated output tokens
        //
        // inputTokens = ALL input tokens (uncached + cache reads + cache creation)
        // so that the UsageBucket.inputTokens column reflects total input, and
        // the individual breakdown is preserved in the metadata blob.
        const uncachedInputTokens = asNumber(entry.uncached_input_tokens);
        const cacheReadTokens = asNumber(entry.cache_read_input_tokens);
        const cacheCreation = asRecord(entry.cache_creation);
        const cacheCreationTokens =
          asNumber(cacheCreation.ephemeral_1h_input_tokens) +
          asNumber(cacheCreation.ephemeral_5m_input_tokens);
        const outputTokens = asNumber(entry.output_tokens);

        const inputTokens = uncachedInputTokens + cacheReadTokens + cacheCreationTokens;
        const totalTokens = inputTokens + outputTokens;
        const dimensionKey = makeDimensionKey({ model, apiKeyId, date });

        await prisma.usageBucket.upsert({
          where: {
            provider_bucketStart_bucketEnd_granularity_dimensionKey: {
              provider: "anthropic",
              bucketStart,
              bucketEnd,
              granularity: "day",
              dimensionKey,
            },
          },
          update: {
            model,
            apiKeyExternalId: apiKeyId,
            apiKeyName: apiKeyId ? (apiKeyNameById.get(apiKeyId) ?? null) : null,
            workspaceExternalId: workspaceId,
            workspaceName: workspaceLabel(workspaceId),
            inputTokens,
            outputTokens,
            totalTokens,
            cacheReadTokens,
            cacheCreationTokens,
            metadata: toJsonValue(entry),
            syncRunId: syncRun.id,
            aiSystemId,
          },
          create: {
            provider: "anthropic",
            bucketStart,
            bucketEnd,
            granularity: "day",
            dimensionKey,
            model,
            apiKeyExternalId: apiKeyId,
            apiKeyName: apiKeyId ? (apiKeyNameById.get(apiKeyId) ?? null) : null,
            workspaceExternalId: workspaceId,
            workspaceName: workspaceLabel(workspaceId),
            inputTokens,
            outputTokens,
            totalTokens,
            cacheReadTokens,
            cacheCreationTokens,
            metadata: toJsonValue(entry),
            syncRunId: syncRun.id,
            aiSystemId,
          },
        });
        usageBucketsUpserted++;

        const created = await upsertDerivedUsageLog({
          provider: "claude",
          model,
          bucketDate: bucketStart,
          inputTokens,
          outputTokens,
          totalTokens,
          cost: 0,
          metadata: {
            source: "anthropic_admin_api",
            syncRunId: syncRun.id,
            dimensionKey,
            provider: "anthropic",
          },
        });
        if (created) apiUsageLogsCreated++;
      }
    }

    // Process cost report (separate API endpoint in new Anthropic API).
    // See planAnthropicCostBuckets for the aggregation and unit rules. Cost is
    // reported per workspace, never per key, so the governed system comes from
    // the keys seen in that workspace (all agree → that system; else default).
    const costPlans = planAnthropicCostBuckets({
      costReport,
      fallbackStart: startingAt,
      fallbackEnd: endingAt,
      workspaceNameById,
    });
    const writtenCostKeysByDay = new Map<string, { bucketStart: Date; bucketEnd: Date; keys: string[] }>();
    for (const plan of costPlans) {
      const aiSystemId = systems.forKeys(keysByWorkspace.get(plan.workspaceExternalId ?? "") ?? []);
      await prisma.costBucket.upsert({
        where: {
          provider_bucketStart_bucketEnd_granularity_dimensionKey: {
            provider: "anthropic",
            bucketStart: plan.bucketStart,
            bucketEnd: plan.bucketEnd,
            granularity: "day",
            dimensionKey: plan.dimensionKey,
          },
        },
        update: {
          amount: plan.amount,
          currency: plan.currency,
          model: plan.model,
          lineItem: plan.lineItem,
          workspaceExternalId: plan.workspaceExternalId,
          workspaceName: plan.workspaceName,
          aiSystemId,
          syncRunId: syncRun.id,
        },
        create: {
          provider: "anthropic",
          bucketStart: plan.bucketStart,
          bucketEnd: plan.bucketEnd,
          granularity: "day",
          dimensionKey: plan.dimensionKey,
          amount: plan.amount,
          currency: plan.currency,
          model: plan.model,
          lineItem: plan.lineItem,
          workspaceExternalId: plan.workspaceExternalId,
          workspaceName: plan.workspaceName,
          aiSystemId,
          syncRunId: syncRun.id,
        },
      });
      costBucketsUpserted++;

      const dayKey = plan.bucketStart.toISOString();
      const day = writtenCostKeysByDay.get(dayKey) ?? {
        bucketStart: plan.bucketStart,
        bucketEnd: plan.bucketEnd,
        keys: [],
      };
      day.keys.push(plan.dimensionKey);
      writtenCostKeysByDay.set(dayKey, day);
    }

    // The cost report is authoritative for a day, so remove admin-sync cost
    // rows for that day whose dimension key was not re-written. This retires
    // pre-workspace rows (keyed without workspaceId) once the same day is
    // re-pulled grouped by workspace, instead of leaving both and
    // double-counting the overlap window.
    for (const day of writtenCostKeysByDay.values()) {
      await prisma.costBucket.deleteMany({
        where: {
          provider: "anthropic",
          granularity: "day",
          bucketStart: day.bucketStart,
          bucketEnd: day.bucketEnd,
          dimensionKey: { notIn: day.keys },
        },
      });
    }

    const summary = {
      usageBucketsUpserted,
      costBucketsUpserted,
      rawSnapshotsStored,
      projectsUpserted,
      actorsUpserted,
      apiUsageLogsCreated,
    };

    const truncated = await finishSyncRun({
      syncRunId: syncRun.id,
      provider: "anthropic",
      window,
      summary,
      pagination,
      metadata: {
        coverage: {
          keys: asArray(asRecord(keys).data).length,
          members: asArray(asRecord(members).data).length,
          workspaces: asArray(asRecord(workspaces).data).length,
        },
        attribution: {
          defaultSystemId: systems.defaultSystemId,
          costGroupedByWorkspace: true,
        },
      },
    });

    return { provider: "anthropic", success: true, syncRunId: syncRun.id, window, truncated, ...summary };
  } catch (error) {
    const errorMessage = await failSyncRun(syncRun.id, error);
    return { provider: "anthropic", success: false, error: errorMessage };
  }
}

export async function syncClaudeCodeAnalytics(triggeredByUserId: string, window: SyncWindow): Promise<SyncResult> {
  if (!(await isClaudeCodeAnalyticsAvailable())) {
    return {
      provider: "claude_code",
      success: false,
      skipped: true,
      error: "Anthropic Admin API key not configured",
    };
  }

  const syncRun = await createSyncRun("claude_code", triggeredByUserId);

  try {
    // The analytics API is one call per UTC day; the range is inclusive of
    // the start day and exclusive of the end day, so round `to` up to the
    // next midnight to include the (partial) current day.
    const startDate = startOfDayUtc(window.from).toISOString().split("T")[0];
    const endDate = endOfDayUtc(new Date(window.to.getTime() - 1)).toISOString().split("T")[0];

    const rangeResult: ClaudeCodeRangeResult = await getClaudeCodeReportRange(startDate, endDate);
    const entries = rangeResult.entries;

    let rawSnapshotsStored = 0;
    await storeSnapshot(syncRun.id, "claude_code", "analytics_report", {
      entries_count: entries.length,
      days_requested: rangeResult.daysRequested,
      days_succeeded: rangeResult.daysSucceeded,
      days_failed: rangeResult.daysFailed,
      fetch_errors: rangeResult.errors,
      sample_actor_types: entries.slice(0, 10).map((e) => ({
        type: e.actor.type,
        has_email: e.actor.type === "user_actor",
        has_key_name: e.actor.type === "api_actor",
        customer_type: e.customer_type,
      })),
    } as unknown as Record<string, unknown>);
    rawSnapshotsStored++;

    let actorsUpserted = 0;
    let usageBucketsUpserted = 0;
    let assistantStatsUpserted = 0;
    const seenActors = new Set<string>();

    for (const entry of entries) {
      const actorId = getClaudeCodeActorExternalId(entry.actor);
      if (!actorId) continue;
      const actorName = actorId.includes("@") ? actorId.split("@")[0] : actorId;

      // Upsert actor (deduplicate within this sync)
      if (!seenActors.has(actorId)) {
        seenActors.add(actorId);
        await prisma.providerActor.upsert({
          where: { provider_externalId: { provider: "claude_code", externalId: actorId } },
          update: {
            email: actorId.includes("@") ? actorId : null,
            name: actorName,
            role: asString(entry.customer_type as unknown),
            metadata: toJsonValue({
              actor_type: entry.actor.type,
              terminal_type: entry.terminal_type,
              customer_type: entry.customer_type,
            }),
            lastSeenAt: new Date(),
            syncRunId: syncRun.id,
          },
          create: {
            provider: "claude_code",
            externalId: actorId,
            email: actorId.includes("@") ? actorId : null,
            name: actorName,
            role: asString(entry.customer_type as unknown),
            metadata: toJsonValue({
              actor_type: entry.actor.type,
              terminal_type: entry.terminal_type,
              customer_type: entry.customer_type,
            }),
            syncRunId: syncRun.id,
          },
        });
        actorsUpserted++;
      }

      const date = entry.date?.split("T")[0] ?? startDate;
      const bucketStart = new Date(`${date}T00:00:00.000Z`);
      const bucketEnd = new Date(bucketStart.getTime() + 24 * 60 * 60 * 1000);

      // Compute estimated cost from model_breakdown (for display only —
      // actual token/cost accounting lives in the Anthropic usage & cost syncs)
      let estimatedCostCents = 0;
      for (const mb of entry.model_breakdown ?? []) {
        estimatedCostCents += mb.estimated_cost?.amount ?? 0;
      }

      // Columnar per-user-per-day stats — what dashboards and reports read.
      await upsertAssistantDailyStat(
        syncRun.id,
        claudeCodeEntryToDailyStat(entry, { externalId: actorId, name: actorName }, bucketStart),
      );
      assistantStatsUpserted++;

      // LEGACY: the same numbers as metadata JSON on a UsageBucket, kept for
      // one release so nothing that still reads it breaks. Token and cost
      // data is NOT stored on the bucket — the regular Anthropic usage sync
      // already captures that. This avoids double-counting.
      const dimensionKey = makeDimensionKey({ actorId, date });
      await prisma.usageBucket.upsert({
        where: {
          provider_bucketStart_bucketEnd_granularity_dimensionKey: {
            provider: "claude_code",
            bucketStart,
            bucketEnd,
            granularity: "day",
            dimensionKey,
          },
        },
        update: {
          actorExternalId: actorId,
          actorName,
          metadata: toJsonValue({
            core_metrics: entry.core_metrics,
            tool_actions: entry.tool_actions,
            terminal_type: entry.terminal_type,
            customer_type: entry.customer_type,
            estimated_cost_cents: estimatedCostCents,
            model_breakdown: entry.model_breakdown,
          }),
          syncRunId: syncRun.id,
        },
        create: {
          provider: "claude_code",
          bucketStart,
          bucketEnd,
          granularity: "day",
          dimensionKey,
          actorExternalId: actorId,
          actorName,
          metadata: toJsonValue({
            core_metrics: entry.core_metrics,
            tool_actions: entry.tool_actions,
            terminal_type: entry.terminal_type,
            customer_type: entry.customer_type,
            estimated_cost_cents: estimatedCostCents,
            model_breakdown: entry.model_breakdown,
          }),
          syncRunId: syncRun.id,
        },
      });
      usageBucketsUpserted++;
    }

    const summary = {
      usageBucketsUpserted,
      costBucketsUpserted: 0,
      rawSnapshotsStored,
      projectsUpserted: 0,
      actorsUpserted,
      apiUsageLogsCreated: 0,
    };

    const truncated = await finishSyncRun({
      syncRunId: syncRun.id,
      provider: "claude_code",
      window,
      summary,
      pagination: {
        pageCapPerDay: CLAUDE_CODE_MAX_PAGES_PER_DAY,
        pages: rangeResult.pages,
        truncatedDays: rangeResult.truncatedDays,
        truncated: rangeResult.truncated,
      },
      metadata: {
        entriesProcessed: entries.length,
        assistantDailyStatsUpserted: assistantStatsUpserted,
        uniqueUsers: seenActors.size,
        dateRange: { startDate, endDate },
        daysRequested: rangeResult.daysRequested,
        daysSucceeded: rangeResult.daysSucceeded,
        daysFailed: rangeResult.daysFailed,
        fetchErrors: rangeResult.errors,
      },
    });

    return { provider: "claude_code", success: true, syncRunId: syncRun.id, window, truncated, ...summary };
  } catch (error) {
    const errorMessage = await failSyncRun(syncRun.id, error);
    return { provider: "claude_code", success: false, error: errorMessage };
  }
}

// ─── Cursor (Admin API cost + usage) ─────────────────────
// Complements the OTel span pipeline (CursorSpan = activity, no cost). The
// Cursor hook carries no tokens/cost, so authoritative spend comes from the
// team Admin API. Daily-usage-data → per-user-per-day AssistantDailyStat
// rows (plus legacy activity UsageBuckets for one release);
// filtered-usage-events → per-day/model CostBuckets (chargedCents) + per-user
// token/spend enrichment; spend → per-member ProviderActor + cycle spend
// metadata. ~30-day API retention, so the scheduled sync builds history over
// time.
export async function syncCursorTelemetry(triggeredByUserId: string, window: SyncWindow): Promise<SyncResult> {
  if (!(await isCursorAdminConfigured())) {
    return {
      provider: "cursor",
      success: false,
      skipped: true,
      error: "Cursor Admin API key is not configured",
    };
  }

  const syncRun = await createSyncRun("cursor", triggeredByUserId);

  try {
    const startMs = startOfDayUtc(window.from).getTime();
    const endMs = window.to.getTime();

    const managedSystemId = (
      await loadSystemResolver("cursor", PROVIDER_MANAGED_SYSTEM_SETTINGS_KEYS.CURSOR)
    ).defaultSystemId;

    const [dailyPaged, spend, eventsPaged] = await Promise.all([
      getCursorDailyUsage(startMs, endMs),
      getCursorSpend().catch(() => ({ members: [], cycleStartMs: null })),
      getCursorUsageEvents(startMs, endMs).catch(() => ({ rows: [], pages: 0, truncated: false })),
    ]);
    const dailyRows = dailyPaged.rows;
    const events = eventsPaged.rows;
    const pagination: PaginationReport = {
      dailyUsagePageCap: CURSOR_DAILY_USAGE_MAX_PAGES,
      dailyUsagePages: dailyPaged.pages,
      dailyUsageTruncated: dailyPaged.truncated,
      usageEventsPageCap: CURSOR_USAGE_EVENTS_MAX_PAGES,
      usageEventsPages: eventsPaged.pages,
      usageEventsTruncated: eventsPaged.truncated,
      truncated: dailyPaged.truncated || eventsPaged.truncated,
    };

    let rawSnapshotsStored = 0;
    await storeSnapshot(syncRun.id, "cursor", "daily_usage", {
      rows: dailyRows.length,
      sample: dailyRows.slice(0, 5),
    });
    await storeSnapshot(syncRun.id, "cursor", "spend", {
      members: spend.members.length,
      cycleStartMs: spend.cycleStartMs,
    });
    await storeSnapshot(syncRun.id, "cursor", "usage_events", {
      events: events.length,
      sample: events.slice(0, 5),
    });
    rawSnapshotsStored += 3;

    // ── Aggregate usage-events: tokens per (email, day) and cost per (day, model)
    const eventDay = (ts: unknown): string | null => {
      const ms = typeof ts === "string" ? Number(ts) : asNumber(ts);
      if (!Number.isFinite(ms) || ms <= 0) return null;
      return new Date(ms).toISOString().split("T")[0];
    };
    const tokensByUserDay = new Map<
      string,
      { input: number; output: number; cacheRead: number; cacheCreation: number }
    >();
    const costByDayModel = new Map<
      string,
      { day: string; model: string | null; cents: number }
    >();
    // Per-(email, day) spend, stored on the user's UsageBucket metadata as
    // `chargedCents` so Usage by Person can report Cursor cost per developer.
    // Team-wide CostBuckets below stay the source for org totals; this is a
    // per-user annotation, not a second cost row.
    const centsByUserDay = new Map<string, number>();
    for (const ev of events) {
      const day = eventDay(ev.timestamp);
      if (!day) continue;
      const email = asString(ev.userEmail);
      const tu = ev.tokenUsage ?? {};
      if (email) {
        const k = `${email}|${day}`;
        const agg = tokensByUserDay.get(k) ?? { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 };
        agg.input += asNumber(tu.inputTokens);
        agg.output += asNumber(tu.outputTokens);
        agg.cacheRead += asNumber(tu.cacheReadTokens);
        agg.cacheCreation += asNumber(tu.cacheWriteTokens);
        tokensByUserDay.set(k, agg);
      }
      const charged = asNumber(ev.chargedCents);
      if (email && charged > 0) {
        const k = `${email}|${day}`;
        centsByUserDay.set(k, (centsByUserDay.get(k) ?? 0) + charged);
      }
      if (charged > 0) {
        const model = asString(ev.model);
        const k = `${day}|${model ?? ""}`;
        const c = costByDayModel.get(k) ?? { day, model, cents: 0 };
        c.cents += charged;
        costByDayModel.set(k, c);
      }
    }

    // ── AssistantDailyStat + legacy UsageBucket per (user, day) from daily-usage-data ──
    let usageBucketsUpserted = 0;
    let assistantStatsUpserted = 0;
    let actorsUpserted = 0;
    const seenActors = new Set<string>();

    for (const row of dailyRows) {
      const email = asString(row.email);
      const day = asString(row.day) ?? (row.date ? new Date(asNumber(row.date)).toISOString().split("T")[0] : null);
      if (!day) continue;
      const actorId = email ?? (row.userId != null ? `user:${row.userId}` : null);
      const bucketStart = new Date(`${day}T00:00:00.000Z`);
      const bucketEnd = new Date(bucketStart.getTime() + 24 * 60 * 60 * 1000);

      const requestCount =
        asNumber(row.composerRequests) +
        asNumber(row.chatRequests) +
        asNumber(row.agentRequests) +
        asNumber(row.cmdkUsages);

      const tokenAgg = email ? tokensByUserDay.get(`${email}|${day}`) : undefined;
      // Only record spend when the events feed actually returned data;
      // otherwise leave it null/absent so readers can tell "unknown" from
      // "zero" (Usage by Person shows Cursor cost as n/a when no row has it).
      const chargedCents =
        events.length > 0 && email ? centsByUserDay.get(`${email}|${day}`) ?? 0 : null;
      const actorName = email ? email.split("@")[0] : actorId;

      // Columnar per-user-per-day stats — what dashboards and reports read.
      // Rows with no email and no user id cannot be keyed to a person.
      if (actorId) {
        await upsertAssistantDailyStat(
          syncRun.id,
          cursorDailyRowToStat(row, { externalId: actorId, name: actorName }, bucketStart, {
            tokens: tokenAgg ?? null,
            chargedCents,
          }),
        );
        assistantStatsUpserted++;
      }

      // LEGACY: the same row as metadata JSON on a UsageBucket, kept for one
      // release so nothing that still reads it breaks.
      const bucketMetadata = toJsonValue(
        chargedCents != null ? { ...row, chargedCents } : row,
      );
      const dimensionKey = makeDimensionKey({ actorId, date: day });

      await prisma.usageBucket.upsert({
        where: {
          provider_bucketStart_bucketEnd_granularity_dimensionKey: {
            provider: "cursor",
            bucketStart,
            bucketEnd,
            granularity: "day",
            dimensionKey,
          },
        },
        update: {
          model: asString(row.mostUsedModel),
          actorExternalId: actorId,
          actorName,
          inputTokens: tokenAgg?.input ?? 0,
          outputTokens: tokenAgg?.output ?? 0,
          totalTokens: tokenAgg ? tokenAgg.input + tokenAgg.output : 0,
          cacheReadTokens: tokenAgg?.cacheRead ?? 0,
          cacheCreationTokens: tokenAgg?.cacheCreation ?? 0,
          requestCount,
          aiSystemId: managedSystemId,
          metadata: bucketMetadata,
          syncRunId: syncRun.id,
        },
        create: {
          provider: "cursor",
          bucketStart,
          bucketEnd,
          granularity: "day",
          dimensionKey,
          model: asString(row.mostUsedModel),
          actorExternalId: actorId,
          actorName,
          inputTokens: tokenAgg?.input ?? 0,
          outputTokens: tokenAgg?.output ?? 0,
          totalTokens: tokenAgg ? tokenAgg.input + tokenAgg.output : 0,
          cacheReadTokens: tokenAgg?.cacheRead ?? 0,
          cacheCreationTokens: tokenAgg?.cacheCreation ?? 0,
          requestCount,
          aiSystemId: managedSystemId,
          metadata: bucketMetadata,
          syncRunId: syncRun.id,
        },
      });
      usageBucketsUpserted++;
    }

    // ── ProviderActor + spend metadata per member ──
    for (const m of spend.members) {
      const email = asString(m.email);
      const actorId = email ?? (m.userId != null ? `user:${m.userId}` : null);
      if (!actorId || seenActors.has(actorId)) continue;
      seenActors.add(actorId);
      await prisma.providerActor.upsert({
        where: { provider_externalId: { provider: "cursor", externalId: actorId } },
        update: {
          email,
          name: asString(m.name) ?? (email ? email.split("@")[0] : actorId),
          role: asString(m.role),
          metadata: toJsonValue({
            spendCents: m.spendCents,
            overallSpendCents: m.overallSpendCents,
            fastPremiumRequests: m.fastPremiumRequests,
            monthlyLimitDollars: m.monthlyLimitDollars,
            cycleStartMs: spend.cycleStartMs,
          }),
          lastSeenAt: new Date(),
          syncRunId: syncRun.id,
        },
        create: {
          provider: "cursor",
          externalId: actorId,
          email,
          name: asString(m.name) ?? (email ? email.split("@")[0] : actorId),
          role: asString(m.role),
          metadata: toJsonValue({
            spendCents: m.spendCents,
            overallSpendCents: m.overallSpendCents,
            fastPremiumRequests: m.fastPremiumRequests,
            monthlyLimitDollars: m.monthlyLimitDollars,
            cycleStartMs: spend.cycleStartMs,
          }),
          syncRunId: syncRun.id,
        },
      });
      actorsUpserted++;
    }

    // ── CostBucket per (day, model) from usage-events (chargedCents) ──
    let costBucketsUpserted = 0;
    for (const c of costByDayModel.values()) {
      const bucketStart = new Date(`${c.day}T00:00:00.000Z`);
      const bucketEnd = new Date(bucketStart.getTime() + 24 * 60 * 60 * 1000);
      const dimensionKey = makeDimensionKey({ model: c.model, lineItem: "usage_based", date: c.day });
      await prisma.costBucket.upsert({
        where: {
          provider_bucketStart_bucketEnd_granularity_dimensionKey: {
            provider: "cursor",
            bucketStart,
            bucketEnd,
            granularity: "day",
            dimensionKey,
          },
        },
        update: {
          amount: c.cents / 100, // chargedCents → USD
          currency: "usd",
          model: c.model,
          lineItem: "usage_based",
          syncRunId: syncRun.id,
          aiSystemId: managedSystemId,
        },
        create: {
          provider: "cursor",
          bucketStart,
          bucketEnd,
          granularity: "day",
          dimensionKey,
          amount: c.cents / 100,
          currency: "usd",
          model: c.model,
          lineItem: "usage_based",
          syncRunId: syncRun.id,
          aiSystemId: managedSystemId,
        },
      });
      costBucketsUpserted++;
    }

    const summary = {
      usageBucketsUpserted,
      costBucketsUpserted,
      rawSnapshotsStored,
      projectsUpserted: 0,
      actorsUpserted,
      apiUsageLogsCreated: 0,
    };

    const truncated = await finishSyncRun({
      syncRunId: syncRun.id,
      provider: "cursor",
      window,
      summary,
      pagination,
      metadata: {
        dailyRows: dailyRows.length,
        assistantDailyStatsUpserted: assistantStatsUpserted,
        usageEvents: events.length,
        members: spend.members.length,
        dateRange: { startMs, endMs },
      },
    });

    return { provider: "cursor", success: true, syncRunId: syncRun.id, window, truncated, ...summary };
  } catch (error) {
    const errorMessage = await failSyncRun(syncRun.id, error);
    return { provider: "cursor", success: false, error: errorMessage };
  }
}

// ─── GitHub Copilot (usage metrics reports + seats) ──────────────────────
// Report-based API: one `{ download_links }` call per day per report, then
// the NDJSON files. `users-1-day` → one AssistantDailyStat per user per day
// (actorExternalId = seat email when GitHub exposes one, else the login,
// lower-cased); `organization-1-day` / `enterprise-1-day` → one UsageBucket
// per day carrying the org totals (DAU/WAU/MAU, PR metrics, feature / IDE /
// model breakdowns) in metadata; the seats endpoint → ProviderActor rows
// with last_activity_at for the identity join. Reports land within two
// days, so recent 404s are "pending" and hold the watermark back; the walk
// covers at most COPILOT_MAX_DAYS_PER_RUN days (newest first) per run.
export async function syncGitHubCopilotTelemetry(triggeredByUserId: string, window: SyncWindow): Promise<SyncResult> {
  if (!(await isGitHubCopilotConfigured())) {
    return {
      provider: "github_copilot",
      success: false,
      skipped: true,
      error: "GitHub Copilot token and organization / enterprise are not configured",
    };
  }

  const syncRun = await createSyncRun("github_copilot", triggeredByUserId);

  try {
    const scope = await getCopilotScope();
    if (!scope) throw new Error("GitHub Copilot organization / enterprise is not configured");
    const managedSystemId = (
      await loadSystemResolver("github_copilot", PROVIDER_MANAGED_SYSTEM_SETTINGS_KEYS.GITHUB_COPILOT)
    ).defaultSystemId;

    const now = new Date();
    const walk = planCopilotDayWalk(window);

    // ── Seats: identity join (login → email) + last activity ──
    let seats: CopilotSeat[] = [];
    let seatsError: string | null = null;
    let seatsTotal: number | null = null;
    let requestCount = 0;
    try {
      const result = await listCopilotSeats(scope);
      seats = result.seats;
      seatsTotal = result.totalSeats;
      requestCount += result.pages;
    } catch (error) {
      seatsError = error instanceof Error ? error.message : String(error);
      logger.warn("provider_sync.copilot_seats_failed", { error: seatsError });
    }
    const seatIndex = buildSeatIndex(seats);

    let rawSnapshotsStored = 0;
    await storeSnapshot(syncRun.id, "github_copilot", "seats", {
      scope,
      totalSeats: seatsTotal,
      seats: seats.length,
      error: seatsError,
      sample: seats.slice(0, 5),
    });
    rawSnapshotsStored++;

    // ── Day walk ──
    let assistantStatsUpserted = 0;
    let usageBucketsUpserted = 0;
    const daysSucceeded: string[] = [];
    const pendingDays: string[] = [];
    const emptyDays: string[] = [];
    const failedDays: { day: string; error: string }[] = [];
    const rejectedLines: { day: string; report: string; count: number; sample: string[] }[] = [];
    const seenActors = new Map<string, { login: string; seat: CopilotSeat | null }>();
    let sampleStored = false;

    for (const day of walk.days) {
      try {
        const [users, aggregate] = await Promise.all([
          getCopilotUsersReport(scope, day),
          getCopilotAggregateReport(scope, day),
        ]);
        requestCount += 2 + users.files + aggregate.files;

        if (!users.found && !aggregate.found) {
          if (isCopilotReportPending(day, now)) pendingDays.push(day);
          else emptyDays.push(day);
          continue;
        }
        if (users.rejected.length > 0) {
          rejectedLines.push({ day, report: "users-1-day", count: users.rejected.length, sample: users.rejected.slice(0, 3).map((r) => `line ${r.line}: ${r.reason}`) });
        }
        if (aggregate.rejected.length > 0) {
          rejectedLines.push({ day, report: "aggregate-1-day", count: aggregate.rejected.length, sample: aggregate.rejected.slice(0, 3).map((r) => `line ${r.line}: ${r.reason}`) });
        }
        if (!sampleStored) {
          await storeSnapshot(syncRun.id, "github_copilot", "reports", {
            day,
            users: { rows: users.rows.length, files: users.files, sample: users.rows.slice(0, 3) },
            aggregate: { rows: aggregate.rows.length, files: aggregate.files, sample: aggregate.rows.slice(0, 1) },
          });
          rawSnapshotsStored++;
          sampleStored = true;
        }

        for (const row of users.rows) {
          if (row.day.slice(0, 10) !== day) continue; // defensive: a file only carries its own day
          const seat = seatIndex.get(row.user_login.toLowerCase()) ?? null;
          const actorId = copilotActorExternalId(row.user_login, seat?.email);
          seenActors.set(actorId, { login: row.user_login, seat });
          await upsertAssistantDailyStat(
            syncRun.id,
            copilotUserRowToStat(row, { externalId: actorId, name: row.user_login }),
          );
          assistantStatsUpserted++;
        }

        for (const orgDay of aggregate.rows) {
          if (orgDay.day.slice(0, 10) !== day) continue;
          const totals = copilotOrgDayToTotals(orgDay);
          const bucketStart = new Date(`${totals.day}T00:00:00.000Z`);
          const bucketEnd = new Date(bucketStart.getTime() + 24 * 60 * 60 * 1000);
          const dimensionKey = makeDimensionKey({ date: totals.day, scope: scope.kind });
          const inputTokens = totals.inputTokens ?? 0;
          const outputTokens = totals.outputTokens ?? 0;
          const data = {
            model: null,
            actorExternalId: null,
            actorName: scope.slug,
            inputTokens,
            outputTokens,
            totalTokens: inputTokens + outputTokens,
            cacheReadTokens: 0,
            cacheCreationTokens: 0,
            requestCount: totals.interactions,
            aiSystemId: managedSystemId,
            metadata: toJsonValue({ ...totals.metadata, scopeKind: scope.kind, scopeSlug: scope.slug }),
            syncRunId: syncRun.id,
          };
          await prisma.usageBucket.upsert({
            where: {
              provider_bucketStart_bucketEnd_granularity_dimensionKey: {
                provider: "github_copilot",
                bucketStart,
                bucketEnd,
                granularity: "day",
                dimensionKey,
              },
            },
            update: data,
            create: { provider: "github_copilot", bucketStart, bucketEnd, granularity: "day", dimensionKey, ...data },
          });
          usageBucketsUpserted++;
        }
        daysSucceeded.push(day);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        failedDays.push({ day, error: message });
        logger.warn("provider_sync.copilot_day_failed", { day, error: message });
        // A 403 (policy disabled / wrong scopes) will repeat for every day —
        // stop early and fail the run so the operator sees one clear error.
        if (/\(403\)/.test(message) || /\(401\)/.test(message)) throw error;
      }
    }

    if (walk.days.length > 0 && daysSucceeded.length === 0 && failedDays.length > 0) {
      throw new Error(`Every requested day failed; first error: ${failedDays[0].error}`);
    }

    // ── ProviderActor per seat / seen user ──
    let actorsUpserted = 0;
    const actorRows = new Map<string, { login: string; seat: CopilotSeat | null }>(seenActors);
    for (const seat of seats) {
      const actorId = copilotActorExternalId(seat.login, seat.email);
      if (!actorRows.has(actorId)) actorRows.set(actorId, { login: seat.login, seat });
    }
    for (const [actorId, { login, seat }] of actorRows) {
      const metadata = toJsonValue({
        login,
        userId: seat?.userId ?? null,
        lastActivityAt: seat?.lastActivityAt ?? null,
        lastActivityEditor: seat?.lastActivityEditor ?? null,
        planType: seat?.planType ?? null,
        seatCreatedAt: seat?.createdAt ?? null,
        pendingCancellationDate: seat?.pendingCancellationDate ?? null,
        hasSeat: !!seat,
        scopeKind: scope.kind,
        scopeSlug: scope.slug,
      });
      const lastSeenAt = seat?.lastActivityAt ? new Date(seat.lastActivityAt) : new Date();
      await prisma.providerActor.upsert({
        where: { provider_externalId: { provider: "github_copilot", externalId: actorId } },
        update: {
          email: seat?.email?.toLowerCase() ?? (actorId.includes("@") ? actorId : null),
          name: login,
          role: seat?.planType ?? null,
          metadata,
          lastSeenAt: Number.isNaN(lastSeenAt.getTime()) ? new Date() : lastSeenAt,
          syncRunId: syncRun.id,
        },
        create: {
          provider: "github_copilot",
          externalId: actorId,
          email: seat?.email?.toLowerCase() ?? (actorId.includes("@") ? actorId : null),
          name: login,
          role: seat?.planType ?? null,
          metadata,
          lastSeenAt: Number.isNaN(lastSeenAt.getTime()) ? new Date() : lastSeenAt,
          syncRunId: syncRun.id,
        },
      });
      actorsUpserted++;
    }

    const summary = {
      usageBucketsUpserted,
      costBucketsUpserted: 0,
      rawSnapshotsStored,
      projectsUpserted: 0,
      actorsUpserted,
      apiUsageLogsCreated: 0,
    };

    // Skipped days (window longer than the per-run cap) under-count the
    // window exactly like a hit page cap does, so they flow through the same
    // truncation accounting and alert.
    const pagination: PaginationReport = {
      requests: requestCount,
      pages: requestCount,
      daysRequested: walk.days.length,
      maxDaysPerRun: COPILOT_MAX_DAYS_PER_RUN,
      skippedDays: walk.skippedDays,
      truncated: walk.skippedDays.length > 0,
    };

    const truncated = await finishSyncRun({
      syncRunId: syncRun.id,
      provider: "github_copilot",
      window: resolveCopilotWatermarkWindow(window, pendingDays),
      summary,
      pagination,
      metadata: {
        scope,
        requestedWindow: { from: window.from.toISOString(), to: window.to.toISOString() },
        daysSucceeded,
        pendingDays,
        emptyDays,
        failedDays,
        beforeDataStart: walk.beforeDataStart,
        rejectedLines,
        assistantDailyStatsUpserted: assistantStatsUpserted,
        seats: { total: seatsTotal, fetched: seats.length, withEmail: seats.filter((s) => !!s.email).length, error: seatsError },
        usersSeen: seenActors.size,
      },
    });

    return { provider: "github_copilot", success: true, syncRunId: syncRun.id, window, truncated, ...summary };
  } catch (error) {
    const errorMessage = await failSyncRun(syncRun.id, error);
    return { provider: "github_copilot", success: false, error: errorMessage };
  }
}

export async function syncGeminiTelemetry(triggeredByUserId: string, window: SyncWindow): Promise<SyncResult> {
  if (!(await isGeminiBillingConfigured())) {
    return {
      provider: "gemini",
      success: false,
      skipped: true,
      error: "Google Gemini billing export is not configured",
    };
  }

  const syncRun = await createSyncRun("gemini", triggeredByUserId);

  try {
    const billing = await getGeminiBillingRowsForWindow(window);
    const rows = billing.rows;

    await storeSnapshot(syncRun.id, "gemini", "billing_export_summary", {
      rows: rows.length,
      sample: rows.slice(0, 10),
    });

    const rawSnapshotsStored = 1;
    let projectsUpserted = 0;
    let usageBucketsUpserted = 0;
    let costBucketsUpserted = 0;

    for (const row of rows) {
      const bucketStart = new Date(`${row.usage_date}T00:00:00.000Z`);
      const bucketEnd = new Date(bucketStart.getTime() + 24 * 60 * 60 * 1000);
      const { model, requestCount, metadata } = getGeminiUsageMetadata(row);
      const dimensionKey = makeDimensionKey({
        projectExternalId: row.project_id,
        model,
        sku: row.sku_description,
        date: row.usage_date,
      });

      await prisma.usageBucket.upsert({
        where: {
          provider_bucketStart_bucketEnd_granularity_dimensionKey: {
            provider: "gemini",
            bucketStart,
            bucketEnd,
            granularity: "day",
            dimensionKey,
          },
        },
        update: {
          model,
          projectExternalId: row.project_id,
          projectName: row.project_name,
          totalTokens: 0,
          inputTokens: 0,
          outputTokens: 0,
          requestCount,
          metadata: toJsonValue(metadata),
          syncRunId: syncRun.id,
        },
        create: {
          provider: "gemini",
          bucketStart,
          bucketEnd,
          granularity: "day",
          dimensionKey,
          model,
          projectExternalId: row.project_id,
          projectName: row.project_name,
          totalTokens: 0,
          inputTokens: 0,
          outputTokens: 0,
          requestCount,
          metadata: toJsonValue(metadata),
          syncRunId: syncRun.id,
        },
      });
      usageBucketsUpserted++;

      await prisma.costBucket.upsert({
        where: {
          provider_bucketStart_bucketEnd_granularity_dimensionKey: {
            provider: "gemini",
            bucketStart,
            bucketEnd,
            granularity: "day",
            dimensionKey,
          },
        },
        update: {
          amount: row.total_cost,
          currency: "usd",
          model,
          projectExternalId: row.project_id,
          projectName: row.project_name,
          lineItem: row.sku_description,
          metadata: toJsonValue(metadata),
          syncRunId: syncRun.id,
        },
        create: {
          provider: "gemini",
          bucketStart,
          bucketEnd,
          granularity: "day",
          dimensionKey,
          amount: row.total_cost,
          currency: "usd",
          model,
          projectExternalId: row.project_id,
          projectName: row.project_name,
          lineItem: row.sku_description,
          metadata: toJsonValue(metadata),
          syncRunId: syncRun.id,
        },
      });
      costBucketsUpserted++;

      if (row.project_id) {
        await prisma.providerProject.upsert({
          where: { provider_externalId: { provider: "gemini", externalId: row.project_id } },
          update: {
            name: row.project_name,
            status: "active",
            metadata: toJsonValue({
              serviceDescription: row.service_description,
              skuDescription: row.sku_description,
            }),
            lastSeenAt: new Date(),
            syncRunId: syncRun.id,
          },
          create: {
            provider: "gemini",
            externalId: row.project_id,
            name: row.project_name,
            status: "active",
            metadata: toJsonValue({
              serviceDescription: row.service_description,
              skuDescription: row.sku_description,
            }),
            syncRunId: syncRun.id,
          },
        });
        projectsUpserted++;
      }
    }

    const summary = {
      usageBucketsUpserted,
      costBucketsUpserted,
      rawSnapshotsStored,
      projectsUpserted,
      actorsUpserted: 0,
      apiUsageLogsCreated: 0,
    };

    const truncated = await finishSyncRun({
      syncRunId: syncRun.id,
      provider: "gemini",
      window,
      summary,
      pagination: {
        rowLimit: GEMINI_BILLING_ROW_LIMIT,
        pages: billing.pages,
        truncated: billing.truncated,
      },
      metadata: { billingRows: rows.length },
    });

    return { provider: "gemini", success: true, syncRunId: syncRun.id, window, truncated, ...summary };
  } catch (error) {
    const errorMessage = await failSyncRun(syncRun.id, error);
    return { provider: "gemini", success: false, error: errorMessage };
  }
}

export async function syncOpenAITelemetry(triggeredByUserId: string, window: SyncWindow): Promise<SyncResult> {
  // Skip cleanly when no admin key is configured — do not create a
  // ProviderSyncRun row, do not call the upstream API.
  if (!(await isOpenAIAdminConfigured())) {
    return {
      provider: "openai",
      success: false,
      skipped: true,
      error: "OpenAI Admin API key is not configured",
    };
  }

  const syncRun = await createSyncRun("openai", triggeredByUserId);

  try {
    const startSeconds = Math.floor(window.from.getTime() / 1000);
    const endSeconds = Math.floor(window.to.getTime() / 1000);

    // Both endpoints paginate with `has_more` / `next_page`; follow the cursor
    // (page-capped) so a busy org is not silently cut off at the first page.
    const [usage, costs, assistants] = await Promise.all([
      getAllUsage({
        start_time: startSeconds,
        end_time: endSeconds,
        group_by: ["model", "project_id", "user_id", "api_key_id"],
        bucket_width: "1d",
      }),
      getAllCosts({
        start_time: startSeconds,
        end_time: endSeconds,
        bucket_width: "1d",
      }).catch(() => null),
      listAssistants({ limit: 100, order: "desc" }).catch(() => null),
    ]);
    const truncated = usage.truncated || (costs?.truncated ?? false);
    const systems = await loadSystemResolver("openai", PROVIDER_MANAGED_SYSTEM_SETTINGS_KEYS.OPENAI);
    // Keys seen per project this window: the costs endpoint groups by project
    // (never by key), so a project's cost inherits a governed system when all
    // of its keys map to the same one.
    const keysByProject = new Map<string, Set<string>>();

    let rawSnapshotsStored = 0;
    for (const [resourceType, payload] of Object.entries({
      usage,
      costs,
      assistants,
    })) {
      if (payload) {
        await storeSnapshot(syncRun.id, "openai", resourceType, payload);
        rawSnapshotsStored++;
      }
    }

    let projectsUpserted = 0;
    let actorsUpserted = 0;
    let usageBucketsUpserted = 0;
    let costBucketsUpserted = 0;
    let apiUsageLogsCreated = 0;

    for (const bucket of asArray(asRecord(usage).data)) {
      const bucketStart = new Date(asNumber(bucket.start_time) * 1000);
      const bucketEnd = new Date(asNumber(bucket.end_time) * 1000 || bucketStart.getTime() + 24 * 60 * 60 * 1000);

      for (const result of asArray(bucket.results)) {
        const model = asString(result.model);
        const projectExternalId = asString(result.project_id);
        const projectName = asString(result.project_name);
        const actorExternalId = asString(result.user_id);
        const actorName = asString(result.user_name);
        const apiKeyExternalId = asString(result.api_key_id);
        const apiKeyName = asString(result.api_key_name);
        const inputTokens = asNumber(result.input_tokens);
        const outputTokens = asNumber(result.output_tokens);
        const totalTokens = asNumber(result.total_tokens) || inputTokens + outputTokens;
        // OpenAI reports prompt-cache hits as `input_cached_tokens`. Unlike
        // Anthropic's cache_read_input_tokens, this is a SUBSET of
        // `input_tokens` (already counted in totalTokens), so it is recorded
        // for visibility and is not added to the total.
        const cacheReadTokens = asNumber(result.input_cached_tokens);
        // The completions usage API's request counter is `num_model_requests`;
        // keep the legacy aliases as fallbacks.
        const requestCount =
          asNumber(result.num_model_requests || result.num_requests || result.request_count) || null;
        const dimensionKey = makeDimensionKey({
          model,
          projectExternalId,
          actorExternalId,
          apiKeyExternalId,
          date: bucketStart.toISOString(),
        });
        const aiSystemId = systems.forKey(apiKeyExternalId);
        if (projectExternalId && apiKeyExternalId) {
          const set = keysByProject.get(projectExternalId) ?? new Set<string>();
          set.add(apiKeyExternalId);
          keysByProject.set(projectExternalId, set);
        }

        await prisma.usageBucket.upsert({
          where: {
            provider_bucketStart_bucketEnd_granularity_dimensionKey: {
              provider: "openai",
              bucketStart,
              bucketEnd,
              granularity: "day",
              dimensionKey,
            },
          },
          update: {
            model,
            projectExternalId,
            projectName,
            actorExternalId,
            actorName,
            apiKeyExternalId,
            apiKeyName,
            inputTokens,
            outputTokens,
            totalTokens,
            cacheReadTokens,
            requestCount,
            metadata: toJsonValue({ ...result, cachedTokensIncludedInInput: true }),
            syncRunId: syncRun.id,
            aiSystemId,
          },
          create: {
            provider: "openai",
            bucketStart,
            bucketEnd,
            granularity: "day",
            dimensionKey,
            model,
            projectExternalId,
            projectName,
            actorExternalId,
            actorName,
            apiKeyExternalId,
            apiKeyName,
            inputTokens,
            outputTokens,
            totalTokens,
            cacheReadTokens,
            requestCount,
            metadata: toJsonValue({ ...result, cachedTokensIncludedInInput: true }),
            syncRunId: syncRun.id,
            aiSystemId,
          },
        });
        usageBucketsUpserted++;

        if (projectExternalId) {
          await prisma.providerProject.upsert({
            where: { provider_externalId: { provider: "openai", externalId: projectExternalId } },
            update: {
              name: projectName,
              status: "active",
              metadata: toJsonValue({ projectExternalId, projectName }),
              lastSeenAt: new Date(),
              syncRunId: syncRun.id,
            },
            create: {
              provider: "openai",
              externalId: projectExternalId,
              name: projectName,
              status: "active",
              metadata: toJsonValue({ projectExternalId, projectName }),
              syncRunId: syncRun.id,
            },
          });
          projectsUpserted++;
        }

        if (actorExternalId) {
          await prisma.providerActor.upsert({
            where: { provider_externalId: { provider: "openai", externalId: actorExternalId } },
            update: {
              name: actorName,
              metadata: toJsonValue({ actorExternalId, actorName }),
              lastSeenAt: new Date(),
              syncRunId: syncRun.id,
            },
            create: {
              provider: "openai",
              externalId: actorExternalId,
              name: actorName,
              metadata: toJsonValue({ actorExternalId, actorName }),
              syncRunId: syncRun.id,
            },
          });
          actorsUpserted++;
        }

        const created = await upsertDerivedUsageLog({
          provider: "chatgpt",
          model,
          bucketDate: bucketStart,
          inputTokens,
          outputTokens,
          totalTokens,
          cost: 0,
          metadata: {
            source: "openai_admin_api",
            syncRunId: syncRun.id,
            dimensionKey,
            provider: "openai",
            cacheReadTokens,
          },
        });
        if (created) apiUsageLogsCreated++;
      }
    }

    for (const bucket of asArray(asRecord(costs).data)) {
      const bucketStart = new Date(asNumber(bucket.start_time) * 1000);
      const bucketEnd = new Date(asNumber(bucket.end_time) * 1000 || bucketStart.getTime() + 24 * 60 * 60 * 1000);

      for (const result of asArray(bucket.results)) {
        const amountInfo = asRecord(result.amount);
        const amount = asNumber(amountInfo.value) / 100;
        const currency = asString(amountInfo.currency) ?? "usd";
        const projectExternalId = asString(result.project_id);
        const projectName = asString(result.project_name);
        const lineItem = asString(result.line_item);
        const dimensionKey = makeDimensionKey({
          projectExternalId,
          lineItem,
          date: bucketStart.toISOString(),
        });
        const aiSystemId = projectExternalId
          ? systems.forKeys(keysByProject.get(projectExternalId) ?? [])
          : systems.defaultSystemId;

        await prisma.costBucket.upsert({
          where: {
            provider_bucketStart_bucketEnd_granularity_dimensionKey: {
              provider: "openai",
              bucketStart,
              bucketEnd,
              granularity: "day",
              dimensionKey,
            },
          },
          update: {
            amount,
            currency,
            projectExternalId,
            projectName,
            lineItem,
            metadata: toJsonValue(result),
            syncRunId: syncRun.id,
            aiSystemId,
          },
          create: {
            provider: "openai",
            bucketStart,
            bucketEnd,
            granularity: "day",
            dimensionKey,
            amount,
            currency,
            projectExternalId,
            projectName,
            lineItem,
            metadata: toJsonValue(result),
            syncRunId: syncRun.id,
            aiSystemId,
          },
        });
        costBucketsUpserted++;
      }
    }

    const summary = {
      usageBucketsUpserted,
      costBucketsUpserted,
      rawSnapshotsStored,
      projectsUpserted,
      actorsUpserted,
      apiUsageLogsCreated,
    };

    await finishSyncRun({
      syncRunId: syncRun.id,
      provider: "openai",
      window,
      summary,
      pagination: {
        pageCap: OPENAI_DEFAULT_MAX_PAGES,
        usagePages: usage.pages,
        usageTruncated: usage.truncated,
        costsPages: costs?.pages ?? 0,
        costsTruncated: costs?.truncated ?? false,
        truncated,
      },
      metadata: {
        assistantsCount: asArray(asRecord(assistants).data).length,
      },
    });

    return { provider: "openai", success: true, syncRunId: syncRun.id, window, truncated, ...summary };
  } catch (error) {
    const errorMessage = await failSyncRun(syncRun.id, error);
    return { provider: "openai", success: false, error: errorMessage };
  }
}

export async function syncOpenRouterTelemetry(triggeredByUserId: string, window: SyncWindow): Promise<SyncResult> {
  if (!(await isOpenRouterConfigured())) {
    return {
      provider: "openrouter",
      success: false,
      skipped: true,
      error: "OpenRouter provisioning key is not configured",
    };
  }

  const syncRun = await createSyncRun("openrouter", triggeredByUserId);

  try {
    // /activity returns per-day rows for roughly the last 30 days and has no
    // range parameters, so the window is applied client-side.
    const activity = await getOpenRouterActivity();
    const allRows = normalizeOpenRouterActivityRows(activity);
    const fromDay = window.from.toISOString().slice(0, 10);
    const toDay = window.to.toISOString().slice(0, 10);
    const rows = allRows.filter((row) => row.date >= fromDay && row.date <= toDay);

    await storeSnapshot(syncRun.id, "openrouter", "activity_summary", {
      rowCount: rows.length,
      sample: rows.slice(0, 10),
    });

    const rawSnapshotsStored = 1;
    let projectsUpserted = 0;
    let usageBucketsUpserted = 0;
    let costBucketsUpserted = 0;
    let apiUsageLogsCreated = 0;

    for (const row of rows) {
      const bucketStart = new Date(`${row.date}T00:00:00.000Z`);
      const bucketEnd = new Date(bucketStart.getTime() + 24 * 60 * 60 * 1000);
      const model = row.modelPermaslug ?? row.model;
      const outputTokens = row.completionTokens + row.reasoningTokens;
      const totalTokens = row.promptTokens + outputTokens;
      const dimensionKey = makeDimensionKey({
        date: row.date,
        model,
        endpointId: row.endpointId,
        upstreamProvider: row.providerName,
      });

      if (row.endpointId) {
        await prisma.providerProject.upsert({
          where: {
            provider_externalId: { provider: "openrouter", externalId: row.endpointId },
          },
          update: {
            name: model,
            status: row.providerName,
            metadata: toJsonValue({
              endpointId: row.endpointId,
              providerName: row.providerName,
            }),
            lastSeenAt: new Date(),
            syncRunId: syncRun.id,
          },
          create: {
            provider: "openrouter",
            externalId: row.endpointId,
            name: model,
            status: row.providerName,
            metadata: toJsonValue({
              endpointId: row.endpointId,
              providerName: row.providerName,
            }),
            syncRunId: syncRun.id,
          },
        });
        projectsUpserted++;
      }

      await prisma.usageBucket.upsert({
        where: {
          provider_bucketStart_bucketEnd_granularity_dimensionKey: {
            provider: "openrouter",
            bucketStart,
            bucketEnd,
            granularity: "day",
            dimensionKey,
          },
        },
        update: {
          model,
          projectExternalId: row.endpointId,
          projectName: model,
          inputTokens: row.promptTokens,
          outputTokens,
          totalTokens,
          requestCount: row.requests,
          metadata: toJsonValue({
            source: "openrouter_activity_api",
            provider_name: row.providerName,
            byok_usage_inference: row.byokUsageInference,
            reasoning_tokens: row.reasoningTokens,
          }),
          syncRunId: syncRun.id,
        },
        create: {
          provider: "openrouter",
          bucketStart,
          bucketEnd,
          granularity: "day",
          dimensionKey,
          model,
          projectExternalId: row.endpointId,
          projectName: model,
          inputTokens: row.promptTokens,
          outputTokens,
          totalTokens,
          requestCount: row.requests,
          metadata: toJsonValue({
            source: "openrouter_activity_api",
            provider_name: row.providerName,
            byok_usage_inference: row.byokUsageInference,
            reasoning_tokens: row.reasoningTokens,
          }),
          syncRunId: syncRun.id,
        },
      });
      usageBucketsUpserted++;

      if (row.usage > 0) {
        await prisma.costBucket.upsert({
          where: {
            provider_bucketStart_bucketEnd_granularity_dimensionKey: {
              provider: "openrouter",
              bucketStart,
              bucketEnd,
              granularity: "day",
              dimensionKey,
            },
          },
          update: {
            amount: row.usage,
            currency: "usd",
            model,
            projectExternalId: row.endpointId,
            projectName: model,
            lineItem: "proxy",
            metadata: toJsonValue({
              source: "openrouter_activity_api",
              provider_name: row.providerName,
            }),
            syncRunId: syncRun.id,
          },
          create: {
            provider: "openrouter",
            bucketStart,
            bucketEnd,
            granularity: "day",
            dimensionKey,
            amount: row.usage,
            currency: "usd",
            model,
            projectExternalId: row.endpointId,
            projectName: model,
            lineItem: "proxy",
            metadata: toJsonValue({
              source: "openrouter_activity_api",
              provider_name: row.providerName,
            }),
            syncRunId: syncRun.id,
          },
        });
        costBucketsUpserted++;
      }

      const created = await upsertDerivedUsageLog({
        provider: "openrouter",
        model,
        bucketDate: bucketStart,
        inputTokens: row.promptTokens,
        outputTokens,
        totalTokens,
        cost: row.usage,
        metadata: {
          source: "openrouter_activity_api",
          syncRunId: syncRun.id,
          dimensionKey,
          provider: "openrouter",
        },
      });
      if (created) apiUsageLogsCreated++;
    }

    const summary = {
      usageBucketsUpserted,
      costBucketsUpserted,
      rawSnapshotsStored,
      projectsUpserted,
      actorsUpserted: 0,
      apiUsageLogsCreated,
    };

    const truncated = await finishSyncRun({
      syncRunId: syncRun.id,
      provider: "openrouter",
      window,
      summary,
      // /activity is a single unpaginated response.
      pagination: { pages: 1, truncated: false },
      metadata: {
        coverage: {
          rows: rows.length,
          rowsOutsideWindow: allRows.length - rows.length,
        },
      },
    });

    return { provider: "openrouter", success: true, syncRunId: syncRun.id, window, truncated, ...summary };
  } catch (error) {
    const errorMessage = await failSyncRun(syncRun.id, error);
    return { provider: "openrouter", success: false, error: errorMessage };
  }
}

export type PortkeyPlannedUsageBucket = {
  partition: "model" | "actor";
  dimensionKey: string;
  model: string | null;
  actorExternalId: string | null;
  actorName: string | null;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  requestCount: number | null;
  costUsd: number;
  metadata: Record<string, unknown>;
};

export type PortkeyPlannedCostBucket = {
  dimensionKey: string;
  model: string;
  amount: number;
  metadata: Record<string, unknown>;
};

export type PortkeyPlannedActor = {
  externalId: string;
  name: string;
  email: string | null;
  metadata: Record<string, unknown>;
};

export type PortkeyDayPlan = {
  date: string;
  usageBuckets: PortkeyPlannedUsageBucket[];
  costBuckets: PortkeyPlannedCostBucket[];
  actors: PortkeyPlannedActor[];
  totals: {
    modelTokens: number;
    modelRequests: number;
    modelCostUsd: number;
    actorTokens: number;
    actorRequests: number;
    actorCostUsd: number;
  };
};

/**
 * Pure planner for one UTC day of Portkey analytics. Portkey's grouped
 * endpoints partition the SAME traffic two different ways (by model and by
 * user), so the two partitions must not both be summed into provider totals:
 *
 * - `partition=model` rows (dimensionKey `date=<YYYY-MM-DD>|model=<model>`) are
 *   the canonical partition. They carry tokens, requests and a matching
 *   `CostBucket` with the same dimensionKey so the oversight cost lookup
 *   attaches spend to the model bucket.
 * - `partition=actor` rows (dimensionKey
 *   `actorExternalId=<user>|date=<YYYY-MM-DD>|partition=actor`) exist for
 *   per-person reporting. They carry the same tokens/requests re-cut by user
 *   and keep the user's cost in `metadata.costCents` / `metadata.costUsd`
 *   (the Cursor pattern) instead of a second CostBucket, so cost totals are
 *   never double counted. Token-total consumers should exclude
 *   `dimensionKey LIKE '%partition=actor%'` for provider="portkey".
 *
 * Portkey does not always return a prompt/completion split for grouped rows.
 * `UsageBucket.inputTokens`/`outputTokens` are NOT NULL columns, so when the
 * split is missing they are written as 0 with `metadata.tokenSplitAvailable =
 * false` rather than fabricating a split from the total.
 */
export function planPortkeyDayBuckets(args: {
  date: string;
  modelRows: PortkeyGroupedRow[];
  userRows: PortkeyGroupedRow[];
}): PortkeyDayPlan {
  const { date } = args;
  const usageBuckets: PortkeyPlannedUsageBucket[] = [];
  const costBuckets: PortkeyPlannedCostBucket[] = [];
  const actors: PortkeyPlannedActor[] = [];
  const totals = {
    modelTokens: 0,
    modelRequests: 0,
    modelCostUsd: 0,
    actorTokens: 0,
    actorRequests: 0,
    actorCostUsd: 0,
  };

  // Merge duplicate labels defensively (a label should only appear once per
  // window, but paginated responses have no ordering guarantee).
  function mergeRows(rows: PortkeyGroupedRow[]): PortkeyGroupedRow[] {
    const merged = new Map<string, PortkeyGroupedRow>();
    for (const row of rows) {
      if (!row.label) continue;
      const existing = merged.get(row.label);
      if (!existing) {
        merged.set(row.label, { ...row });
        continue;
      }
      existing.requests += row.requests;
      existing.cost += row.cost;
      existing.totalTokens += row.totalTokens;
      existing.promptTokens += row.promptTokens;
      existing.completionTokens += row.completionTokens;
      existing.hasTokenSplit = existing.hasTokenSplit && row.hasTokenSplit;
      if (row.lastSeenAt && (!existing.lastSeenAt || row.lastSeenAt > existing.lastSeenAt)) {
        existing.lastSeenAt = row.lastSeenAt;
      }
    }
    return [...merged.values()];
  }

  for (const row of mergeRows(args.modelRows)) {
    const model = row.label as string;
    const costUsd = portkeyCostToUsd(row.cost);
    const dimensionKey = makeDimensionKey({ date, model });
    const inputTokens = row.hasTokenSplit ? row.promptTokens : 0;
    const outputTokens = row.hasTokenSplit ? row.completionTokens : 0;
    const totalTokens = Math.max(0, Math.round(row.totalTokens));
    const requestCount = row.requests > 0 ? Math.round(row.requests) : null;

    usageBuckets.push({
      partition: "model",
      dimensionKey,
      model,
      actorExternalId: null,
      actorName: null,
      inputTokens,
      outputTokens,
      totalTokens,
      requestCount,
      costUsd,
      metadata: {
        source: "portkey_analytics_api",
        partition: "model",
        tokenSplitAvailable: row.hasTokenSplit,
        costCents: row.cost,
        costUsd,
        lastSeenAt: row.lastSeenAt,
        raw: row.raw,
      },
    });
    if (costUsd > 0) {
      costBuckets.push({
        dimensionKey,
        model,
        amount: costUsd,
        metadata: {
          source: "portkey_analytics_api",
          partition: "model",
          costCents: row.cost,
          requests: row.requests,
        },
      });
    }
    totals.modelTokens += totalTokens;
    totals.modelRequests += requestCount ?? 0;
    totals.modelCostUsd += costUsd;
  }

  for (const row of mergeRows(args.userRows)) {
    const actorExternalId = row.label as string;
    const costUsd = portkeyCostToUsd(row.cost);
    const dimensionKey = makeDimensionKey({ date, actorExternalId, partition: "actor" });
    const inputTokens = row.hasTokenSplit ? row.promptTokens : 0;
    const outputTokens = row.hasTokenSplit ? row.completionTokens : 0;
    const totalTokens = Math.max(0, Math.round(row.totalTokens));
    const requestCount = row.requests > 0 ? Math.round(row.requests) : null;

    usageBuckets.push({
      partition: "actor",
      dimensionKey,
      model: null,
      actorExternalId,
      actorName: actorExternalId,
      inputTokens,
      outputTokens,
      totalTokens,
      requestCount,
      costUsd,
      metadata: {
        source: "portkey_analytics_api",
        partition: "actor",
        tokenSplitAvailable: row.hasTokenSplit,
        costCents: row.cost,
        costUsd,
        lastSeenAt: row.lastSeenAt,
        raw: row.raw,
      },
    });
    actors.push({
      externalId: actorExternalId,
      name: actorExternalId,
      email: actorExternalId.includes("@") ? actorExternalId : null,
      metadata: {
        source: "portkey_analytics_api",
        lastSeenAt: row.lastSeenAt,
      },
    });
    totals.actorTokens += totalTokens;
    totals.actorRequests += requestCount ?? 0;
    totals.actorCostUsd += costUsd;
  }

  return { date, usageBuckets, costBuckets, actors, totals };
}

export async function syncPortkeyTelemetry(triggeredByUserId: string, window: SyncWindow): Promise<SyncResult> {
  if (!(await isPortkeyConfigured())) {
    return {
      provider: "portkey",
      success: false,
      skipped: true,
      error: "Portkey API key is not configured",
    };
  }

  const syncRun = await createSyncRun("portkey", triggeredByUserId);

  try {
    const start = window.from;
    const end = window.to;
    // One grouped call per UTC day keeps Portkey buckets at day granularity
    // (Portkey's grouped endpoints otherwise aggregate the whole window).
    const windows = buildPortkeyDayWindows(start, end);
    const startTime = windows[0]?.bucketStart.toISOString() ?? start.toISOString();
    const endTime = end.toISOString();
    const pageSize = PORTKEY_DEFAULT_PAGE_SIZE;
    const maxPages = PORTKEY_DEFAULT_MAX_PAGES;

    // Org-level graphs are fetched once for the whole window. They are no
    // longer written as `scope=all` buckets (that would double count the
    // per-model partition); they are stored as snapshots and used to
    // reconcile the grouped totals in the sync-run metadata.
    const [tokenPoints, costPoints] = await Promise.all([
      getPortkeyTokensGraph({ startTime, endTime }).then(normalizePortkeyGraphPoints),
      getPortkeyCostGraph({ startTime, endTime }).then(normalizePortkeyGraphPoints),
    ]);

    // Portkey models are no longer written as ProviderProject rows; the
    // per-model partition lives in UsageBucket/CostBucket instead.
    const projectsUpserted = 0;
    let actorsUpserted = 0;
    let usageBucketsUpserted = 0;
    let costBucketsUpserted = 0;
    let apiUsageLogsCreated = 0;

    const pagination = {
      pageSize,
      pageCap: maxPages,
      modelPages: 0,
      userPages: 0,
      truncated: false,
      truncatedWindows: [] as { date: string; endpoint: string }[],
    };
    const coverage = { modelRows: 0, userRows: 0, tokenPoints: tokenPoints.length, costPoints: costPoints.length };
    const grouped = {
      modelTokens: 0,
      modelRequests: 0,
      modelCostUsd: 0,
      actorTokens: 0,
      actorRequests: 0,
      actorCostUsd: 0,
    };
    const modelSamples: PortkeyGroupedRow[] = [];
    const userSamples: PortkeyGroupedRow[] = [];
    const seenActors = new Set<string>();

    for (const window of windows) {
      const [modelPage, userPage] = await Promise.all([
        readPortkeyGroupedPages(getPortkeyModelGroups, {
          startTime: window.startTime,
          endTime: window.endTime,
          labelKeys: ["ai_model", "model"],
          pageSize,
          maxPages,
        }),
        readPortkeyGroupedPages(getPortkeyUserGroups, {
          startTime: window.startTime,
          endTime: window.endTime,
          labelKeys: ["user", "metadata_value"],
          pageSize,
          maxPages,
        }),
      ]);

      pagination.modelPages += modelPage.pages;
      pagination.userPages += userPage.pages;
      if (modelPage.truncated) {
        pagination.truncated = true;
        pagination.truncatedWindows.push({ date: window.date, endpoint: "ai-models" });
      }
      if (userPage.truncated) {
        pagination.truncated = true;
        pagination.truncatedWindows.push({ date: window.date, endpoint: "users" });
      }
      coverage.modelRows += modelPage.rows.length;
      coverage.userRows += userPage.rows.length;
      if (modelSamples.length < 10) modelSamples.push(...modelPage.rows.slice(0, 10 - modelSamples.length));
      if (userSamples.length < 10) userSamples.push(...userPage.rows.slice(0, 10 - userSamples.length));

      const plan = planPortkeyDayBuckets({
        date: window.date,
        modelRows: modelPage.rows,
        userRows: userPage.rows,
      });
      grouped.modelTokens += plan.totals.modelTokens;
      grouped.modelRequests += plan.totals.modelRequests;
      grouped.modelCostUsd += plan.totals.modelCostUsd;
      grouped.actorTokens += plan.totals.actorTokens;
      grouped.actorRequests += plan.totals.actorRequests;
      grouped.actorCostUsd += plan.totals.actorCostUsd;

      for (const bucket of plan.usageBuckets) {
        const data = {
          model: bucket.model,
          actorExternalId: bucket.actorExternalId,
          actorName: bucket.actorName,
          inputTokens: bucket.inputTokens,
          outputTokens: bucket.outputTokens,
          totalTokens: bucket.totalTokens,
          requestCount: bucket.requestCount,
          metadata: toJsonValue(bucket.metadata),
          syncRunId: syncRun.id,
        };
        await prisma.usageBucket.upsert({
          where: {
            provider_bucketStart_bucketEnd_granularity_dimensionKey: {
              provider: "portkey",
              bucketStart: window.bucketStart,
              bucketEnd: window.bucketEnd,
              granularity: "day",
              dimensionKey: bucket.dimensionKey,
            },
          },
          update: data,
          create: {
            provider: "portkey",
            bucketStart: window.bucketStart,
            bucketEnd: window.bucketEnd,
            granularity: "day",
            dimensionKey: bucket.dimensionKey,
            ...data,
          },
        });
        usageBucketsUpserted++;

        // Derived APIUsageLog rows come from the canonical model partition
        // only, so they always carry a real model and never double count.
        if (bucket.partition === "model" && bucket.model) {
          const created = await upsertDerivedUsageLog({
            provider: "portkey",
            model: bucket.model,
            bucketDate: window.bucketStart,
            inputTokens: bucket.inputTokens,
            outputTokens: bucket.outputTokens,
            totalTokens: bucket.totalTokens,
            cost: bucket.costUsd,
            metadata: {
              source: "portkey_analytics_api",
              syncRunId: syncRun.id,
              dimensionKey: bucket.dimensionKey,
              provider: "portkey",
              tokenSplitAvailable: bucket.metadata.tokenSplitAvailable,
            },
          });
          if (created) apiUsageLogsCreated++;
        }
      }

      for (const cost of plan.costBuckets) {
        const data = {
          amount: cost.amount,
          currency: "usd",
          model: cost.model,
          lineItem: "proxy",
          metadata: toJsonValue(cost.metadata),
          syncRunId: syncRun.id,
        };
        await prisma.costBucket.upsert({
          where: {
            provider_bucketStart_bucketEnd_granularity_dimensionKey: {
              provider: "portkey",
              bucketStart: window.bucketStart,
              bucketEnd: window.bucketEnd,
              granularity: "day",
              dimensionKey: cost.dimensionKey,
            },
          },
          update: data,
          create: {
            provider: "portkey",
            bucketStart: window.bucketStart,
            bucketEnd: window.bucketEnd,
            granularity: "day",
            dimensionKey: cost.dimensionKey,
            ...data,
          },
        });
        costBucketsUpserted++;
      }

      for (const actor of plan.actors) {
        if (seenActors.has(actor.externalId)) continue;
        seenActors.add(actor.externalId);
        await prisma.providerActor.upsert({
          where: {
            provider_externalId: { provider: "portkey", externalId: actor.externalId },
          },
          update: {
            email: actor.email,
            name: actor.name,
            metadata: toJsonValue(actor.metadata),
            lastSeenAt: new Date(),
            syncRunId: syncRun.id,
          },
          create: {
            provider: "portkey",
            externalId: actor.externalId,
            email: actor.email,
            name: actor.name,
            metadata: toJsonValue(actor.metadata),
            syncRunId: syncRun.id,
          },
        });
        actorsUpserted++;
      }
    }

    await storeSnapshot(syncRun.id, "portkey", "model_groups", {
      rowCount: coverage.modelRows,
      days: windows.length,
      sample: modelSamples,
    });
    await storeSnapshot(syncRun.id, "portkey", "user_groups", {
      rowCount: coverage.userRows,
      days: windows.length,
      sample: userSamples,
    });
    await storeSnapshot(syncRun.id, "portkey", "token_graph", {
      points: tokenPoints.slice(0, 31),
    });
    await storeSnapshot(syncRun.id, "portkey", "cost_graph", {
      points: costPoints.slice(0, 31),
    });
    const rawSnapshotsStored = 4;

    const summary = {
      usageBucketsUpserted,
      costBucketsUpserted,
      rawSnapshotsStored,
      projectsUpserted,
      actorsUpserted,
      apiUsageLogsCreated,
    };

    const graphTotalTokens = tokenPoints.reduce((sum, point) => sum + point.total, 0);
    const graphCostUsd = portkeyCostToUsd(costPoints.reduce((sum, point) => sum + point.total, 0));

    const truncated = await finishSyncRun({
      syncRunId: syncRun.id,
      provider: "portkey",
      window,
      summary,
      pagination: { ...pagination, pages: pagination.modelPages + pagination.userPages },
      metadata: {
      dayWindows: { start: startTime, end: endTime, days: windows.length },
      coverage,
      // Grouped totals should match the org-level graphs. A persistent
      // 100x gap in cost means the grouped `cost` unit assumption is wrong.
      reconciliation: {
        graphTotalTokens,
        graphCostUsd,
        modelTotalTokens: grouped.modelTokens,
        modelRequests: grouped.modelRequests,
        modelCostUsd: grouped.modelCostUsd,
        actorTotalTokens: grouped.actorTokens,
        actorRequests: grouped.actorRequests,
        actorCostUsd: grouped.actorCostUsd,
      },
      costUnit: { assumed: "cents", divisor: PORTKEY_COST_DIVISOR },
      bucketShape: {
        model: "date=<YYYY-MM-DD>|model=<model>",
        actor: "actorExternalId=<user>|date=<YYYY-MM-DD>|partition=actor",
      },
      },
    });

    return { provider: "portkey", success: true, syncRunId: syncRun.id, window, truncated, ...summary };
  } catch (error) {
    const errorMessage = await failSyncRun(syncRun.id, error);
    return { provider: "portkey", success: false, error: errorMessage };
  }
}

export async function syncHeliconeTelemetry(triggeredByUserId: string, window: SyncWindow): Promise<SyncResult> {
  if (!(await isHeliconeConfigured())) {
    return {
      provider: "helicone",
      success: false,
      skipped: true,
      error: "Helicone API key is not configured",
    };
  }

  const syncRun = await createSyncRun("helicone", triggeredByUserId);

  try {
    const paged = await readHeliconeRequestPages(queryHeliconeRequests, {
      startTime: window.from.toISOString(),
      endTime: window.to.toISOString(),
      pageSize: HELICONE_DEFAULT_PAGE_SIZE,
      maxPages: HELICONE_DEFAULT_MAX_PAGES,
    });
    const allRows = paged.rows;
    const pagination: PaginationReport = {
      pageSize: HELICONE_DEFAULT_PAGE_SIZE,
      pageCap: HELICONE_DEFAULT_MAX_PAGES,
      pages: paged.pages,
      truncated: paged.truncated,
    };

    await storeSnapshot(syncRun.id, "helicone", "request_summary", {
      rowCount: allRows.length,
      sample: allRows.slice(0, 10),
    });

    const rawSnapshotsStored = 1;
    let actorsUpserted = 0;
    let usageBucketsUpserted = 0;
    let costBucketsUpserted = 0;
    let apiUsageLogsCreated = 0;
    const seenActors = new Set<string>();

    const aggregates = new Map<
      string,
      {
        date: string;
        model: string | null;
        upstreamProvider: string | null;
        actorId: string | null;
        promptTokens: number;
        completionTokens: number;
        totalTokens: number;
        requestCount: number;
        cost: number;
      }
    >();

    for (const row of allRows) {
      const date = row.requestCreatedAt.split("T")[0] ?? "";
      if (!date) continue;
      const key = makeDimensionKey({
        date,
        model: row.model,
        upstreamProvider: row.provider,
        actor: row.userId,
      });

      if (row.userId && !seenActors.has(row.userId)) {
        seenActors.add(row.userId);
        await prisma.providerActor.upsert({
          where: {
            provider_externalId: { provider: "helicone", externalId: row.userId },
          },
          update: {
            email: row.userId.includes("@") ? row.userId : null,
            name: row.userId,
            metadata: toJsonValue({ source: "helicone_request_api" }),
            lastSeenAt: new Date(),
            syncRunId: syncRun.id,
          },
          create: {
            provider: "helicone",
            externalId: row.userId,
            email: row.userId.includes("@") ? row.userId : null,
            name: row.userId,
            metadata: toJsonValue({ source: "helicone_request_api" }),
            syncRunId: syncRun.id,
          },
        });
        actorsUpserted++;
      }

      const existing = aggregates.get(key);
      if (existing) {
        existing.promptTokens += row.promptTokens;
        existing.completionTokens += row.completionTokens;
        existing.totalTokens += row.totalTokens;
        existing.requestCount += 1;
        existing.cost += row.cost;
      } else {
        aggregates.set(key, {
          date,
          model: row.model,
          upstreamProvider: row.provider,
          actorId: row.userId,
          promptTokens: row.promptTokens,
          completionTokens: row.completionTokens,
          totalTokens: row.totalTokens,
          requestCount: 1,
          cost: row.cost,
        });
      }
    }

    for (const aggregate of aggregates.values()) {
      const bucketStart = new Date(`${aggregate.date}T00:00:00.000Z`);
      const bucketEnd = new Date(bucketStart.getTime() + 24 * 60 * 60 * 1000);
      const dimensionKey = makeDimensionKey({
        date: aggregate.date,
        model: aggregate.model,
        upstreamProvider: aggregate.upstreamProvider,
        actor: aggregate.actorId,
      });

      await prisma.usageBucket.upsert({
        where: {
          provider_bucketStart_bucketEnd_granularity_dimensionKey: {
            provider: "helicone",
            bucketStart,
            bucketEnd,
            granularity: "day",
            dimensionKey,
          },
        },
        update: {
          model: aggregate.model,
          actorExternalId: aggregate.actorId,
          actorName: aggregate.actorId,
          inputTokens: aggregate.promptTokens,
          outputTokens: aggregate.completionTokens,
          totalTokens: aggregate.totalTokens,
          requestCount: aggregate.requestCount,
          metadata: toJsonValue({
            source: "helicone_request_api",
            upstream_provider: aggregate.upstreamProvider,
          }),
          syncRunId: syncRun.id,
        },
        create: {
          provider: "helicone",
          bucketStart,
          bucketEnd,
          granularity: "day",
          dimensionKey,
          model: aggregate.model,
          actorExternalId: aggregate.actorId,
          actorName: aggregate.actorId,
          inputTokens: aggregate.promptTokens,
          outputTokens: aggregate.completionTokens,
          totalTokens: aggregate.totalTokens,
          requestCount: aggregate.requestCount,
          metadata: toJsonValue({
            source: "helicone_request_api",
            upstream_provider: aggregate.upstreamProvider,
          }),
          syncRunId: syncRun.id,
        },
      });
      usageBucketsUpserted++;

      if (aggregate.cost > 0) {
        await prisma.costBucket.upsert({
          where: {
            provider_bucketStart_bucketEnd_granularity_dimensionKey: {
              provider: "helicone",
              bucketStart,
              bucketEnd,
              granularity: "day",
              dimensionKey,
            },
          },
          update: {
            amount: aggregate.cost,
            currency: "usd",
            model: aggregate.model,
            actorName: aggregate.actorId,
            lineItem: "proxy",
            metadata: toJsonValue({
              source: "helicone_request_api",
              upstream_provider: aggregate.upstreamProvider,
            }),
            syncRunId: syncRun.id,
          },
          create: {
            provider: "helicone",
            bucketStart,
            bucketEnd,
            granularity: "day",
            dimensionKey,
            amount: aggregate.cost,
            currency: "usd",
            model: aggregate.model,
            actorName: aggregate.actorId,
            lineItem: "proxy",
            metadata: toJsonValue({
              source: "helicone_request_api",
              upstream_provider: aggregate.upstreamProvider,
            }),
            syncRunId: syncRun.id,
          },
        });
        costBucketsUpserted++;
      }

      const created = await upsertDerivedUsageLog({
        provider: "helicone",
        model: aggregate.model,
        bucketDate: bucketStart,
        inputTokens: aggregate.promptTokens,
        outputTokens: aggregate.completionTokens,
        totalTokens: aggregate.totalTokens,
        cost: aggregate.cost,
        metadata: {
          source: "helicone_request_api",
          syncRunId: syncRun.id,
          dimensionKey,
          provider: "helicone",
        },
      });
      if (created) apiUsageLogsCreated++;
    }

    const summary = {
      usageBucketsUpserted,
      costBucketsUpserted,
      rawSnapshotsStored,
      projectsUpserted: 0,
      actorsUpserted,
      apiUsageLogsCreated,
    };

    const truncated = await finishSyncRun({
      syncRunId: syncRun.id,
      provider: "helicone",
      window,
      summary,
      pagination,
      metadata: {
        coverage: {
          rows: allRows.length,
          uniqueActors: seenActors.size,
        },
      },
    });

    return { provider: "helicone", success: true, syncRunId: syncRun.id, window, truncated, ...summary };
  } catch (error) {
    const errorMessage = await failSyncRun(syncRun.id, error);
    return { provider: "helicone", success: false, error: errorMessage };
  }
}

export async function syncLiteLLMTelemetry(triggeredByUserId: string, window: SyncWindow): Promise<SyncResult> {
  if (!(await isLiteLLMConfigured())) {
    return {
      provider: "litellm",
      success: false,
      skipped: true,
      error: "LiteLLM master key and base URL are not configured",
    };
  }

  const syncRun = await createSyncRun("litellm", triggeredByUserId);

  try {
    const payload = await queryLiteLLMSpendLogs({
      startDate: window.from.toISOString().slice(0, 10),
      endDate: window.to.toISOString().slice(0, 10),
    });
    const rows = normalizeLiteLLMSpendRows(payload);
    const systems = await loadSystemResolver("litellm", PROVIDER_MANAGED_SYSTEM_SETTINGS_KEYS.LITELLM);

    await storeSnapshot(syncRun.id, "litellm", "spend_logs", {
      rowCount: rows.length,
      sample: rows.slice(0, 10),
    });

    const rawSnapshotsStored = 1;
    let actorsUpserted = 0;
    let projectsUpserted = 0;
    let usageBucketsUpserted = 0;
    let costBucketsUpserted = 0;
    let apiUsageLogsCreated = 0;
    const seenActors = new Set<string>();
    const seenTeams = new Set<string>();

    const aggregates = new Map<
      string,
      {
        date: string;
        model: string | null;
        upstreamProvider: string | null;
        actorId: string | null;
        actorName: string | null;
        teamId: string | null;
        teamName: string | null;
        apiKeyExternalId: string | null;
        apiKeyName: string | null;
        promptTokens: number;
        completionTokens: number;
        totalTokens: number;
        requestCount: number;
        cost: number;
      }
    >();

    for (const row of rows) {
      const date = row.startTime.split("T")[0] ?? "";
      if (!date) continue;
      const dimensionKey = makeDimensionKey({
        date,
        model: row.model,
        upstreamProvider: row.provider,
        actor: row.userId,
        team: row.teamId,
        apiKey: row.apiKeyExternalId,
      });

      if (row.userId && !seenActors.has(row.userId)) {
        seenActors.add(row.userId);
        await prisma.providerActor.upsert({
          where: {
            provider_externalId: { provider: "litellm", externalId: row.userId },
          },
          update: {
            email: row.userId.includes("@") ? row.userId : null,
            name: row.userId,
            metadata: toJsonValue({ source: "litellm_spend_logs" }),
            lastSeenAt: new Date(),
            syncRunId: syncRun.id,
          },
          create: {
            provider: "litellm",
            externalId: row.userId,
            email: row.userId.includes("@") ? row.userId : null,
            name: row.userId,
            metadata: toJsonValue({ source: "litellm_spend_logs" }),
            syncRunId: syncRun.id,
          },
        });
        actorsUpserted++;
      }

      if (row.teamId && !seenTeams.has(row.teamId)) {
        seenTeams.add(row.teamId);
        await prisma.providerProject.upsert({
          where: {
            provider_externalId: { provider: "litellm", externalId: row.teamId },
          },
          update: {
            name: row.teamName ?? row.teamId,
            status: "active",
            metadata: toJsonValue({ source: "litellm_spend_logs" }),
            lastSeenAt: new Date(),
            syncRunId: syncRun.id,
          },
          create: {
            provider: "litellm",
            externalId: row.teamId,
            name: row.teamName ?? row.teamId,
            status: "active",
            metadata: toJsonValue({ source: "litellm_spend_logs" }),
            syncRunId: syncRun.id,
          },
        });
        projectsUpserted++;
      }

      const existing = aggregates.get(dimensionKey);
      if (existing) {
        existing.promptTokens += row.promptTokens;
        existing.completionTokens += row.completionTokens;
        existing.totalTokens += row.totalTokens;
        existing.requestCount += 1;
        existing.cost += row.cost;
      } else {
        aggregates.set(dimensionKey, {
          date,
          model: row.model,
          upstreamProvider: row.provider,
          actorId: row.userId,
          actorName: row.userId,
          teamId: row.teamId,
          teamName: row.teamName,
          apiKeyExternalId: row.apiKeyExternalId,
          apiKeyName: row.apiKeyName,
          promptTokens: row.promptTokens,
          completionTokens: row.completionTokens,
          totalTokens: row.totalTokens,
          requestCount: 1,
          cost: row.cost,
        });
      }
    }

    for (const [dimensionKey, aggregate] of aggregates.entries()) {
      const bucketStart = new Date(`${aggregate.date}T00:00:00.000Z`);
      const bucketEnd = new Date(bucketStart.getTime() + 24 * 60 * 60 * 1000);
      const aiSystemId = systems.forKey(aggregate.apiKeyExternalId);

      await prisma.usageBucket.upsert({
        where: {
          provider_bucketStart_bucketEnd_granularity_dimensionKey: {
            provider: "litellm",
            bucketStart,
            bucketEnd,
            granularity: "day",
            dimensionKey,
          },
        },
        update: {
          model: aggregate.model,
          projectExternalId: aggregate.teamId,
          projectName: aggregate.teamName,
          actorExternalId: aggregate.actorId,
          actorName: aggregate.actorName,
          apiKeyExternalId: aggregate.apiKeyExternalId,
          apiKeyName: aggregate.apiKeyName,
          inputTokens: aggregate.promptTokens,
          outputTokens: aggregate.completionTokens,
          totalTokens: aggregate.totalTokens,
          requestCount: aggregate.requestCount,
          metadata: toJsonValue({
            source: "litellm_spend_logs",
            upstream_provider: aggregate.upstreamProvider,
          }),
          syncRunId: syncRun.id,
          aiSystemId,
        },
        create: {
          provider: "litellm",
          bucketStart,
          bucketEnd,
          granularity: "day",
          dimensionKey,
          model: aggregate.model,
          projectExternalId: aggregate.teamId,
          projectName: aggregate.teamName,
          actorExternalId: aggregate.actorId,
          actorName: aggregate.actorName,
          apiKeyExternalId: aggregate.apiKeyExternalId,
          apiKeyName: aggregate.apiKeyName,
          inputTokens: aggregate.promptTokens,
          outputTokens: aggregate.completionTokens,
          totalTokens: aggregate.totalTokens,
          requestCount: aggregate.requestCount,
          metadata: toJsonValue({
            source: "litellm_spend_logs",
            upstream_provider: aggregate.upstreamProvider,
          }),
          syncRunId: syncRun.id,
          aiSystemId,
        },
      });
      usageBucketsUpserted++;

      if (aggregate.cost > 0) {
        await prisma.costBucket.upsert({
          where: {
            provider_bucketStart_bucketEnd_granularity_dimensionKey: {
              provider: "litellm",
              bucketStart,
              bucketEnd,
              granularity: "day",
              dimensionKey,
            },
          },
          update: {
            amount: aggregate.cost,
            currency: "usd",
            model: aggregate.model,
            projectExternalId: aggregate.teamId,
            projectName: aggregate.teamName,
            actorExternalId: aggregate.actorId,
            actorName: aggregate.actorName,
            apiKeyExternalId: aggregate.apiKeyExternalId,
            apiKeyName: aggregate.apiKeyName,
            lineItem: "proxy",
            metadata: toJsonValue({
              source: "litellm_spend_logs",
              upstream_provider: aggregate.upstreamProvider,
            }),
            syncRunId: syncRun.id,
            aiSystemId,
          },
          create: {
            provider: "litellm",
            bucketStart,
            bucketEnd,
            granularity: "day",
            dimensionKey,
            amount: aggregate.cost,
            currency: "usd",
            model: aggregate.model,
            projectExternalId: aggregate.teamId,
            projectName: aggregate.teamName,
            actorExternalId: aggregate.actorId,
            actorName: aggregate.actorName,
            apiKeyExternalId: aggregate.apiKeyExternalId,
            apiKeyName: aggregate.apiKeyName,
            lineItem: "proxy",
            metadata: toJsonValue({
              source: "litellm_spend_logs",
              upstream_provider: aggregate.upstreamProvider,
            }),
            syncRunId: syncRun.id,
            aiSystemId,
          },
        });
        costBucketsUpserted++;
      }

      const created = await upsertDerivedUsageLog({
        provider: "litellm",
        model: aggregate.model,
        bucketDate: bucketStart,
        inputTokens: aggregate.promptTokens,
        outputTokens: aggregate.completionTokens,
        totalTokens: aggregate.totalTokens,
        cost: aggregate.cost,
        metadata: {
          source: "litellm_spend_logs",
          syncRunId: syncRun.id,
          dimensionKey,
          provider: "litellm",
        },
      });
      if (created) apiUsageLogsCreated++;
    }

    const summary = {
      usageBucketsUpserted,
      costBucketsUpserted,
      rawSnapshotsStored,
      projectsUpserted,
      actorsUpserted,
      apiUsageLogsCreated,
    };

    const truncated = await finishSyncRun({
      syncRunId: syncRun.id,
      provider: "litellm",
      window,
      summary,
      // /spend/logs returns the whole date range in one response.
      pagination: { pages: 1, truncated: false },
      metadata: {
        coverage: {
          rows: rows.length,
          uniqueActors: seenActors.size,
          uniqueTeams: seenTeams.size,
        },
      },
    });

    return { provider: "litellm", success: true, syncRunId: syncRun.id, window, truncated, ...summary };
  } catch (error) {
    const errorMessage = await failSyncRun(syncRun.id, error);
    return { provider: "litellm", success: false, error: errorMessage };
  }
}

// ─── ChatGPT Enterprise (OpenAI Compliance API) ───────────────────────────
//
// Reads a ChatGPT Enterprise / Edu workspace through the OpenAI Programmatic
// Admin Platform: the stateful users and GPTs exports plus the append-only
// Compliance Logs Platform (AUTH_LOG, AUDIT_LOG, CONVERSATION_MESSAGE,
// CODEX_LOG, CODEX_TURN). Each log stream keeps its own `after` cursor in
// ProviderSyncWatermark (`chatgpt_enterprise:<EVENT_TYPE>`); the GPTs stream
// keeps the newest creation time it has seen so "new GPT with actions" can be
// detected; the bare `chatgpt_enterprise` row marks the last successful run.
//
// Metadata boundary: conversation messages and Codex prompts are aggregated
// into per-user daily counts (AssistantDailyStat) and never stored. Only
// auth and admin-audit events land in ComplianceActivity, with provider
// "openai" so the planned Anthropic feed can share the table.

const CHATGPT_ALERT_SOURCE = "chatgpt_compliance_api";
const COMPLIANCE_ACTIVITY_INSERT_CHUNK = 500;

type WatermarkState = { watermark: Date; earliest: Date };

async function loadSyncWatermark(key: string): Promise<WatermarkState | null> {
  const row = await prisma.providerSyncWatermark.findUnique({ where: { provider: key } });
  return row ? { watermark: row.watermark, earliest: row.earliest } : null;
}

async function saveSyncWatermark(key: string, state: WatermarkState) {
  await prisma.providerSyncWatermark.upsert({
    where: { provider: key },
    update: { watermark: state.watermark, earliest: state.earliest },
    create: { provider: key, watermark: state.watermark, earliest: state.earliest },
  });
}

/**
 * Create a governance alert unless an open one with the same title exists.
 * Titles carry the subject (email, GPT id) so they double as the dedupe key.
 */
async function raiseComplianceAlert(input: {
  title: string;
  description: string;
  severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "INFO";
}): Promise<boolean> {
  const existing = await prisma.alert.findFirst({
    where: {
      source: CHATGPT_ALERT_SOURCE,
      title: input.title,
      status: { in: ["OPEN", "ACKNOWLEDGED"] },
    },
    select: { id: true },
  });
  if (existing) return false;

  await prisma.alert.create({
    data: {
      title: input.title,
      description: input.description,
      severity: input.severity,
      source: CHATGPT_ALERT_SOURCE,
    },
  });
  await notifyDatadog({
    title: `[UrNammu] ${input.title}`,
    text: input.description,
    tags: ["source:urnammu", `alert_source:${CHATGPT_ALERT_SOURCE}`, `severity:${input.severity.toLowerCase()}`],
    alertType: input.severity === "CRITICAL" || input.severity === "HIGH" ? "error" : input.severity === "MEDIUM" ? "warning" : "info",
    aggregationKey: `urnammu:${CHATGPT_ALERT_SOURCE}:${input.title}`,
  });
  return true;
}

/**
 * Add a batch of log-derived counts onto the existing row for the same
 * (provider, day, actor). See mergeAssistantDailyStat for why this is not a
 * plain upsert.
 */
async function accumulateAssistantDailyStat(syncRunId: string, values: AssistantDailyStatValues) {
  const existing = await prisma.assistantDailyStat.findUnique({
    where: {
      provider_day_actorExternalId_product: {
        provider: values.provider,
        day: values.day,
        actorExternalId: values.actorExternalId,
        product: values.product,
      },
    },
    select: {
      isActive: true,
      sessions: true,
      requests: true,
      linesAdded: true,
      linesRemoved: true,
      linesAccepted: true,
      commits: true,
      pullRequests: true,
      toolAccepted: true,
      toolRejected: true,
      estimatedCost: true,
      inputTokens: true,
      outputTokens: true,
      cacheReadTokens: true,
      cacheCreationTokens: true,
      metadata: true,
    },
  });
  await upsertAssistantDailyStat(syncRunId, mergeAssistantDailyStat(existing, values));
}

type ChatGPTStreamReport = {
  after: string;
  files: number;
  events: number;
  duplicates: number;
  malformed: number;
  bytes: number;
  truncated: boolean;
  processedThrough: string | null;
  skipped?: string;
};

function isUnauthorized(err: unknown): err is ChatGPTEnterpriseApiError {
  return err instanceof ChatGPTEnterpriseApiError && (err.status === 401 || err.status === 403);
}

function countBy(values: readonly (string | null)[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const v of values) {
    const k = v ?? "unknown";
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}

/**
 * The Compliance API is cursor-based (one watermark per log stream, see
 * chatgptStreamWatermarkKey), so the scheduled `window` is echoed back for
 * the run report rather than used to bound the upstream reads.
 */
export async function syncChatGPTEnterprise(triggeredByUserId: string, window: SyncWindow): Promise<SyncResult> {
  if (!(await isChatGPTEnterpriseConfigured())) {
    return {
      provider: "chatgpt_enterprise",
      success: false,
      skipped: true,
      error: "ChatGPT Enterprise Admin key or workspace id is not configured",
    };
  }

  const syncRun = await createSyncRun("chatgpt_enterprise", triggeredByUserId);

  try {
    const workspaceId = await getChatGPTWorkspaceId();
    const now = new Date();
    let rawSnapshotsStored = 0;
    let actorsUpserted = 0;
    let alertsCreated = 0;
    let complianceActivitiesInserted = 0;
    let assistantDailyStatsUpserted = 0;

    const overallKey = CHATGPT_SYNC_PROVIDER;
    const previousRun = await loadSyncWatermark(overallKey);

    // ── Users → ProviderActor (provider "chatgpt") ──────────────────────
    const { users, truncated: usersTruncated } = await listChatGPTWorkspaceUsers(workspaceId);
    const existingActors = await prisma.providerActor.findMany({
      where: { provider: "chatgpt" },
      select: { externalId: true, role: true },
    });
    const previousRoles = new Map(existingActors.map((a) => [a.externalId, a.role]));

    const normalizedUsers = users
      .map((user) => normalizeWorkspaceUser(user))
      .filter((u): u is NonNullable<typeof u> => u !== null);
    for (const user of normalizedUsers) {
      const metadata = toJsonValue({
        status: user.status,
        createdAt: user.createdAt?.toISOString() ?? null,
        workspaceId,
      });
      await prisma.providerActor.upsert({
        where: { provider_externalId: { provider: "chatgpt", externalId: user.externalId } },
        update: {
          email: user.email,
          name: user.name,
          role: user.role,
          metadata,
          lastSeenAt: now,
          syncRunId: syncRun.id,
        },
        create: {
          provider: "chatgpt",
          externalId: user.externalId,
          email: user.email,
          name: user.name,
          role: user.role,
          metadata,
          syncRunId: syncRun.id,
        },
      });
      actorsUpserted++;
    }
    await storeSnapshot(syncRun.id, "chatgpt_enterprise", "users", {
      users: users.length,
      truncated: usersTruncated,
      roles: countBy(normalizedUsers.map((u) => u.role)),
      statuses: countBy(normalizedUsers.map((u) => u.status)),
    });
    rawSnapshotsStored++;

    for (const grant of detectAdminRoleGrants(previousRoles, users)) {
      const who = grant.email ?? grant.userId;
      const created = await raiseComplianceAlert({
        title: `ChatGPT workspace admin role granted: ${who}`,
        description:
          `${who} now holds the "${grant.newRole}" role in ChatGPT workspace ${workspaceId} ` +
          `(previously "${grant.previousRole ?? "unknown"}"). Confirm the change was approved and that the ` +
          `account is covered by SSO/MFA. Source: Compliance API users export.`,
        severity: "HIGH",
      });
      if (created) alertsCreated++;
    }

    // New members since the last run. The directory cross-check (Tier 3
    // item 3.3, DirectoryPerson) is not on main yet, so this is reported in
    // the run metadata only.
    const newUsers = detectNewWorkspaceUsers(users, previousRun?.watermark ?? null);

    // ── GPTs → "new GPT with custom actions" alerts ─────────────────────
    const gptsKey = chatgptStreamWatermarkKey("GPTS");
    let gptsReport: Record<string, unknown>;
    try {
      const gptsWatermark = await loadSyncWatermark(gptsKey);
      const { gpts, truncated } = await listChatGPTWorkspaceGpts(workspaceId);
      const newWithActions = detectGptsWithActions(gpts, gptsWatermark?.watermark ?? null);
      for (const hit of newWithActions) {
        const exposed = hit.visibility === "anyone-with-link" || hit.visibility === "gpt-store";
        const created = await raiseComplianceAlert({
          title: `ChatGPT GPT with custom actions created: ${hit.name ?? hit.gptId}`,
          description:
            `GPT ${hit.gptId}${hit.name ? ` ("${hit.name}")` : ""} owned by ${hit.ownerEmail ?? "unknown"} ` +
            `calls external actions at ${hit.actionDomains.length ? hit.actionDomains.join(", ") : "an unlisted domain"}` +
            `${hit.authTypes.length ? ` (auth: ${hit.authTypes.join(", ")})` : ""}; sharing: ${hit.visibility ?? "unknown"}. ` +
            `Custom actions send conversation data to third-party endpoints — review the domain against the approved list.`,
          severity: exposed ? "HIGH" : "MEDIUM",
        });
        if (created) alertsCreated++;
      }
      // Every GPT also lands in the agent review queue (Agents → Discovered).
      // The baseline is the queue itself, not the GPTS watermark (which
      // predates agent discovery on existing installs): the first import
      // lands the existing estate silently instead of one alert per GPT.
      const gptsBaseline =
        (await prisma.discoveredAgent.count({ where: { source: "chatgpt_gpts" } })) === 0;
      const discoveredAgents = await applyAgentImport(
        gpts
          .map((gpt) => gptToDiscoveredAgent(gpt, { suppressAlert: gptsBaseline }))
          .filter((agent): agent is NonNullable<typeof agent> => !!agent),
      );
      const latest = latestGptCreatedAt(gpts);
      const nextGptsWatermark: WatermarkState = latest
        ? {
            watermark: gptsWatermark && gptsWatermark.watermark > latest ? gptsWatermark.watermark : latest,
            earliest: gptsWatermark && gptsWatermark.earliest < latest ? gptsWatermark.earliest : latest,
          }
        : gptsWatermark ?? { watermark: now, earliest: now };
      await saveSyncWatermark(gptsKey, nextGptsWatermark);
      gptsReport = {
        gpts: gpts.length,
        withActions: detectGptsWithActions(gpts, new Date(0)).length,
        newWithActions: newWithActions.length,
        truncated,
        baseline: !gptsWatermark,
        discoveredAgents,
      };
      await storeSnapshot(syncRun.id, "chatgpt_enterprise", "gpts", gptsReport);
      rawSnapshotsStored++;
    } catch (err) {
      if (!isUnauthorized(err)) throw err;
      gptsReport = { skipped: `unauthorized (${err.status}): key lacks the GPTs read scope` };
    }

    // ── Compliance Logs Platform streams ────────────────────────────────
    const seenEventIds = new Set<string>();
    const streams: Record<string, ChatGPTStreamReport> = {};
    let codexLogEvents: ComplianceLogEnvelope[] = [];
    let codexTurnEvents: ComplianceLogEnvelope[] = [];
    const deferredWatermarks: { key: string; state: WatermarkState }[] = [];

    for (const eventType of CHATGPT_LOG_EVENT_TYPES) {
      const key = chatgptStreamWatermarkKey(eventType);
      const existingWatermark = await loadSyncWatermark(key);
      const after = resolveLogCursor({ watermark: existingWatermark?.watermark ?? null, now });
      const report: ChatGPTStreamReport = {
        after: after.toISOString(),
        files: 0,
        events: 0,
        duplicates: 0,
        malformed: 0,
        bytes: 0,
        truncated: false,
        processedThrough: null,
      };

      try {
        // List up to one page past the per-run cap so truncation is known.
        const listed: ChatGPTLogFileMetadata[] = [];
        let cursor = after;
        let listingTruncated = false;
        for (;;) {
          const page = await listChatGPTLogFiles(workspaceId, eventType, cursor, { before: now });
          listed.push(...page.data);
          if (listed.length > CHATGPT_LOG_MAX_FILES_PER_RUN) {
            listingTruncated = true;
            break;
          }
          if (!page.has_more || !page.last_end_time) break;
          cursor = new Date(page.last_end_time);
        }

        const plan = planLogFileBatch(listed);
        report.truncated = plan.truncated || listingTruncated;

        const events: ComplianceLogEnvelope[] = [];
        for (const file of plan.files) {
          const downloaded = await downloadChatGPTLogFile(workspaceId, file.id);
          report.files++;
          report.bytes += downloaded.bytes;
          report.malformed += downloaded.malformed;
          const deduped = dedupeEvents(downloaded.records, seenEventIds);
          report.duplicates += deduped.duplicates;
          events.push(...deduped.events);
        }
        report.events = events.length;

        if (eventType === "AUTH_LOG" || eventType === "AUDIT_LOG") {
          const rows = events
            .map((event) => complianceActivityFromEvent(event, eventType, workspaceId))
            .filter((row): row is ComplianceActivityValues => row !== null);
          for (let i = 0; i < rows.length; i += COMPLIANCE_ACTIVITY_INSERT_CHUNK) {
            const chunk = rows.slice(i, i + COMPLIANCE_ACTIVITY_INSERT_CHUNK);
            const inserted = await prisma.complianceActivity.createMany({
              data: chunk.map((row) => ({ ...row, payload: toJsonValue(row.payload) })),
              skipDuplicates: true,
            });
            complianceActivitiesInserted += inserted.count;
          }
          if (eventType === "AUDIT_LOG") {
            for (const grant of detectAdminRoleAuditGrants(events)) {
              const target = grant.targetEmails.join(", ") || grant.targetUserId || "unknown user";
              const created = await raiseComplianceAlert({
                title: `ChatGPT workspace admin role granted: ${target}`,
                description:
                  `Audit event ${grant.action} granted the "${grant.role}" role to ${target} in ChatGPT workspace ${workspaceId}` +
                  `${grant.actorEmail ? `, performed by ${grant.actorEmail}` : ""}` +
                  `${grant.occurredAt ? ` at ${grant.occurredAt.toISOString()}` : ""}. Confirm the change was approved.`,
                severity: "HIGH",
              });
              if (created) alertsCreated++;
            }
          }
        } else if (eventType === "CONVERSATION_MESSAGE") {
          for (const counts of aggregateConversationMessages(events)) {
            await accumulateAssistantDailyStat(
              syncRun.id,
              chatgptDailyCountsToStat(
                counts,
                { externalId: counts.actorExternalId, name: assistantActorName(counts.actorExternalId) },
                assistantDay(counts.day),
              ),
            );
            assistantDailyStatsUpserted++;
          }
        } else if (eventType === "CODEX_LOG") {
          codexLogEvents = events;
        } else if (eventType === "CODEX_TURN") {
          codexTurnEvents = events;
        }

        const next = advanceStreamWatermark(existingWatermark, plan.nextWatermark, after);
        report.processedThrough = plan.nextWatermark?.toISOString() ?? null;
        if (next) {
          // Codex counts are written after both Codex streams are read, so
          // their cursors only advance once those rows are safely stored.
          if (eventType === "CODEX_LOG" || eventType === "CODEX_TURN") {
            deferredWatermarks.push({ key, state: next });
          } else {
            await saveSyncWatermark(key, next);
          }
        }
      } catch (err) {
        if (!isUnauthorized(err)) throw err;
        report.skipped = `unauthorized (${err.status}): key lacks the ${eventType} read scope`;
      }

      streams[eventType] = report;
    }

    for (const counts of aggregateCodexEvents(codexLogEvents, codexTurnEvents)) {
      await accumulateAssistantDailyStat(
        syncRun.id,
        codexDailyCountsToStat(
          counts,
          { externalId: counts.actorExternalId, name: assistantActorName(counts.actorExternalId) },
          assistantDay(counts.day),
        ),
      );
      assistantDailyStatsUpserted++;
    }
    for (const deferred of deferredWatermarks) {
      await saveSyncWatermark(deferred.key, deferred.state);
    }

    await storeSnapshot(syncRun.id, "chatgpt_enterprise", "logs", { streams });
    rawSnapshotsStored++;

    const summary = {
      usageBucketsUpserted: 0,
      costBucketsUpserted: 0,
      rawSnapshotsStored,
      projectsUpserted: 0,
      actorsUpserted,
      apiUsageLogsCreated: 0,
    };

    const unauthorizedStreams = (Object.keys(streams) as ChatGPTLogEventType[]).filter((t) => streams[t]?.skipped);
    // A capped stream is not a gap the operator must backfill — the next
    // hourly run resumes from that stream's cursor — so it is reported in
    // the run metadata and the result without raising provider_sync_truncated
    // (no `pagination` is passed to finishSyncRun).
    const truncated =
      usersTruncated ||
      gptsReport.truncated === true ||
      Object.values(streams).some((report) => report.truncated);
    await finishSyncRun({
      syncRunId: syncRun.id,
      provider: "chatgpt_enterprise",
      window,
      summary,
      metadata: {
        workspaceId,
        users: users.length,
        newUsers: newUsers.length,
        directoryCheck: "skipped: DirectoryPerson (Tier 3 item 3.3) is not present",
        gpts: gptsReport,
        streams,
        streamsTruncated: truncated,
        unauthorizedStreams,
        complianceActivitiesInserted,
        assistantDailyStatsUpserted,
        alertsCreated,
      },
    });

    // The overall cursor is the instant this run observed the workspace
    // (detectNewWorkspaceUsers compares against it next run). Written after
    // finishSyncRun so its day-snapped window watermark does not win.
    await saveSyncWatermark(overallKey, {
      watermark: now,
      earliest: previousRun?.earliest ?? now,
    });

    logger.info("provider_sync.chatgpt_enterprise.completed", {
      syncRunId: syncRun.id,
      users: users.length,
      complianceActivitiesInserted,
      assistantDailyStatsUpserted,
      alertsCreated,
      unauthorizedStreams,
    });

    return { provider: "chatgpt_enterprise", success: true, syncRunId: syncRun.id, window, truncated, ...summary };
  } catch (error) {
    const errorMessage = await failSyncRun(syncRun.id, error);
    return { provider: "chatgpt_enterprise", success: false, error: errorMessage };
  }
}

// ─── Anthropic Compliance API (activity feed + session metadata) ────────────
// Newest-first feed. The job layer hands each run a `{ from, to }` window
// (watermark minus the overlap, floored at PROVIDER_MAX_LOOKBACK_DAYS); the
// run reads everything the feed created inside it (upserts by upstream id make
// the overlap free) and, when the first pull hit the page cap, resumes that
// backfill from the `last_id` cursor kept in ProviderSyncWatermark.cursor down
// to the lookback floor. Governance rules run over the activities that are new
// to the database. Session metadata (Enterprise, Compliance Access Key only)
// is upserted as ComplianceSession — never transcripts.

const COMPLIANCE_ALERT_DEDUPE_MS = 7 * 24 * 60 * 60 * 1000;

async function loadComplianceAlertBaseline(): Promise<{
  knownActorEmails: Set<string>;
  knownComplianceKeyIds: Set<string>;
  knownLoginCountries: Map<string, Set<string>>;
}> {
  const [users, actors, feedActors, keyRows, countryRows] = await Promise.all([
    prisma.user.findMany({ select: { email: true } }),
    prisma.providerActor.findMany({
      where: { provider: { in: ["anthropic", CLAUDE_ENTERPRISE_PROVIDER, "claude_code"] }, email: { not: null } },
      select: { email: true },
      distinct: ["email"],
    }),
    prisma.complianceActivity.findMany({
      where: { provider: COMPLIANCE_RECORD_PROVIDER, actorEmail: { not: null } },
      select: { actorEmail: true },
      distinct: ["actorEmail"],
    }),
    prisma.complianceActivity.findMany({
      where: { provider: COMPLIANCE_RECORD_PROVIDER, actorApiKeyId: { not: null } },
      select: { type: true, actorApiKeyId: true },
      distinct: ["type", "actorApiKeyId"],
    }),
    prisma.complianceActivity.findMany({
      where: { provider: COMPLIANCE_RECORD_PROVIDER, actorEmail: { not: null }, ipCountry: { not: null } },
      select: { type: true, actorEmail: true, ipCountry: true },
      distinct: ["type", "actorEmail", "ipCountry"],
    }),
  ]);

  const knownActorEmails = new Set<string>();
  for (const u of users) if (u.email) knownActorEmails.add(u.email.toLowerCase());
  for (const a of actors) if (a.email) knownActorEmails.add(a.email.toLowerCase());
  for (const a of feedActors) if (a.actorEmail) knownActorEmails.add(a.actorEmail.toLowerCase());

  const knownComplianceKeyIds = new Set<string>();
  for (const row of keyRows) {
    if (row.actorApiKeyId && classifyComplianceActivity(row.type) === "compliance_api_accessed") {
      knownComplianceKeyIds.add(row.actorApiKeyId);
    }
  }

  const knownLoginCountries = new Map<string, Set<string>>();
  for (const row of countryRows) {
    if (!row.actorEmail || !row.ipCountry || classifyComplianceActivity(row.type) !== "login") continue;
    const email = row.actorEmail.toLowerCase();
    const set = knownLoginCountries.get(email) ?? new Set<string>();
    set.add(row.ipCountry);
    knownLoginCountries.set(email, set);
  }

  return { knownActorEmails, knownComplianceKeyIds, knownLoginCountries };
}

async function createComplianceAlerts(candidates: ComplianceAlertCandidate[]): Promise<number> {
  let created = 0;
  for (const candidate of candidates) {
    // Activity ids are unique upstream, so an existing alert that names the
    // same activity is the same finding (a re-pull inside the overlap).
    const duplicate = await prisma.alert.findFirst({
      where: {
        source: COMPLIANCE_ALERT_SOURCE,
        description: { contains: `Activity ${candidate.activityId} ` },
        createdAt: { gte: new Date(Date.now() - COMPLIANCE_ALERT_DEDUPE_MS) },
      },
      select: { id: true },
    });
    if (duplicate) continue;

    await prisma.alert.create({
      data: {
        title: candidate.title,
        description: `${candidate.description} Rule: ${candidate.rule}.`,
        severity: candidate.severity,
        source: COMPLIANCE_ALERT_SOURCE,
      },
    });
    created++;

    await notifyDatadog({
      title: `[UrNammu] ${candidate.title}`,
      text: candidate.description,
      tags: [
        "source:urnammu",
        `alert_source:${COMPLIANCE_ALERT_SOURCE}`,
        `severity:${candidate.severity.toLowerCase()}`,
        `rule:${candidate.rule}`,
      ],
      alertType: candidate.severity === "HIGH" || candidate.severity === "CRITICAL" ? "error" : "warning",
      aggregationKey: `urnammu:${COMPLIANCE_ALERT_SOURCE}:${candidate.rule}:${candidate.activityId}`,
    });
  }
  return created;
}

async function pullComplianceFeed(
  key: string,
  params: { afterId: string | null; createdAtGte: Date; createdAtLt?: Date | null; maxPages: number },
): Promise<{ activities: NormalizedComplianceActivity[]; pages: number; truncated: boolean; lastId: string | null; skipped: number }> {
  const activities: NormalizedComplianceActivity[] = [];
  let afterId = params.afterId;
  let pages = 0;
  let hasMore = true;
  let lastId: string | null = afterId;
  let skipped = 0;
  while (hasMore && pages < params.maxPages) {
    const page = await fetchComplianceActivities(key, {
      afterId,
      createdAtGte: params.createdAtGte,
      createdAtLt: params.createdAtLt ?? null,
    });
    pages++;
    for (const item of page.items) {
      const normalized = normalizeComplianceActivity(item);
      if (normalized) activities.push(normalized);
      else skipped++;
    }
    hasMore = page.hasMore && page.items.length > 0;
    lastId = page.lastId ?? lastId;
    afterId = page.lastId;
    if (!afterId) break;
  }
  return { activities, pages, truncated: hasMore, lastId, skipped };
}

async function pullComplianceSessions(
  key: string,
  kind: ComplianceSessionKind,
  updatedAtGte: Date,
): Promise<{ sessions: NormalizedComplianceSession[]; pages: number; truncated: boolean }> {
  const sessions: NormalizedComplianceSession[] = [];
  let page: string | null = null;
  let pages = 0;
  do {
    const result = await fetchComplianceSessions(key, kind, { page, updatedAtGte });
    pages++;
    for (const item of result.items) {
      const normalized = normalizeComplianceSession(item, kind);
      if (normalized) sessions.push(normalized);
    }
    page = result.nextPage;
  } while (page && pages < COMPLIANCE_SESSIONS_MAX_PAGES);
  return { sessions, pages, truncated: !!page };
}

export async function syncAnthropicCompliance(triggeredByUserId: string, window: SyncWindow): Promise<SyncResult> {
  const resolved = await resolveComplianceKey();
  if (!resolved) {
    return {
      provider: ANTHROPIC_COMPLIANCE_PROVIDER,
      success: false,
      skipped: true,
      error: "Neither an Anthropic Compliance Access Key nor an Admin API key is configured",
    };
  }

  const syncRun = await createSyncRun(ANTHROPIC_COMPLIANCE_PROVIDER, triggeredByUserId);

  try {
    const now = new Date();
    const lookbackRaw = await getSetting(ANTHROPIC_COMPLIANCE_SETTINGS.LOOKBACK_DAYS);
    const lookbackParsed = Number.parseInt(lookbackRaw ?? "", 10);
    const lookbackDays = Number.isFinite(lookbackParsed) && lookbackParsed > 0 ? lookbackParsed : COMPLIANCE_FEED_DEFAULT_LOOKBACK_DAYS;
    const previous = await loadWatermark(ANTHROPIC_COMPLIANCE_PROVIDER);
    // `firstRun` (no watermark yet → baseline-learning) and the resumable
    // backfill (stored cursor down to the lookback floor) come from the plan;
    // the incremental read itself is bounded by the scheduled window.
    const plan = planComplianceFeedPull({ state: previous, now, lookbackDays });

    // Baseline for the governance rules, read before this run's rows land.
    const baseline = await loadComplianceAlertBaseline();
    const timeZone = await getOrgTimezone();

    // 1. Incremental: everything the feed created inside the window.
    const incremental = await pullComplianceFeed(resolved.key, {
      afterId: null,
      createdAtGte: window.from,
      createdAtLt: window.to,
      maxPages: COMPLIANCE_FEED_MAX_PAGES,
    });
    // 2. Resume a backfill that was cut short earlier, with whatever page
    //    budget the incremental pull left.
    let backfill: Awaited<ReturnType<typeof pullComplianceFeed>> | null = null;
    const budgetLeft = COMPLIANCE_FEED_MAX_PAGES - incremental.pages;
    if (plan.backfill && budgetLeft > 0) {
      backfill = await pullComplianceFeed(resolved.key, {
        afterId: plan.backfill.afterId,
        createdAtGte: plan.backfill.since,
        maxPages: budgetLeft,
      });
    }

    const byId = new Map<string, NormalizedComplianceActivity>();
    for (const a of [...incremental.activities, ...(backfill?.activities ?? [])]) byId.set(a.id, a);
    const activities = [...byId.values()];

    // Which of these are new to the database? Only those feed the rules.
    const existingIds = new Set(
      activities.length
        ? (
            await prisma.complianceActivity.findMany({
              where: { id: { in: activities.map((a) => a.id) } },
              select: { id: true },
            })
          ).map((row) => row.id)
        : [],
    );
    const fresh = activities.filter((a) => !existingIds.has(a.id));

    let activitiesUpserted = 0;
    for (const a of activities) {
      const columns = {
        provider: COMPLIANCE_RECORD_PROVIDER,
        type: a.type,
        occurredAt: a.occurredAt,
        organizationId: a.organizationId,
        actorType: a.actorType,
        actorEmail: a.actorEmail,
        actorUserId: a.actorUserId,
        actorApiKeyId: a.actorApiKeyId,
        ipAddress: a.ipAddress,
        ipCountry: a.ipCountry,
        userAgent: a.userAgent,
        payload: toJsonValue(a.payload),
      };
      await prisma.complianceActivity.upsert({
        where: { id: a.id },
        update: columns,
        create: { id: a.id, ...columns },
      });
      activitiesUpserted++;
    }

    // API-key lifecycle → ApiKeyProfile, so a key created via the Console is
    // known to the key-usage rules before its first token moves.
    let keyProfilesTouched = 0;
    for (const a of fresh) {
      if (classifyComplianceActivity(a.type) !== "api_key_created") continue;
      const created = extractCreatedApiKey(a.payload);
      if (!created.id) continue;
      await prisma.apiKeyProfile.upsert({
        where: { provider_externalId: { provider: "anthropic", externalId: created.id } },
        create: {
          provider: "anthropic",
          externalId: created.id,
          name: created.name,
          firstSeenAt: a.occurredAt,
          lastActiveAt: a.occurredAt,
        },
        update: created.name ? { name: created.name } : {},
      });
      keyProfilesTouched++;
    }

    // Governance rules over the new activities.
    const candidates = evaluateComplianceAlerts(fresh, {
      ...baseline,
      timeZone,
      firstRun: plan.firstRun,
      now,
    });
    const alertsCreated = await createComplianceAlerts(candidates);

    // 3. Session metadata (Enterprise; needs read:compliance_user_data).
    let sessionsUpserted = 0;
    const sessionNotes: Record<string, unknown> = {};
    if (resolved.kind === "compliance") {
      const sessionsSince = previous
        ? window.from
        : new Date(Math.min(window.from.getTime(), now.getTime() - lookbackDays * 24 * 60 * 60 * 1000));
      for (const kind of ["local", "remote"] as ComplianceSessionKind[]) {
        try {
          const result = await pullComplianceSessions(resolved.key, kind, sessionsSince);
          for (const session of result.sessions) {
            const columns = {
              provider: COMPLIANCE_RECORD_PROVIDER,
              sessionKind: session.sessionKind,
              productSurface: session.productSurface,
              userEmail: session.userEmail,
              userExternalId: session.userExternalId,
              workspaceId: session.workspaceId,
              startedAt: session.startedAt,
              lastActivityAt: session.lastActivityAt,
              status: session.status,
              raw: toJsonValue(session.raw),
            };
            await prisma.complianceSession.upsert({
              where: { id: session.id },
              update: columns,
              create: { id: session.id, ...columns },
            });
            sessionsUpserted++;
          }
          sessionNotes[kind] = { sessions: result.sessions.length, pages: result.pages, truncated: result.truncated };
        } catch (error) {
          // A 403 here means the key lacks read:compliance_user_data; the
          // feed still succeeded, so record and move on.
          sessionNotes[kind] = { error: error instanceof Error ? error.message : "Failed" };
        }
      }
    } else {
      sessionNotes.skipped = "Admin API key in use; session metadata needs a Compliance Access Key with read:compliance_user_data.";
    }

    // Feed cursor: keep the backfill cursor only while there is more to drain.
    // A page-capped first pull becomes a backfill that later runs resume; a
    // page-capped incremental pull on a later run is a real gap (the watermark
    // still advances), so that case raises provider_sync_truncated below.
    const remainingCursor = backfill
      ? backfill.truncated
        ? backfill.lastId
        : null
      : incremental.truncated && plan.firstRun
        ? incremental.lastId
        : previous?.cursor ?? null;
    const resumable = (plan.firstRun && incremental.truncated) || (backfill?.truncated ?? false);
    const capped = !plan.firstRun && incremental.truncated;
    let oldestSeen: Date | null = null;
    for (const a of activities) if (!oldestSeen || a.occurredAt < oldestSeen) oldestSeen = a.occurredAt;

    // Snapshot is counts only — the payloads carry emails and IPs and already
    // live in ComplianceActivity.
    const typeCounts: Record<string, number> = {};
    for (const a of activities) typeCounts[a.type] = (typeCounts[a.type] ?? 0) + 1;
    await storeSnapshot(syncRun.id, ANTHROPIC_COMPLIANCE_PROVIDER, "activity_feed", {
      fetched: activities.length,
      new: fresh.length,
      pages: incremental.pages + (backfill?.pages ?? 0),
      type_counts: typeCounts,
      key_kind: resolved.kind,
    });

    const summary = {
      usageBucketsUpserted: 0,
      costBucketsUpserted: 0,
      rawSnapshotsStored: 1,
      projectsUpserted: 0,
      actorsUpserted: 0,
      apiUsageLogsCreated: 0,
      complianceActivitiesUpserted: activitiesUpserted,
      complianceSessionsUpserted: sessionsUpserted,
      alertsCreated,
    };

    await finishSyncRun({
      syncRunId: syncRun.id,
      provider: ANTHROPIC_COMPLIANCE_PROVIDER,
      window,
      summary,
      pagination: {
        incremental: { pages: incremental.pages, truncated: incremental.truncated },
        backfill: backfill ? { pages: backfill.pages, truncated: backfill.truncated } : null,
        resumable,
        truncated: capped,
      },
      metadata: {
        keyKind: resolved.kind,
        firstRun: plan.firstRun,
        activitiesFetched: activities.length,
        activitiesNew: fresh.length,
        unparseable: incremental.skipped + (backfill?.skipped ?? 0),
        backfill: backfill
          ? { pages: backfill.pages, activities: backfill.activities.length, truncated: backfill.truncated }
          : plan.backfill
            ? { deferred: true }
            : null,
        keyProfilesTouched,
        alertCandidates: candidates.length,
        alertsCreated,
        sessions: sessionNotes,
        cursor: remainingCursor,
        timeZone,
      },
    });

    // finishSyncRun advanced `watermark` / `earliest` from the window; the feed
    // cursor rides alongside (the one column it leaves alone), and a backfill
    // that reached further back than the window pulls `earliest` with it.
    const current = await prisma.providerSyncWatermark.findUnique({
      where: { provider: ANTHROPIC_COMPLIANCE_PROVIDER },
      select: { earliest: true },
    });
    await prisma.providerSyncWatermark.update({
      where: { provider: ANTHROPIC_COMPLIANCE_PROVIDER },
      data: {
        cursor: remainingCursor,
        ...(current && oldestSeen && oldestSeen < current.earliest ? { earliest: startOfDayUtc(oldestSeen) } : {}),
      },
    });

    const truncated = incremental.truncated || (backfill?.truncated ?? false);
    return { provider: ANTHROPIC_COMPLIANCE_PROVIDER, success: true, syncRunId: syncRun.id, window, truncated, ...summary };
  } catch (error) {
    const errorMessage = await failSyncRun(syncRun.id, error);
    return { provider: ANTHROPIC_COMPLIANCE_PROVIDER, success: false, error: errorMessage };
  }
}

// ─── Claude Enterprise Analytics ─────────────────────────────────────────────
// Per-user daily activity per product (AssistantDailyStat provider=
// "claude_enterprise", one row per person × day × product), org-level
// DAU/WAU/MAU + seats (UsageBucket `org_summary` rows), and the per-user
// usage / cost reports (UsageBucket / CostBucket with actorExternalId =
// email). Walks every UTC day of the scheduled window up to yesterday (today's
// numbers are not final and the API lags about a day); the overlap days the
// job layer adds re-pull the days the API still revises.

/** UTC days ("YYYY-MM-DD") inside `[from, to)`, stopping at yesterday. */
function enterpriseDaysInWindow(window: SyncWindow, now: Date): string[] {
  const dayMs = 24 * 60 * 60 * 1000;
  const lastMs = Math.min(startOfDayUtc(window.to).getTime(), startOfDayUtc(now).getTime()) - dayMs;
  const days: string[] = [];
  for (let ms = startOfDayUtc(window.from).getTime(); ms <= lastMs; ms += dayMs) {
    days.push(new Date(ms).toISOString().slice(0, 10));
  }
  return days;
}

export async function syncClaudeEnterpriseAnalytics(triggeredByUserId: string, window: SyncWindow): Promise<SyncResult> {
  if (!(await isClaudeEnterpriseConfigured())) {
    return {
      provider: CLAUDE_ENTERPRISE_PROVIDER,
      success: false,
      skipped: true,
      error: "Claude Enterprise Analytics API key is not configured",
    };
  }

  const syncRun = await createSyncRun(CLAUDE_ENTERPRISE_PROVIDER, triggeredByUserId);

  try {
    const now = new Date();
    const days = enterpriseDaysInWindow(window, now);

    if (days.length === 0) {
      const summary = {
        usageBucketsUpserted: 0,
        costBucketsUpserted: 0,
        rawSnapshotsStored: 0,
        projectsUpserted: 0,
        actorsUpserted: 0,
        apiUsageLogsCreated: 0,
      };
      const truncated = await finishSyncRun({
        syncRunId: syncRun.id,
        provider: CLAUDE_ENTERPRISE_PROVIDER,
        window,
        summary,
        pagination: { pages: 0, truncated: false },
        metadata: { days: [], note: "Nothing to pull: the window holds no completed UTC day." },
      });
      return { provider: CLAUDE_ENTERPRISE_PROVIDER, success: true, syncRunId: syncRun.id, window, truncated, ...summary };
    }

    const daySet = new Set(days);
    const firstDay = days[0];
    const lastDay = days[days.length - 1];
    const rangeStart = `${firstDay}T00:00:00Z`;
    const rangeEndExclusive = new Date(new Date(`${lastDay}T00:00:00Z`).getTime() + 24 * 60 * 60 * 1000).toISOString();

    // 1. Per-user activity per day.
    const dayStats = [];
    const dayNotes: Record<string, unknown> = {};
    const actorsSeen = new Map<string, { email: string | null; name: string | null; userId: string | null; deleted: boolean; lastActivity: string | null }>();
    for (const day of days) {
      try {
        const result = await getEnterpriseUsersForDay(day);
        const dayDate = new Date(`${day}T00:00:00.000Z`);
        let rows = 0;
        for (const item of result.items) {
          const stats = enterpriseUserToDailyStats(item, dayDate);
          rows += stats.length;
          dayStats.push(...stats);
          for (const stat of stats) {
            const meta = stat.metadata as { user_id?: string | null; deleted?: boolean; last_activity_date?: string | null };
            const prev = actorsSeen.get(stat.actorExternalId);
            actorsSeen.set(stat.actorExternalId, {
              email: stat.actorExternalId.includes("@") ? stat.actorExternalId : null,
              name: stat.actorName ?? prev?.name ?? null,
              userId: meta.user_id ?? prev?.userId ?? null,
              deleted: meta.deleted === true,
              lastActivity: meta.last_activity_date ?? prev?.lastActivity ?? null,
            });
          }
        }
        dayNotes[day] = { users: result.items.length, statRows: rows, pages: result.pages, truncated: result.truncated };
      } catch (error) {
        dayNotes[day] = { error: error instanceof Error ? error.message : "Failed" };
      }
    }

    // 2. Org summaries (DAU / WAU / MAU, seats).
    let usageBucketsUpserted = 0;
    let summariesUpserted = 0;
    let summariesError: string | null = null;
    try {
      const result = await getEnterpriseSummaries(firstDay, lastDay);
      for (const item of result.items) {
        const summary = parseEnterpriseSummary(item);
        if (!summary || !daySet.has(summary.date)) continue;
        const bucketStart = new Date(`${summary.date}T00:00:00.000Z`);
        const bucketEnd = new Date(bucketStart.getTime() + 24 * 60 * 60 * 1000);
        const dimensionKey = `${CLAUDE_ENTERPRISE_SUMMARY_DIMENSION}|date=${summary.date}`;
        const metadata = toJsonValue({
          kind: CLAUDE_ENTERPRISE_SUMMARY_DIMENSION,
          dau: summary.dau,
          wau: summary.wau,
          mau: summary.mau,
          seats: summary.seats,
          pendingInvites: summary.pendingInvites,
          raw: summary.raw,
        });
        await prisma.usageBucket.upsert({
          where: {
            provider_bucketStart_bucketEnd_granularity_dimensionKey: {
              provider: CLAUDE_ENTERPRISE_PROVIDER,
              bucketStart,
              bucketEnd,
              granularity: "day",
              dimensionKey,
            },
          },
          update: { requestCount: summary.dau, metadata, syncRunId: syncRun.id },
          create: {
            provider: CLAUDE_ENTERPRISE_PROVIDER,
            bucketStart,
            bucketEnd,
            granularity: "day",
            dimensionKey,
            requestCount: summary.dau,
            metadata,
            syncRunId: syncRun.id,
          },
        });
        usageBucketsUpserted++;
        summariesUpserted++;
      }
    } catch (error) {
      summariesError = error instanceof Error ? error.message : "Failed";
    }

    // 3. Per-user usage report → UsageBucket per (day, person, product, model).
    const usageRows: EnterpriseUsageRow[] = [];
    let usageError: string | null = null;
    let usageTruncated = false;
    try {
      const result = await getEnterpriseUserUsageReport(rangeStart, rangeEndExclusive);
      usageTruncated = result.truncated;
      for (const item of result.items) {
        const row = parseEnterpriseUsageRow(item);
        if (row && daySet.has(row.day.toISOString().slice(0, 10))) usageRows.push(row);
      }
    } catch (error) {
      usageError = error instanceof Error ? error.message : "Failed";
    }
    // Sum across duplicate (day, actor, product, model) rows before writing.
    const usageAgg = new Map<string, EnterpriseUsageRow>();
    for (const row of usageRows) {
      const key = `${row.day.toISOString()}|${row.actorExternalId}|${row.product}|${row.model ?? ""}`;
      const existing = usageAgg.get(key);
      if (existing) {
        existing.inputTokens += row.inputTokens;
        existing.outputTokens += row.outputTokens;
        existing.cacheReadTokens += row.cacheReadTokens;
        existing.cacheCreationTokens += row.cacheCreationTokens;
        existing.requests = row.requests == null ? existing.requests : (existing.requests ?? 0) + row.requests;
      } else {
        usageAgg.set(key, { ...row });
      }
    }
    for (const row of usageAgg.values()) {
      const date = row.day.toISOString().slice(0, 10);
      const bucketEnd = new Date(row.day.getTime() + 24 * 60 * 60 * 1000);
      const dimensionKey = makeDimensionKey({ actor: row.actorExternalId, product: row.product, model: row.model, date });
      const actorName = row.actor.name ?? (row.actor.email ? row.actor.email.split("@")[0] : row.actorExternalId);
      const columns = {
        model: row.model,
        actorExternalId: row.actorExternalId,
        actorName,
        inputTokens: Math.round(row.inputTokens),
        outputTokens: Math.round(row.outputTokens),
        totalTokens: Math.round(row.inputTokens + row.outputTokens),
        cacheReadTokens: Math.round(row.cacheReadTokens),
        cacheCreationTokens: Math.round(row.cacheCreationTokens),
        requestCount: row.requests,
        metadata: toJsonValue({ product: row.product, user_id: row.actor.userId, deleted: row.actor.deleted }),
        syncRunId: syncRun.id,
      };
      await prisma.usageBucket.upsert({
        where: {
          provider_bucketStart_bucketEnd_granularity_dimensionKey: {
            provider: CLAUDE_ENTERPRISE_PROVIDER,
            bucketStart: row.day,
            bucketEnd,
            granularity: "day",
            dimensionKey,
          },
        },
        update: columns,
        create: {
          provider: CLAUDE_ENTERPRISE_PROVIDER,
          bucketStart: row.day,
          bucketEnd,
          granularity: "day",
          dimensionKey,
          ...columns,
        },
      });
      usageBucketsUpserted++;
    }

    // 4. Per-user cost report → CostBucket per (day, person, product, model).
    const costRows: EnterpriseCostRow[] = [];
    let costError: string | null = null;
    let costTruncated = false;
    try {
      const result = await getEnterpriseUserCostReport(rangeStart, rangeEndExclusive);
      costTruncated = result.truncated;
      for (const item of result.items) {
        const row = parseEnterpriseCostRow(item);
        if (row && daySet.has(row.day.toISOString().slice(0, 10))) costRows.push(row);
      }
    } catch (error) {
      costError = error instanceof Error ? error.message : "Failed";
    }
    const costAgg = new Map<string, EnterpriseCostRow>();
    for (const row of costRows) {
      const key = `${row.day.toISOString()}|${row.actorExternalId}|${row.product}|${row.model ?? ""}`;
      const existing = costAgg.get(key);
      if (existing) existing.amountUsd += row.amountUsd;
      else costAgg.set(key, { ...row });
    }
    let costBucketsUpserted = 0;
    for (const row of costAgg.values()) {
      const date = row.day.toISOString().slice(0, 10);
      const bucketEnd = new Date(row.day.getTime() + 24 * 60 * 60 * 1000);
      const dimensionKey = makeDimensionKey({ actor: row.actorExternalId, product: row.product, model: row.model, date });
      const actorName = row.actor.name ?? (row.actor.email ? row.actor.email.split("@")[0] : row.actorExternalId);
      const columns = {
        amount: Math.round(row.amountUsd * 1_000_000) / 1_000_000,
        currency: row.currency,
        model: row.model,
        actorExternalId: row.actorExternalId,
        actorName,
        lineItem: row.product,
        metadata: toJsonValue({ product: row.product, user_id: row.actor.userId, deleted: row.actor.deleted }),
        syncRunId: syncRun.id,
      };
      await prisma.costBucket.upsert({
        where: {
          provider_bucketStart_bucketEnd_granularity_dimensionKey: {
            provider: CLAUDE_ENTERPRISE_PROVIDER,
            bucketStart: row.day,
            bucketEnd,
            granularity: "day",
            dimensionKey,
          },
        },
        update: columns,
        create: {
          provider: CLAUDE_ENTERPRISE_PROVIDER,
          bucketStart: row.day,
          bucketEnd,
          granularity: "day",
          dimensionKey,
          ...columns,
        },
      });
      costBucketsUpserted++;
    }

    // 5. AssistantDailyStat rows: activity + tokens + cost per person × day × product.
    const merged = mergeEnterpriseDailyStats(dayStats, [...usageAgg.values()], [...costAgg.values()]);
    let assistantStatsUpserted = 0;
    for (const stat of merged) {
      await upsertAssistantDailyStat(syncRun.id, stat);
      assistantStatsUpserted++;
      if (!actorsSeen.has(stat.actorExternalId)) {
        const meta = stat.metadata as { user_id?: string | null; deleted?: boolean };
        actorsSeen.set(stat.actorExternalId, {
          email: stat.actorExternalId.includes("@") ? stat.actorExternalId : null,
          name: stat.actorName,
          userId: meta.user_id ?? null,
          deleted: meta.deleted === true,
          lastActivity: null,
        });
      }
    }

    // 6. ProviderActor per seat seen.
    let actorsUpserted = 0;
    for (const [externalId, actor] of actorsSeen) {
      const metadata = toJsonValue({ user_id: actor.userId, deleted: actor.deleted, last_activity_date: actor.lastActivity });
      await prisma.providerActor.upsert({
        where: { provider_externalId: { provider: CLAUDE_ENTERPRISE_PROVIDER, externalId } },
        update: { email: actor.email, name: actor.name, role: actor.deleted ? "deleted" : "member", metadata, lastSeenAt: now, syncRunId: syncRun.id },
        create: { provider: CLAUDE_ENTERPRISE_PROVIDER, externalId, email: actor.email, name: actor.name, role: actor.deleted ? "deleted" : "member", metadata, syncRunId: syncRun.id },
      });
      actorsUpserted++;
    }

    // 7. Do not advance the watermark past a day whose activity pull failed:
    //    clamp the window finishSyncRun records so the next run retries it.
    const failedDays = days.filter((day) => (dayNotes[day] as { error?: string } | undefined)?.error);
    const coveredWindow: SyncWindow = failedDays.length
      ? { from: window.from, to: new Date(`${failedDays[0]}T00:00:00.000Z`) }
      : window;
    const dayPagesTruncated = days.some((day) => (dayNotes[day] as { truncated?: boolean } | undefined)?.truncated === true);

    await storeSnapshot(syncRun.id, CLAUDE_ENTERPRISE_PROVIDER, "analytics", {
      days,
      per_day: dayNotes,
      summaries: summariesUpserted,
      usage_rows: usageRows.length,
      cost_rows: costRows.length,
      stat_rows: merged.length,
    });

    const summary = {
      usageBucketsUpserted,
      costBucketsUpserted,
      rawSnapshotsStored: 1,
      projectsUpserted: 0,
      actorsUpserted,
      apiUsageLogsCreated: 0,
    };

    const truncated = await finishSyncRun({
      syncRunId: syncRun.id,
      provider: CLAUDE_ENTERPRISE_PROVIDER,
      window: coveredWindow,
      summary,
      pagination: {
        users: { truncated: dayPagesTruncated },
        usageReport: { truncated: usageTruncated },
        costReport: { truncated: costTruncated },
        truncated: dayPagesTruncated || usageTruncated || costTruncated,
      },
      metadata: {
        days,
        perDay: dayNotes,
        failedDays,
        summariesUpserted,
        summariesError,
        usageRows: usageRows.length,
        usageError,
        costRows: costRows.length,
        costError,
        assistantDailyStatsUpserted: assistantStatsUpserted,
        uniqueUsers: actorsSeen.size,
      },
    });

    return {
      provider: CLAUDE_ENTERPRISE_PROVIDER,
      success: true,
      syncRunId: syncRun.id,
      window: coveredWindow,
      truncated,
      ...summary,
    };
  } catch (error) {
    const errorMessage = await failSyncRun(syncRun.id, error);
    return { provider: CLAUDE_ENTERPRISE_PROVIDER, success: false, error: errorMessage };
  }
}
