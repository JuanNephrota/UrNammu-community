import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/layout/page-header";
import {
  buildCostLookup,
  getBucketIdentityKey,
  getTelemetryAttributionLabel,
  buildTelemetryActivityRows,
} from "@/lib/oversight-telemetry";
import { UsageDashboard } from "@/components/oversight/usage-dashboard";

export default async function UsageLogsPage() {
  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  // Fetch initial 30-day data + filter options in parallel
  const [usageBuckets, costBuckets, allProviders, allModels, allProjects] =
    await Promise.all([
      prisma.usageBucket.findMany({
        where: { bucketStart: { gte: thirtyDaysAgo } },
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
        where: { bucketStart: { gte: thirtyDaysAgo } },
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
    ]);

  const costMap = buildCostLookup(costBuckets);

  // Build summary
  const totalTokens = usageBuckets.reduce((s, b) => s + b.totalTokens, 0);
  const totalInputTokens = usageBuckets.reduce(
    (s, b) => s + b.inputTokens,
    0
  );
  const totalOutputTokens = usageBuckets.reduce(
    (s, b) => s + b.outputTokens,
    0
  );
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

  // Daily usage
  const dailyMap = new Map<
    string,
    {
      date: string;
      tokens: number;
      cost: number;
      inputTokens: number;
      outputTokens: number;
    }
  >();
  for (const bucket of usageBuckets) {
    const dateKey = bucket.bucketStart.toISOString().slice(0, 10);
    const existing = dailyMap.get(dateKey) ?? {
      date: dateKey,
      tokens: 0,
      cost: 0,
      inputTokens: 0,
      outputTokens: 0,
    };
    existing.tokens += bucket.totalTokens;
    existing.inputTokens += bucket.inputTokens;
    existing.outputTokens += bucket.outputTokens;
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
    }
  >();
  for (const bucket of usageBuckets) {
    const key = `${bucket.provider}:${bucket.model ?? "unknown"}`;
    const item = modelMap.get(key) ?? {
      label: bucket.model ?? "Unspecified model",
      provider: bucket.provider,
      tokens: 0,
      cost: 0,
      requests: 0,
      inputTokens: 0,
      outputTokens: 0,
    };
    item.tokens += bucket.totalTokens;
    item.inputTokens += bucket.inputTokens;
    item.outputTokens += bucket.outputTokens;
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
    { label: string; tokens: number; cost: number; providers: string[] }
  >();
  for (const bucket of usageBuckets) {
    const label = getTelemetryAttributionLabel(bucket, bucket.aiSystem?.name);
    const item = projectMap.get(label) ?? {
      label,
      tokens: 0,
      cost: 0,
      providers: [],
    };
    item.tokens += bucket.totalTokens;
    item.cost += costMap.get(getBucketIdentityKey(bucket)) ?? 0;
    if (!item.providers.includes(bucket.provider)) {
      item.providers.push(bucket.provider);
    }
    projectMap.set(label, item);
  }
  const topProjects = [...projectMap.values()]
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
    },
    dailyUsage,
    dailyCostBreakdown,
    topModels,
    topProjects,
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
          provider: "",
          model: "",
          project: "",
        }}
      />
    </div>
  );
}
