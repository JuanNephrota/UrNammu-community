import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/layout/page-header";
import {
  buildCostLookup,
  getBucketIdentityKey,
  getTelemetryAttributionLabel,
  buildTelemetryActivityRows,
  EXCLUDE_PROXY_DUPLICATES,
  EXCLUDE_PROXY_DUPLICATES_COST,
} from "@/lib/oversight-telemetry";
import { UsageDashboard } from "@/components/oversight/usage-dashboard";

export default async function UsageLogsPage({
  searchParams,
}: {
  searchParams: Promise<{ provider?: string; model?: string; project?: string; apiKey?: string }>;
}) {
  const params = await searchParams;
  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  // Build optional where-clause filters from URL search params so the
  // initial server-rendered data matches the pre-selected filter state.
  // Proxy-written rows are excluded — admin-sync captures the same traffic
  // at day granularity, so summing both double-counts.
  const bucketWhere: Record<string, unknown> = {
    bucketStart: { gte: thirtyDaysAgo },
    ...EXCLUDE_PROXY_DUPLICATES,
  };
  if (params.provider) bucketWhere.provider = params.provider;
  if (params.model) bucketWhere.model = params.model;
  if (params.project) bucketWhere.projectName = params.project;
  if (params.apiKey) {
    bucketWhere.OR = [
      { apiKeyExternalId: params.apiKey },
      { apiKeyName: params.apiKey },
    ];
  }

  // Fetch initial 30-day data + filter options in parallel
  const [usageBuckets, costBuckets, allProviders, allModels, allProjects, allApiKeys] =
    await Promise.all([
      prisma.usageBucket.findMany({
        where: bucketWhere,
        orderBy: [{ bucketStart: "desc" }, { provider: "asc" }],
        take: 500,
        include: {
          aiSystem: {
            select: {
              id: true,
              name: true,
              vendor: true,
              department: true,
            },
          },
        },
      }),
      prisma.costBucket.findMany({
        where: {
          bucketStart: { gte: thirtyDaysAgo },
          ...EXCLUDE_PROXY_DUPLICATES_COST,
          ...(params.provider ? { provider: params.provider } : {}),
        },
        orderBy: [{ bucketStart: "desc" }, { provider: "asc" }],
        take: 500,
      }),
      prisma.usageBucket.groupBy({
        by: ["provider"],
        where: {
          bucketStart: {
            gte: new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000),
          },
        },
      }),
      prisma.usageBucket.groupBy({
        by: ["model"],
        where: {
          bucketStart: {
            gte: new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000),
          },
          model: { not: null },
        },
      }),
      prisma.usageBucket.groupBy({
        by: ["projectName"],
        where: {
          bucketStart: {
            gte: new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000),
          },
          projectName: { not: null },
        },
      }),
      prisma.usageBucket.groupBy({
        by: ["apiKeyExternalId", "apiKeyName"],
        where: {
          bucketStart: {
            gte: new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000),
          },
          apiKeyExternalId: { not: null },
        },
      }),
    ]);

  const costMap = buildCostLookup(costBuckets);

  // Build summary — default totals exclude cache tokens (cache reads +
  // cache creation). The "include cached" filter on the dashboard toggles
  // between uncached and full totals client-side.
  const totalCacheReadTokens = usageBuckets.reduce(
    (s, b) => s + b.cacheReadTokens,
    0
  );
  const totalCacheCreationTokens = usageBuckets.reduce(
    (s, b) => s + b.cacheCreationTokens,
    0
  );
  const totalCacheTokens = totalCacheReadTokens + totalCacheCreationTokens;

  const totalTokens = usageBuckets.reduce((s, b) => s + b.totalTokens, 0) - totalCacheTokens;
  const totalInputTokens = usageBuckets.reduce(
    (s, b) => s + b.inputTokens,
    0
  ) - totalCacheTokens;
  const totalOutputTokens = usageBuckets.reduce(
    (s, b) => s + b.outputTokens,
    0
  );

  // Full totals including cache (passed separately for the filter toggle)
  const totalTokensWithCache = totalTokens + totalCacheTokens;
  const totalInputTokensWithCache = totalInputTokens + totalCacheTokens;
  const totalRequests = usageBuckets.reduce(
    (s, b) => s + (b.requestCount ?? 0),
    0
  );
  const totalCost = costBuckets.reduce((s, b) => s + b.amount, 0);
  const costPerRequest = totalRequests > 0 ? totalCost / totalRequests : 0;

  // Input/output cost split (weighted: output tokens ~3x more expensive)
  const weightedInput = totalInputTokens;
  const weightedOutput = totalOutputTokens * 3;
  const weightedTotal = weightedInput + weightedOutput;
  const inputTokenCost =
    weightedTotal > 0 ? totalCost * (weightedInput / weightedTotal) : 0;
  const outputTokenCost =
    weightedTotal > 0 ? totalCost * (weightedOutput / weightedTotal) : 0;

  // Monthly forecast
  const daysInMonth = new Date(
    now.getFullYear(),
    now.getMonth() + 1,
    0
  ).getDate();
  const currentDay = Math.min(daysInMonth, now.getDate());
  const elapsedPct = currentDay / daysInMonth;
  const projectedMonthEndSpend =
    elapsedPct > 0 ? totalCost / elapsedPct : null;

  // Daily usage — track both uncached and cache tokens so the dashboard
  // can toggle between views client-side.
  const dailyMap = new Map<
    string,
    {
      date: string;
      tokens: number;
      cost: number;
      inputTokens: number;
      outputTokens: number;
      cacheTokens: number;
    }
  >();
  for (const bucket of usageBuckets) {
    const dateKey = bucket.bucketStart.toISOString().slice(0, 10);
    const bucketCacheTokens = bucket.cacheReadTokens + bucket.cacheCreationTokens;
    const existing = dailyMap.get(dateKey) ?? {
      date: dateKey,
      tokens: 0,
      cost: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheTokens: 0,
    };
    existing.tokens += bucket.totalTokens - bucketCacheTokens;
    existing.inputTokens += bucket.inputTokens - bucketCacheTokens;
    existing.outputTokens += bucket.outputTokens;
    existing.cacheTokens += bucketCacheTokens;
    existing.cost += costMap.get(getBucketIdentityKey(bucket)) ?? 0;
    dailyMap.set(dateKey, existing);
  }
  const dailyUsage = [...dailyMap.values()].sort((a, b) =>
    a.date.localeCompare(b.date)
  );

  // Daily cost breakdown
  const dailyCostBreakdown = dailyUsage.map((d) => {
    const dayWeightedInput = d.inputTokens;
    const dayWeightedOutput = d.outputTokens * 3;
    const dayWeightedTotal = dayWeightedInput + dayWeightedOutput;
    return {
      date: d.date,
      inputCost:
        dayWeightedTotal > 0
          ? d.cost * (dayWeightedInput / dayWeightedTotal)
          : 0,
      outputCost:
        dayWeightedTotal > 0
          ? d.cost * (dayWeightedOutput / dayWeightedTotal)
          : 0,
      totalCost: d.cost,
    };
  });

  // Top models
  const modelMap = new Map<
    string,
    {
      label: string;
      provider: string;
      tokens: number;
      cost: number;
      requests: number;
      inputTokens: number;
      outputTokens: number;
      cacheTokens: number;
    }
  >();
  for (const bucket of usageBuckets) {
    const key = `${bucket.provider}:${bucket.model ?? "unknown"}`;
    const bucketCacheTokens = bucket.cacheReadTokens + bucket.cacheCreationTokens;
    const item = modelMap.get(key) ?? {
      label: bucket.model ?? "Unspecified model",
      provider: bucket.provider,
      tokens: 0,
      cost: 0,
      requests: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheTokens: 0,
    };
    item.tokens += bucket.totalTokens - bucketCacheTokens;
    item.inputTokens += bucket.inputTokens - bucketCacheTokens;
    item.outputTokens += bucket.outputTokens;
    item.cacheTokens += bucketCacheTokens;
    item.cost += costMap.get(getBucketIdentityKey(bucket)) ?? 0;
    item.requests += bucket.requestCount ?? 0;
    modelMap.set(key, item);
  }
  const topModels = [...modelMap.values()]
    .sort((a, b) => b.tokens - a.tokens)
    .slice(0, 8);

  // Top projects
  const projectMap = new Map<
    string,
    { label: string; tokens: number; cost: number; providers: string[]; cacheTokens: number }
  >();
  for (const bucket of usageBuckets) {
    const label = getTelemetryAttributionLabel(bucket, bucket.aiSystem?.name);
    const bucketCacheTokens = bucket.cacheReadTokens + bucket.cacheCreationTokens;
    const item = projectMap.get(label) ?? {
      label,
      tokens: 0,
      cost: 0,
      providers: [],
      cacheTokens: 0,
    };
    item.tokens += bucket.totalTokens - bucketCacheTokens;
    item.cacheTokens += bucketCacheTokens;
    item.cost += costMap.get(getBucketIdentityKey(bucket)) ?? 0;
    if (!item.providers.includes(bucket.provider)) {
      item.providers.push(bucket.provider);
    }
    projectMap.set(label, item);
  }
  const topProjects = [...projectMap.values()]
    .sort((a, b) => b.tokens - a.tokens)
    .slice(0, 8);

  // Top API keys — exact tokens, estimated cost via token-share apportionment
  // within (provider, model, day). See /api/oversight/usage/route.ts for rationale.
  const costByModelDay = new Map<string, number>();
  for (const c of costBuckets) {
    const k = `${c.provider}|${c.model ?? ""}|${c.bucketStart.toISOString().slice(0, 10)}`;
    costByModelDay.set(k, (costByModelDay.get(k) ?? 0) + c.amount);
  }
  const tokensByModelDay = new Map<string, number>();
  for (const b of usageBuckets) {
    const k = `${b.provider}|${b.model ?? ""}|${b.bucketStart.toISOString().slice(0, 10)}`;
    tokensByModelDay.set(k, (tokensByModelDay.get(k) ?? 0) + b.totalTokens);
  }
  const apiKeyMap = new Map<
    string,
    {
      externalId: string;
      name: string | null;
      provider: string;
      tokens: number;
      cacheTokens: number;
      estimatedCost: number;
      requests: number;
    }
  >();
  for (const bucket of usageBuckets) {
    const externalId = bucket.apiKeyExternalId;
    if (!externalId) continue;
    const bucketCacheTokens = bucket.cacheReadTokens + bucket.cacheCreationTokens;
    const dayKey = `${bucket.provider}|${bucket.model ?? ""}|${bucket.bucketStart.toISOString().slice(0, 10)}`;
    const dayTotalTokens = tokensByModelDay.get(dayKey) ?? 0;
    const dayCost = costByModelDay.get(dayKey) ?? 0;
    const share = dayTotalTokens > 0 ? bucket.totalTokens / dayTotalTokens : 0;
    const item = apiKeyMap.get(externalId) ?? {
      externalId,
      name: bucket.apiKeyName,
      provider: bucket.provider,
      tokens: 0,
      cacheTokens: 0,
      estimatedCost: 0,
      requests: 0,
    };
    if (!item.name && bucket.apiKeyName) item.name = bucket.apiKeyName;
    item.tokens += bucket.totalTokens;
    item.cacheTokens += bucketCacheTokens;
    item.estimatedCost += dayCost * share;
    item.requests += bucket.requestCount ?? 0;
    apiKeyMap.set(externalId, item);
  }
  const topApiKeys = [...apiKeyMap.values()]
    .sort((a, b) => b.tokens - a.tokens)
    .slice(0, 8);

  // Activity rows
  const activityRows = buildTelemetryActivityRows(usageBuckets, costMap, 60);

  const defaultStartDate = thirtyDaysAgo.toISOString().slice(0, 10);
  const defaultEndDate = now.toISOString().slice(0, 10);

  const initialData = {
    summary: {
      totalTokens,
      totalInputTokens,
      totalOutputTokens,
      totalRequests,
      totalCost,
      costPerRequest,
      inputTokenCost,
      outputTokenCost,
      projectedMonthEndSpend,
      totalCacheTokens,
      totalTokensWithCache,
      totalInputTokensWithCache,
      totalCacheReadTokens,
      totalCacheCreationTokens,
    },
    dailyUsage,
    dailyCostBreakdown,
    topModels,
    topProjects,
    topApiKeys,
    activityRows: activityRows.map((r) => ({
      ...r,
      date: r.date.toISOString(),
    })),
    filterOptions: {
      providers: allProviders.map((p) => p.provider).sort(),
      models: allModels
        .map((m) => m.model)
        .filter(Boolean)
        .sort() as string[],
      projects: allProjects
        .map((p) => p.projectName)
        .filter(Boolean)
        .sort() as string[],
      apiKeys: allApiKeys
        .filter((k) => k.apiKeyExternalId)
        .map((k) => ({
          externalId: k.apiKeyExternalId as string,
          name: k.apiKeyName,
        }))
        .sort((a, b) => (a.name ?? a.externalId).localeCompare(b.name ?? b.externalId)),
    },
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Usage Telemetry"
        description="Provider usage, cost breakdown, and attribution drill-down with time range and filter controls"
      />
      <UsageDashboard
        initialData={initialData}
        initialFilters={{
          startDate: defaultStartDate,
          endDate: defaultEndDate,
          provider: params.provider ?? "",
          model: params.model ?? "",
          project: params.project ?? "",
          apiKey: params.apiKey ?? "",
        }}
      />
    </div>
  );
}
