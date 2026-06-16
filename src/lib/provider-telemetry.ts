import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import {
  fetchAnthropicOrgData,
  getCostReport,
  getUsageReport,
  isAnthropicAdminConfigured,
  listAPIKeys,
  listMembers,
} from "./anthropic-admin";
import {
  fetchOpenAIOrgData,
  getCosts,
  getUsage,
  isOpenAIAdminConfigured,
  listAssistants,
} from "./openai-admin";
import {
  getOpenRouterActivity,
  isOpenRouterConfigured,
  normalizeOpenRouterActivityRows,
} from "./openrouter-admin";
import {
  isHeliconeConfigured,
  normalizeHeliconeRequestRows,
  queryHeliconeRequests,
} from "./helicone-admin";
import {
  isLiteLLMConfigured,
  normalizeLiteLLMSpendRows,
  queryLiteLLMSpendLogs,
} from "./litellm-admin";
import {
  getPortkeyCostGraph,
  getPortkeyModelGroups,
  getPortkeyTokensGraph,
  getPortkeyUserGroups,
  isPortkeyConfigured,
  normalizePortkeyGraphPoints,
  normalizePortkeyGroupedRows,
} from "./portkey-admin";
import {
  getGeminiBillingOverview,
  getGeminiBillingRows,
  getGeminiUsageMetadata,
  isGeminiBillingConfigured,
} from "./gemini-admin";
import {
  getClaudeCodeActorExternalId,
  getClaudeCodeReportRange,
  isClaudeCodeAnalyticsAvailable,
  type ClaudeCodeRangeResult,
} from "./claude-code-analytics";
import {
  isCursorAdminConfigured,
  getCursorDailyUsage,
  getCursorSpend,
  getCursorUsageEvents,
} from "./cursor-admin";
import { getSetting, PROVIDER_MANAGED_SYSTEM_SETTINGS_KEYS } from "./settings";
import { logger } from "./observability";

type SyncSummary = {
  syncRunId: string;
  usageBucketsUpserted: number;
  costBucketsUpserted: number;
  rawSnapshotsStored: number;
  projectsUpserted: number;
  actorsUpserted: number;
  apiUsageLogsCreated: number;
};

type SyncProvider = "anthropic" | "openai" | "claude_code" | "gemini" | "openrouter" | "helicone" | "portkey" | "litellm" | "cursor";

type SyncResult =
  | ({ provider: SyncProvider; success: true } & SyncSummary)
  | { provider: SyncProvider; success: false; error: string; skipped?: boolean };

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

async function resolveManagedSystemId(settingKey: string): Promise<string | null> {
  const configuredId = await getSetting(settingKey);
  if (!configuredId) return null;

  const system = await prisma.aISystem.findUnique({
    where: { id: configuredId },
    select: { id: true },
  });
  if (!system) {
    logger.warn("provider_sync.managed_system_not_found", {
      settingKey,
      configuredId,
    });
    return null;
  }
  return system.id;
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

async function completeSyncRun(syncRunId: string, summary: Omit<SyncSummary, "syncRunId">, metadata?: Record<string, unknown>) {
  await prisma.providerSyncRun.update({
    where: { id: syncRunId },
    data: {
      status: "SUCCEEDED",
      completedAt: new Date(),
      recordsProcessed:
        summary.usageBucketsUpserted +
        summary.costBucketsUpserted +
        summary.projectsUpserted +
        summary.actorsUpserted,
      metadata: metadata ? toJsonValue(metadata) : undefined,
    },
  });
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
  const [latestRuns, anthropicLive, openaiLive, geminiLive] = await Promise.all([
    prisma.providerSyncRun.findMany({
      where: { syncType: "telemetry" },
      orderBy: { startedAt: "desc" },
      take: 8,
    }),
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
  };
}

export async function syncAnthropicTelemetry(triggeredByUserId: string): Promise<SyncResult> {
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
    const today = new Date();
    const sevenDaysAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
    const startingAt = sevenDaysAgo.toISOString();
    const endingAt = today.toISOString();

    const managedSystemId = await resolveManagedSystemId(
      PROVIDER_MANAGED_SYSTEM_SETTINGS_KEYS.ANTHROPIC
    );

    const [org, keys, members, usageByModelAndKey, usageByKey, costReport] = await Promise.all([
      fetchAnthropicOrgData(),
      listAPIKeys({ status: "active", limit: 100 }).catch(() => null),
      listMembers({ limit: 100 }).catch(() => null),
      // Multi-dim group_by so each UsageBucket row is attributable to a
      // specific (model, api_key) pair. Without api_key_id in the grouping,
      // the api_key_id field on results comes back null and all keys'
      // traffic collides into one row per (model, day).
      getUsageReport({ starting_at: startingAt, ending_at: endingAt, group_by: ["model", "api_key_id"] }),
      // Kept for forensics / raw snapshot only — the flattened attribution
      // above supersedes this for UsageBucket writes.
      getUsageReport({ starting_at: startingAt, ending_at: endingAt, group_by: ["api_key_id"] }).catch(() => null),
      getCostReport({ starting_at: startingAt, ending_at: endingAt, group_by: ["description"] }).catch(() => null),
    ]);

    // Build id → name lookup for API keys so each UsageBucket row carries a
    // human-readable apiKeyName.
    const apiKeyNameById = new Map<string, string>();
    for (const key of asArray(asRecord(keys).data)) {
      const id = asString(key.id);
      const name = asString(key.name);
      if (id && name) apiKeyNameById.set(id, name);
    }

    let rawSnapshotsStored = 0;
    for (const [resourceType, payload] of Object.entries({
      org,
      keys,
      members,
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

    let projectsUpserted = 0;
    for (const key of asArray(asRecord(keys).data)) {
      const externalId = asString(key.id);
      if (!externalId) continue;

      await prisma.providerProject.upsert({
        where: { provider_externalId: { provider: "anthropic", externalId } },
        update: {
          name: asString(key.name),
          status: asString(key.status),
          metadata: toJsonValue(key),
          lastSeenAt: new Date(),
          syncRunId: syncRun.id,
        },
        create: {
          provider: "anthropic",
          externalId,
          name: asString(key.name),
          status: asString(key.status),
          metadata: toJsonValue(key),
          syncRunId: syncRun.id,
        },
      });
      projectsUpserted++;
    }

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
            inputTokens,
            outputTokens,
            totalTokens,
            cacheReadTokens,
            cacheCreationTokens,
            metadata: toJsonValue(entry),
            syncRunId: syncRun.id,
            aiSystemId: managedSystemId,
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
            inputTokens,
            outputTokens,
            totalTokens,
            cacheReadTokens,
            cacheCreationTokens,
            metadata: toJsonValue(entry),
            syncRunId: syncRun.id,
            aiSystemId: managedSystemId,
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
    //
    // The cost report returns many granular line items per (model, day):
    //   { model, cost_type, token_type, context_window, amount, ... }
    // e.g. opus may have 6+ entries for the same day (uncached input,
    // cache_read, cache_creation 5m/1h, output, across context windows).
    //
    // We aggregate these into one CostBucket row per (model, cost_type,
    // date) because the bucket table is for rollup reporting — line-item
    // detail is preserved in the raw ProviderRawSnapshot.
    //
    // IMPORTANT: `amount` is in CENTS (not USD). Verified empirically by
    // comparing API-reported costs against manual price-book calculations
    // on live token-count data: dividing by 100 yields an exact match with
    // published Anthropic pricing.
    for (const bucket of asArray(asRecord(costReport).data)) {
      const bucketStart = new Date(asString(bucket.starting_at) ?? startingAt);
      const bucketEnd = new Date(asString(bucket.ending_at) ?? endingAt);
      const date = bucketStart.toISOString().split("T")[0];

      // Aggregate entries by (model, cost_type) to avoid dimension-key
      // collisions where later entries silently overwrote earlier ones.
      // Sum in cents first, then convert to dollars once at the end.
      const costAgg = new Map<string, { model: string | null; lineItem: string; amountCents: number; currency: string }>();
      for (const entry of asArray(bucket.results)) {
        const amountCents = parseFloat(String(entry.amount) || "0");
        if (amountCents <= 0) continue;

        const model = asString(entry.model);
        const lineItem = asString(entry.cost_type) ?? "tokens";
        const aggKey = `${model ?? ""}|${lineItem}`;
        const existing = costAgg.get(aggKey);
        if (existing) {
          existing.amountCents += amountCents;
        } else {
          costAgg.set(aggKey, {
            model,
            lineItem,
            amountCents,
            currency: asString(entry.currency) ?? "usd",
          });
        }
      }

      for (const agg of costAgg.values()) {
        const dimensionKey = makeDimensionKey({ model: agg.model, lineItem: agg.lineItem, date });
        const amount = agg.amountCents / 100;

        await prisma.costBucket.upsert({
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
            amount,
            currency: agg.currency,
            model: agg.model,
            lineItem: agg.lineItem,
            syncRunId: syncRun.id,
          },
          create: {
            provider: "anthropic",
            bucketStart,
            bucketEnd,
            granularity: "day",
            dimensionKey,
            amount,
            currency: agg.currency,
            model: agg.model,
            lineItem: agg.lineItem,
            syncRunId: syncRun.id,
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

    await completeSyncRun(syncRun.id, summary, {
      coverage: {
        keys: asArray(asRecord(keys).data).length,
        members: asArray(asRecord(members).data).length,
      },
    });

    return { provider: "anthropic", success: true, syncRunId: syncRun.id, ...summary };
  } catch (error) {
    const errorMessage = await failSyncRun(syncRun.id, error);
    return { provider: "anthropic", success: false, error: errorMessage };
  }
}

export async function syncClaudeCodeAnalytics(triggeredByUserId: string): Promise<SyncResult> {
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
    const today = new Date();
    const sevenDaysAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
    const startDate = sevenDaysAgo.toISOString().split("T")[0];
    const endDate = today.toISOString().split("T")[0];

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

      // ONE bucket per user+day with productivity metrics only.
      // Token and cost data is NOT stored here — the regular Anthropic usage
      // sync already captures that. This avoids double-counting.
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

    await completeSyncRun(syncRun.id, summary, {
      entriesProcessed: entries.length,
      uniqueUsers: seenActors.size,
      dateRange: { startDate, endDate },
      daysRequested: rangeResult.daysRequested,
      daysSucceeded: rangeResult.daysSucceeded,
      daysFailed: rangeResult.daysFailed,
      fetchErrors: rangeResult.errors,
    });

    return { provider: "claude_code", success: true, syncRunId: syncRun.id, ...summary };
  } catch (error) {
    const errorMessage = await failSyncRun(syncRun.id, error);
    return { provider: "claude_code", success: false, error: errorMessage };
  }
}

// ─── Cursor (Admin API cost + usage) ─────────────────────
// Complements the OTel span pipeline (CursorSpan = activity, no cost). The
// Cursor hook carries no tokens/cost, so authoritative spend comes from the
// team Admin API. Daily-usage-data → per-user activity UsageBuckets;
// filtered-usage-events → per-day/model CostBuckets (chargedCents) + token
// enrichment; spend → per-member ProviderActor + cycle spend metadata. ~30-day
// API retention, so the scheduled sync builds history over time.
export async function syncCursorTelemetry(triggeredByUserId: string): Promise<SyncResult> {
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
    const today = new Date();
    const sevenDaysAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
    const startMs = startOfDayUtc(sevenDaysAgo).getTime();
    const endMs = today.getTime();

    const managedSystemId = await resolveManagedSystemId(
      PROVIDER_MANAGED_SYSTEM_SETTINGS_KEYS.CURSOR,
    );

    const [dailyRows, spend, events] = await Promise.all([
      getCursorDailyUsage(startMs, endMs),
      getCursorSpend().catch(() => ({ members: [], cycleStartMs: null })),
      getCursorUsageEvents(startMs, endMs).catch(() => []),
    ]);

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
      if (charged > 0) {
        const model = asString(ev.model);
        const k = `${day}|${model ?? ""}`;
        const c = costByDayModel.get(k) ?? { day, model, cents: 0 };
        c.cents += charged;
        costByDayModel.set(k, c);
      }
    }

    // ── UsageBucket per (user, day) from daily-usage-data ──
    let usageBucketsUpserted = 0;
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
          actorName: email ? email.split("@")[0] : actorId,
          inputTokens: tokenAgg?.input ?? 0,
          outputTokens: tokenAgg?.output ?? 0,
          totalTokens: tokenAgg ? tokenAgg.input + tokenAgg.output : 0,
          cacheReadTokens: tokenAgg?.cacheRead ?? 0,
          cacheCreationTokens: tokenAgg?.cacheCreation ?? 0,
          requestCount,
          aiSystemId: managedSystemId,
          metadata: toJsonValue(row),
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
          actorName: email ? email.split("@")[0] : actorId,
          inputTokens: tokenAgg?.input ?? 0,
          outputTokens: tokenAgg?.output ?? 0,
          totalTokens: tokenAgg ? tokenAgg.input + tokenAgg.output : 0,
          cacheReadTokens: tokenAgg?.cacheRead ?? 0,
          cacheCreationTokens: tokenAgg?.cacheCreation ?? 0,
          requestCount,
          aiSystemId: managedSystemId,
          metadata: toJsonValue(row),
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

    await completeSyncRun(syncRun.id, summary, {
      dailyRows: dailyRows.length,
      usageEvents: events.length,
      members: spend.members.length,
      dateRange: { startMs, endMs },
    });

    return { provider: "cursor", success: true, syncRunId: syncRun.id, ...summary };
  } catch (error) {
    const errorMessage = await failSyncRun(syncRun.id, error);
    return { provider: "cursor", success: false, error: errorMessage };
  }
}

export async function syncGeminiTelemetry(triggeredByUserId: string): Promise<SyncResult> {
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
    const rows = await getGeminiBillingRows(7);

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

    await completeSyncRun(syncRun.id, summary, {
      billingRows: rows.length,
    });

    return { provider: "gemini", success: true, syncRunId: syncRun.id, ...summary };
  } catch (error) {
    const errorMessage = await failSyncRun(syncRun.id, error);
    return { provider: "gemini", success: false, error: errorMessage };
  }
}

export async function syncOpenAITelemetry(triggeredByUserId: string): Promise<SyncResult> {
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
    const sevenDaysAgo = Math.floor(Date.now() / 1000) - 7 * 24 * 60 * 60;
    const now = Math.floor(Date.now() / 1000);

    const [usage, costs, assistants] = await Promise.all([
      getUsage({
        start_time: sevenDaysAgo,
        end_time: now,
        group_by: ["model", "project_id", "user_id", "api_key_id"],
        bucket_width: "1d",
      }),
      getCosts({
        start_time: sevenDaysAgo,
        end_time: now,
        bucket_width: "1d",
      }).catch(() => null),
      listAssistants({ limit: 100, order: "desc" }).catch(() => null),
    ]);

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
        const requestCount = asNumber(result.num_requests || result.request_count) || null;
        const dimensionKey = makeDimensionKey({
          model,
          projectExternalId,
          actorExternalId,
          apiKeyExternalId,
          date: bucketStart.toISOString(),
        });

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
            requestCount,
            metadata: toJsonValue(result),
            syncRunId: syncRun.id,
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
            requestCount,
            metadata: toJsonValue(result),
            syncRunId: syncRun.id,
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

    await completeSyncRun(syncRun.id, summary, {
      assistantsCount: asArray(asRecord(assistants).data).length,
    });

    return { provider: "openai", success: true, syncRunId: syncRun.id, ...summary };
  } catch (error) {
    const errorMessage = await failSyncRun(syncRun.id, error);
    return { provider: "openai", success: false, error: errorMessage };
  }
}

export async function syncOpenRouterTelemetry(triggeredByUserId: string): Promise<SyncResult> {
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
    const activity = await getOpenRouterActivity();
    const rows = normalizeOpenRouterActivityRows(activity);

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

    await completeSyncRun(syncRun.id, summary, {
      coverage: {
        rows: rows.length,
      },
    });

    return { provider: "openrouter", success: true, syncRunId: syncRun.id, ...summary };
  } catch (error) {
    const errorMessage = await failSyncRun(syncRun.id, error);
    return { provider: "openrouter", success: false, error: errorMessage };
  }
}

export async function syncPortkeyTelemetry(triggeredByUserId: string): Promise<SyncResult> {
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
    const end = new Date();
    const start = new Date(end.getTime() - 7 * 24 * 60 * 60 * 1000);
    const startTime = start.toISOString();
    const endTime = end.toISOString();
    const pageSize = 100;

    async function readGroupedPages(
      fetchPage: (args: { startTime: string; endTime: string; currentPage: number; pageSize: number }) => Promise<Record<string, unknown>>,
      labelKeys: string[],
    ) {
      const rows = [];
      for (let currentPage = 0; currentPage < 20; currentPage++) {
        const payload = await fetchPage({
          startTime,
          endTime,
          currentPage,
          pageSize,
        });
        const normalized = normalizePortkeyGroupedRows(payload, labelKeys);
        rows.push(...normalized);
        if (normalized.length < pageSize) break;
      }
      return rows;
    }

    const [modelRows, userRows, tokenPoints, costPoints] = await Promise.all([
      readGroupedPages(getPortkeyModelGroups, ["ai_model", "model"]),
      readGroupedPages(getPortkeyUserGroups, ["user", "metadata_value"]),
      getPortkeyTokensGraph({ startTime, endTime }).then(normalizePortkeyGraphPoints),
      getPortkeyCostGraph({ startTime, endTime }).then(normalizePortkeyGraphPoints),
    ]);

    await storeSnapshot(syncRun.id, "portkey", "model_groups", {
      rowCount: modelRows.length,
      sample: modelRows.slice(0, 10),
    });
    await storeSnapshot(syncRun.id, "portkey", "user_groups", {
      rowCount: userRows.length,
      sample: userRows.slice(0, 10),
    });
    await storeSnapshot(syncRun.id, "portkey", "token_graph", {
      points: tokenPoints.slice(0, 31),
    });
    await storeSnapshot(syncRun.id, "portkey", "cost_graph", {
      points: costPoints.slice(0, 31),
    });

    const rawSnapshotsStored = 4;
    let projectsUpserted = 0;
    let actorsUpserted = 0;
    let usageBucketsUpserted = 0;
    let costBucketsUpserted = 0;
    let apiUsageLogsCreated = 0;

    for (const row of modelRows) {
      if (!row.label) continue;
      await prisma.providerProject.upsert({
        where: {
          provider_externalId: { provider: "portkey", externalId: row.label },
        },
        update: {
          name: row.label,
          status: "active",
          metadata: toJsonValue({
            source: "portkey_analytics_api",
            requests: row.requests,
            cost: row.cost,
            totalTokens: row.totalTokens,
            promptTokens: row.promptTokens,
            completionTokens: row.completionTokens,
            lastSeenAt: row.lastSeenAt,
            raw: row.raw,
          }),
          lastSeenAt: new Date(),
          syncRunId: syncRun.id,
        },
        create: {
          provider: "portkey",
          externalId: row.label,
          name: row.label,
          status: "active",
          metadata: toJsonValue({
            source: "portkey_analytics_api",
            requests: row.requests,
            cost: row.cost,
            totalTokens: row.totalTokens,
            promptTokens: row.promptTokens,
            completionTokens: row.completionTokens,
            lastSeenAt: row.lastSeenAt,
            raw: row.raw,
          }),
          syncRunId: syncRun.id,
        },
      });
      projectsUpserted++;
    }

    for (const row of userRows) {
      if (!row.label) continue;
      await prisma.providerActor.upsert({
        where: {
          provider_externalId: { provider: "portkey", externalId: row.label },
        },
        update: {
          email: row.label.includes("@") ? row.label : null,
          name: row.label,
          metadata: toJsonValue({
            source: "portkey_analytics_api",
            requests: row.requests,
            cost: row.cost,
            totalTokens: row.totalTokens,
            raw: row.raw,
          }),
          lastSeenAt: new Date(),
          syncRunId: syncRun.id,
        },
        create: {
          provider: "portkey",
          externalId: row.label,
          email: row.label.includes("@") ? row.label : null,
          name: row.label,
          metadata: toJsonValue({
            source: "portkey_analytics_api",
            requests: row.requests,
            cost: row.cost,
            totalTokens: row.totalTokens,
            raw: row.raw,
          }),
          syncRunId: syncRun.id,
        },
      });
      actorsUpserted++;
    }

    const costByTimestamp = new Map(costPoints.map((point) => [point.timestamp, point.total / 100]));

    for (const point of tokenPoints) {
      const bucketStart = new Date(point.timestamp);
      if (Number.isNaN(bucketStart.getTime())) continue;
      const bucketEnd = new Date(bucketStart.getTime() + 24 * 60 * 60 * 1000);
      const date = bucketStart.toISOString().split("T")[0] ?? bucketStart.toISOString();
      const dimensionKey = makeDimensionKey({
        date,
        scope: "all",
      });
      const totalTokens = Math.max(0, Math.round(point.total));

      await prisma.usageBucket.upsert({
        where: {
          provider_bucketStart_bucketEnd_granularity_dimensionKey: {
            provider: "portkey",
            bucketStart,
            bucketEnd,
            granularity: "day",
            dimensionKey,
          },
        },
        update: {
          totalTokens,
          inputTokens: totalTokens,
          outputTokens: 0,
          requestCount: null,
          metadata: toJsonValue({
            source: "portkey_analytics_api",
            avgTokens: point.avg,
          }),
          syncRunId: syncRun.id,
        },
        create: {
          provider: "portkey",
          bucketStart,
          bucketEnd,
          granularity: "day",
          dimensionKey,
          inputTokens: totalTokens,
          outputTokens: 0,
          totalTokens,
          requestCount: null,
          metadata: toJsonValue({
            source: "portkey_analytics_api",
            avgTokens: point.avg,
          }),
          syncRunId: syncRun.id,
        },
      });
      usageBucketsUpserted++;

      const amount = costByTimestamp.get(point.timestamp) ?? 0;
      if (amount > 0) {
        await prisma.costBucket.upsert({
          where: {
            provider_bucketStart_bucketEnd_granularity_dimensionKey: {
              provider: "portkey",
              bucketStart,
              bucketEnd,
              granularity: "day",
              dimensionKey,
            },
          },
          update: {
            amount,
            currency: "usd",
            lineItem: "proxy",
            metadata: toJsonValue({
              source: "portkey_analytics_api",
            }),
            syncRunId: syncRun.id,
          },
          create: {
            provider: "portkey",
            bucketStart,
            bucketEnd,
            granularity: "day",
            dimensionKey,
            amount,
            currency: "usd",
            lineItem: "proxy",
            metadata: toJsonValue({
              source: "portkey_analytics_api",
            }),
            syncRunId: syncRun.id,
          },
        });
        costBucketsUpserted++;
      }

      const created = await upsertDerivedUsageLog({
        provider: "portkey",
        model: null,
        bucketDate: bucketStart,
        inputTokens: totalTokens,
        outputTokens: 0,
        totalTokens,
        cost: amount,
        metadata: {
          source: "portkey_analytics_api",
          syncRunId: syncRun.id,
          dimensionKey,
          provider: "portkey",
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

    await completeSyncRun(syncRun.id, summary, {
      coverage: {
        modelRows: modelRows.length,
        userRows: userRows.length,
        tokenPoints: tokenPoints.length,
        costPoints: costPoints.length,
      },
    });

    return { provider: "portkey", success: true, syncRunId: syncRun.id, ...summary };
  } catch (error) {
    const errorMessage = await failSyncRun(syncRun.id, error);
    return { provider: "portkey", success: false, error: errorMessage };
  }
}

export async function syncHeliconeTelemetry(triggeredByUserId: string): Promise<SyncResult> {
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
    const end = new Date();
    const start = new Date(end.getTime() - 7 * 24 * 60 * 60 * 1000);
    const allRows = [];
    const pageSize = 500;

    for (let page = 0; page < 20; page++) {
      const payload = await queryHeliconeRequests({
        startTime: start.toISOString(),
        endTime: end.toISOString(),
        offset: page * pageSize,
        limit: pageSize,
      });
      const rows = normalizeHeliconeRequestRows(payload);
      allRows.push(...rows);
      if (rows.length < pageSize) break;
    }

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

    await completeSyncRun(syncRun.id, summary, {
      coverage: {
        rows: allRows.length,
        uniqueActors: seenActors.size,
      },
    });

    return { provider: "helicone", success: true, syncRunId: syncRun.id, ...summary };
  } catch (error) {
    const errorMessage = await failSyncRun(syncRun.id, error);
    return { provider: "helicone", success: false, error: errorMessage };
  }
}

export async function syncLiteLLMTelemetry(triggeredByUserId: string): Promise<SyncResult> {
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
    const end = new Date();
    const start = new Date(end.getTime() - 7 * 24 * 60 * 60 * 1000);
    const payload = await queryLiteLLMSpendLogs({
      startDate: start.toISOString().slice(0, 10),
      endDate: end.toISOString().slice(0, 10),
    });
    const rows = normalizeLiteLLMSpendRows(payload);

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
            actorName: aggregate.actorName,
            lineItem: "proxy",
            metadata: toJsonValue({
              source: "litellm_spend_logs",
              upstream_provider: aggregate.upstreamProvider,
            }),
            syncRunId: syncRun.id,
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
            actorName: aggregate.actorName,
            lineItem: "proxy",
            metadata: toJsonValue({
              source: "litellm_spend_logs",
              upstream_provider: aggregate.upstreamProvider,
            }),
            syncRunId: syncRun.id,
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

    await completeSyncRun(syncRun.id, summary, {
      coverage: {
        rows: rows.length,
        uniqueActors: seenActors.size,
        uniqueTeams: seenTeams.size,
      },
    });

    return { provider: "litellm", success: true, syncRunId: syncRun.id, ...summary };
  } catch (error) {
    const errorMessage = await failSyncRun(syncRun.id, error);
    return { provider: "litellm", success: false, error: errorMessage };
  }
}
