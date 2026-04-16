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

type SyncSummary = {
  syncRunId: string;
  usageBucketsUpserted: number;
  costBucketsUpserted: number;
  rawSnapshotsStored: number;
  projectsUpserted: number;
  actorsUpserted: number;
  apiUsageLogsCreated: number;
};

type SyncProvider = "anthropic" | "openai" | "claude_code" | "gemini";

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
  provider: "claude" | "chatgpt";
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

    const [org, keys, members, usageByModel, usageByKey, costReport] = await Promise.all([
      fetchAnthropicOrgData(),
      listAPIKeys({ status: "active", limit: 100 }).catch(() => null),
      listMembers({ limit: 100 }).catch(() => null),
      getUsageReport({ starting_at: startingAt, ending_at: endingAt, group_by: ["model"] }),
      getUsageReport({ starting_at: startingAt, ending_at: endingAt, group_by: ["api_key_id"] }).catch(() => null),
      getCostReport({ starting_at: startingAt, ending_at: endingAt, group_by: ["description"] }).catch(() => null),
    ]);

    let rawSnapshotsStored = 0;
    for (const [resourceType, payload] of Object.entries({
      org,
      keys,
      members,
      usage_by_model: usageByModel,
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
    for (const bucket of asArray(asRecord(usageByModel).data)) {
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
            inputTokens,
            outputTokens,
            totalTokens,
            metadata: toJsonValue(entry),
            syncRunId: syncRun.id,
          },
          create: {
            provider: "anthropic",
            bucketStart,
            bucketEnd,
            granularity: "day",
            dimensionKey,
            model,
            apiKeyExternalId: apiKeyId,
            inputTokens,
            outputTokens,
            totalTokens,
            metadata: toJsonValue(entry),
            syncRunId: syncRun.id,
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
    // IMPORTANT: `amount` is in USD (not cents). Earlier code incorrectly
    // divided by 100, under-reporting costs by ~100×.
    for (const bucket of asArray(asRecord(costReport).data)) {
      const bucketStart = new Date(asString(bucket.starting_at) ?? startingAt);
      const bucketEnd = new Date(asString(bucket.ending_at) ?? endingAt);
      const date = bucketStart.toISOString().split("T")[0];

      // Aggregate entries by (model, cost_type) to avoid dimension-key
      // collisions where later entries silently overwrote earlier ones.
      const costAgg = new Map<string, { model: string | null; lineItem: string; amount: number; currency: string }>();
      for (const entry of asArray(bucket.results)) {
        const amount = parseFloat(String(entry.amount) || "0");
        if (amount <= 0) continue;

        const model = asString(entry.model);
        const lineItem = asString(entry.cost_type) ?? "tokens";
        const aggKey = `${model ?? ""}|${lineItem}`;
        const existing = costAgg.get(aggKey);
        if (existing) {
          existing.amount += amount;
        } else {
          costAgg.set(aggKey, {
            model,
            lineItem,
            amount,
            currency: asString(entry.currency) ?? "usd",
          });
        }
      }

      for (const agg of costAgg.values()) {
        const dimensionKey = makeDimensionKey({ model: agg.model, lineItem: agg.lineItem, date });

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
            amount: agg.amount,
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
            amount: agg.amount,
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
