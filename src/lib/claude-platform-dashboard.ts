import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { isAnthropicAdminConfigured } from "@/lib/anthropic-admin";
import {
  EXCLUDE_PROXY_DUPLICATES,
  EXCLUDE_PROXY_DUPLICATES_COST,
  EXCLUDE_PROXY_DUPLICATES_SQL,
} from "@/lib/oversight-telemetry";

// Data layer for the Claude Platform oversight page. Sourced entirely from the
// Anthropic Admin API sync (syncAnthropicTelemetry → provider="anthropic"):
//   - UsageBucket   tokens per (model × API key), daily
//   - CostBucket    USD per (model × cost-type line-item), daily
//   - ProviderActor org members
//   - ProviderProject  API keys (active, from listAPIKeys status="active")
//   - ProviderSyncRun  telemetry sync health
//
// All aggregate queries exclude proxy-duplicated rows so totals reconcile with
// the authoritative admin-sync (day granularity) — see oversight-telemetry.ts.

export const CLAUDE_PLATFORM_PROVIDER = "anthropic";
const WINDOW_DAYS = 30;

function windowStart(): Date {
  return new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000);
}

export interface ClaudePlatformDashboard {
  configured: boolean;
  hasData: boolean;
  windowDays: number;
  summary: {
    totalCost: number;
    totalTokens: number; // includes cache reads + cache creation
    inputTokens: number;
    outputTokens: number;
    cachedTokens: number; // cacheRead + cacheCreation
    cacheReadTokens: number;
    cacheHitRate: number | null; // cacheRead / inputTokens, 0..1
    requests: number | null;
    activeApiKeys: number;
    orgMembers: number;
  };
  dailyUsage: { date: string; tokens: number; cost: number }[];
  costByModel: { model: string; amount: number }[];
  costByLineItem: { lineItem: string; amount: number }[];
  tokensByModel: {
    model: string;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheCreationTokens: number;
    totalTokens: number;
  }[];
  usageByApiKey: {
    apiKeyExternalId: string | null;
    apiKeyName: string | null;
    totalTokens: number;
    requests: number | null;
    status: string | null;
  }[];
  members: { id: string; name: string | null; email: string | null; role: string | null }[];
  sync: {
    lastRunAt: Date | null;
    lastSuccessAt: Date | null;
    fresh: boolean; // last success within 24h
    status: string | null;
    errorMessage: string | null;
  } | null;
}

export async function loadClaudePlatformDashboard(): Promise<ClaudePlatformDashboard> {
  const since = windowStart();
  const provider = CLAUDE_PLATFORM_PROVIDER;

  const usageWhere: Prisma.UsageBucketWhereInput = {
    provider,
    bucketStart: { gte: since },
    ...EXCLUDE_PROXY_DUPLICATES,
  };
  const costWhere: Prisma.CostBucketWhereInput = {
    provider,
    bucketStart: { gte: since },
    ...EXCLUDE_PROXY_DUPLICATES_COST,
  };

  const [
    configured,
    usageAgg,
    costAgg,
    activeApiKeys,
    orgMembers,
    dailyTokensRaw,
    dailyCostRaw,
    costByModelRows,
    costByLineItemRows,
    tokensByModelRows,
    usageByApiKeyRows,
    apiKeyProjects,
    members,
    syncRuns,
  ] = await Promise.all([
    isAnthropicAdminConfigured(),
    prisma.usageBucket.aggregate({
      where: usageWhere,
      _sum: {
        inputTokens: true,
        outputTokens: true,
        totalTokens: true,
        cacheReadTokens: true,
        cacheCreationTokens: true,
        requestCount: true,
      },
    }),
    prisma.costBucket.aggregate({
      where: costWhere,
      _sum: { amount: true },
    }),
    prisma.providerProject.count({ where: { provider } }),
    prisma.providerActor.count({ where: { provider } }),
    // Cast DATE() to text so Postgres returns 'YYYY-MM-DD' strings, not JS
    // Date objects — string keys are required for the day-merge below to
    // dedupe correctly (Date objects compare by reference, not value).
    prisma.$queryRaw<{ date: string; tokens: bigint }[]>`
      SELECT DATE("bucketStart")::text AS date, SUM("totalTokens")::bigint AS tokens
      FROM "UsageBucket"
      WHERE provider = ${provider}
        AND "bucketStart" >= ${since}
        AND ${EXCLUDE_PROXY_DUPLICATES_SQL}
      GROUP BY DATE("bucketStart")
      ORDER BY date ASC
    `,
    prisma.$queryRaw<{ date: string; cost: number }[]>`
      SELECT DATE("bucketStart")::text AS date, SUM("amount")::float AS cost
      FROM "CostBucket"
      WHERE provider = ${provider}
        AND "bucketStart" >= ${since}
        AND ${EXCLUDE_PROXY_DUPLICATES_SQL}
      GROUP BY DATE("bucketStart")
      ORDER BY date ASC
    `,
    prisma.costBucket.groupBy({
      by: ["model"],
      where: costWhere,
      _sum: { amount: true },
      orderBy: { _sum: { amount: "desc" } },
      take: 12,
    }),
    prisma.costBucket.groupBy({
      by: ["lineItem"],
      where: costWhere,
      _sum: { amount: true },
      orderBy: { _sum: { amount: "desc" } },
      take: 12,
    }),
    prisma.usageBucket.groupBy({
      by: ["model"],
      where: usageWhere,
      _sum: {
        inputTokens: true,
        outputTokens: true,
        cacheReadTokens: true,
        cacheCreationTokens: true,
        totalTokens: true,
      },
      orderBy: { _sum: { totalTokens: "desc" } },
      take: 12,
    }),
    prisma.usageBucket.groupBy({
      by: ["apiKeyExternalId", "apiKeyName"],
      where: usageWhere,
      _sum: { totalTokens: true, requestCount: true },
      orderBy: { _sum: { totalTokens: "desc" } },
      take: 20,
    }),
    prisma.providerProject.findMany({
      where: { provider },
      select: { externalId: true, status: true },
    }),
    prisma.providerActor.findMany({
      where: { provider },
      orderBy: [{ name: "asc" }, { email: "asc" }],
      take: 100,
      select: { id: true, name: true, email: true, role: true },
    }),
    prisma.providerSyncRun.findMany({
      where: { provider, syncType: "telemetry" },
      orderBy: { startedAt: "desc" },
      take: 10,
      select: { startedAt: true, completedAt: true, status: true, errorMessage: true },
    }),
  ]);

  const inputTokens = usageAgg._sum.inputTokens ?? 0;
  const outputTokens = usageAgg._sum.outputTokens ?? 0;
  const totalTokens = usageAgg._sum.totalTokens ?? 0;
  const cacheReadTokens = usageAgg._sum.cacheReadTokens ?? 0;
  const cacheCreationTokens = usageAgg._sum.cacheCreationTokens ?? 0;
  const cachedTokens = cacheReadTokens + cacheCreationTokens;
  const requestSum = usageAgg._sum.requestCount ?? 0;

  // Merge the two raw day series into the { date, tokens, cost } shape the
  // shared UsageChart expects.
  const costByDate = new Map(dailyCostRaw.map((r) => [r.date, r.cost]));
  const tokensByDate = new Map(dailyTokensRaw.map((r) => [r.date, Number(r.tokens)]));
  const allDates = new Set<string>([...tokensByDate.keys(), ...costByDate.keys()]);
  const dailyUsage = [...allDates]
    .sort()
    .map((date) => ({
      date,
      tokens: tokensByDate.get(date) ?? 0,
      cost: costByDate.get(date) ?? 0,
    }));

  const statusByKeyId = new Map(apiKeyProjects.map((p) => [p.externalId, p.status]));
  const lastSuccessAt = syncRuns.find((r) => r.status === "SUCCEEDED")?.completedAt ?? null;

  return {
    configured,
    hasData: totalTokens > 0 || (costAgg._sum.amount ?? 0) > 0,
    windowDays: WINDOW_DAYS,
    summary: {
      totalCost: costAgg._sum.amount ?? 0,
      totalTokens,
      inputTokens,
      outputTokens,
      cachedTokens,
      cacheReadTokens,
      cacheHitRate: inputTokens > 0 ? cacheReadTokens / inputTokens : null,
      requests: requestSum > 0 ? requestSum : null,
      activeApiKeys,
      orgMembers,
    },
    dailyUsage,
    costByModel: costByModelRows.map((r) => ({
      model: r.model ?? "Unknown",
      amount: r._sum.amount ?? 0,
    })),
    costByLineItem: costByLineItemRows.map((r) => ({
      lineItem: r.lineItem ?? "tokens",
      amount: r._sum.amount ?? 0,
    })),
    tokensByModel: tokensByModelRows.map((r) => ({
      model: r.model ?? "Unknown",
      inputTokens: r._sum.inputTokens ?? 0,
      outputTokens: r._sum.outputTokens ?? 0,
      cacheReadTokens: r._sum.cacheReadTokens ?? 0,
      cacheCreationTokens: r._sum.cacheCreationTokens ?? 0,
      totalTokens: r._sum.totalTokens ?? 0,
    })),
    usageByApiKey: usageByApiKeyRows.map((r) => ({
      apiKeyExternalId: r.apiKeyExternalId,
      apiKeyName: r.apiKeyName,
      totalTokens: r._sum.totalTokens ?? 0,
      requests: (r._sum.requestCount ?? 0) > 0 ? r._sum.requestCount : null,
      status: r.apiKeyExternalId ? statusByKeyId.get(r.apiKeyExternalId) ?? null : null,
    })),
    members,
    sync:
      syncRuns.length === 0
        ? null
        : {
            lastRunAt: syncRuns[0].startedAt,
            lastSuccessAt,
            fresh:
              !!lastSuccessAt &&
              Date.now() - new Date(lastSuccessAt).getTime() <= 24 * 60 * 60 * 1000,
            status: syncRuns[0].status,
            errorMessage: syncRuns.find((r) => r.status === "FAILED")?.errorMessage ?? null,
          },
  };
}
