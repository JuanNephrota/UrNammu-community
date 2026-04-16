import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withAuth } from "@/lib/auth-guard";
import {
  buildCostLookup,
  getBucketIdentityKey,
  getTelemetryAttributionLabel,
  buildTelemetryActivityRows,
  EXCLUDE_PROXY_DUPLICATES,
  EXCLUDE_PROXY_DUPLICATES_COST,
} from "@/lib/oversight-telemetry";

export async function GET(req: NextRequest) {
  return withAuth(async () => {
    const url = new URL(req.url);
    const now = new Date();

    // Parse date range (default: 30 days)
    const startDate = url.searchParams.get("startDate")
      ? new Date(url.searchParams.get("startDate")!)
      : new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const endDate = url.searchParams.get("endDate")
      ? new Date(url.searchParams.get("endDate")!)
      : now;

    // Parse optional filters
    const provider = url.searchParams.get("provider") || undefined;
    const model = url.searchParams.get("model") || undefined;
    const project = url.searchParams.get("project") || undefined;

    // Build where clauses. Proxy-written rows are excluded from aggregates —
    // admin-sync captures the same traffic at day granularity, so summing
    // both would double-count. See EXCLUDE_PROXY_DUPLICATES for details.
    const usageWhere: Record<string, unknown> = {
      bucketStart: { gte: startDate, lte: endDate },
      ...EXCLUDE_PROXY_DUPLICATES,
    };
    const costWhere: Record<string, unknown> = {
      bucketStart: { gte: startDate, lte: endDate },
      ...EXCLUDE_PROXY_DUPLICATES_COST,
    };
    if (provider) {
      usageWhere.provider = provider;
      costWhere.provider = provider;
    }
    if (model) {
      usageWhere.model = { contains: model, mode: "insensitive" };
      costWhere.model = { contains: model, mode: "insensitive" };
    }
    if (project) {
      usageWhere.OR = [
        { projectName: { contains: project, mode: "insensitive" } },
        { aiSystem: { name: { contains: project, mode: "insensitive" } } },
      ];
    }

    // Fetch data in parallel
    const [usageBuckets, costBuckets, allProviders, allModels, allProjects] =
      await Promise.all([
        prisma.usageBucket.findMany({
          where: usageWhere,
          orderBy: [{ bucketStart: "desc" }, { provider: "asc" }],
          take: 500,
          include: {
            aiSystem: {
              select: { id: true, name: true, vendor: true, department: true },
            },
          },
        }),
        prisma.costBucket.findMany({
          where: costWhere,
          orderBy: [{ bucketStart: "desc" }, { provider: "asc" }],
          take: 500,
        }),
        // Get all distinct providers/models/projects (unfiltered) for filter dropdowns
        prisma.usageBucket.groupBy({
          by: ["provider"],
          where: { bucketStart: { gte: new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000) } },
        }),
        prisma.usageBucket.groupBy({
          by: ["model"],
          where: {
            bucketStart: { gte: new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000) },
            model: { not: null },
          },
        }),
        prisma.usageBucket.groupBy({
          by: ["projectName"],
          where: {
            bucketStart: { gte: new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000) },
            projectName: { not: null },
          },
        }),
      ]);

    const costMap = buildCostLookup(costBuckets);

    // Summary aggregations — default totals exclude cache tokens so the
    // headline numbers reflect actual new token processing.
    const totalCacheReadTokens = usageBuckets.reduce((s, b) => s + b.cacheReadTokens, 0);
    const totalCacheCreationTokens = usageBuckets.reduce((s, b) => s + b.cacheCreationTokens, 0);
    const totalCacheTokens = totalCacheReadTokens + totalCacheCreationTokens;

    const totalTokens = usageBuckets.reduce((s, b) => s + b.totalTokens, 0) - totalCacheTokens;
    const totalInputTokens = usageBuckets.reduce((s, b) => s + b.inputTokens, 0) - totalCacheTokens;
    const totalOutputTokens = usageBuckets.reduce((s, b) => s + b.outputTokens, 0);

    const totalTokensWithCache = totalTokens + totalCacheTokens;
    const totalInputTokensWithCache = totalInputTokens + totalCacheTokens;
    const totalRequests = usageBuckets.reduce(
      (s, b) => s + (b.requestCount ?? 0),
      0
    );
    const totalCost = costBuckets.reduce((s, b) => s + b.amount, 0);
    const costPerRequest = totalRequests > 0 ? totalCost / totalRequests : 0;

    // Input/output cost split — weight output tokens 3x (typical LLM pricing)
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
    // Only forecast if we're looking at current month data
    const isCurrentMonth =
      startDate.getTime() <=
        new Date(now.getFullYear(), now.getMonth(), 1).getTime() &&
      endDate.getTime() >= now.getTime();
    const projectedMonthEndSpend =
      isCurrentMonth && elapsedPct > 0 ? totalCost / elapsedPct : null;

    // Daily usage for chart (grouped by date) — uncached tokens by default,
    // with cacheTokens available for the client-side toggle.
    const dailyMap = new Map<
      string,
      { date: string; tokens: number; cost: number; inputTokens: number; outputTokens: number; cacheTokens: number }
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

    // Daily cost breakdown for stacked bar chart
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
      { label: string; provider: string; tokens: number; cost: number; requests: number; inputTokens: number; outputTokens: number; cacheTokens: number }
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

    // Activity rows
    const activityRows = buildTelemetryActivityRows(usageBuckets, costMap, 60);

    return NextResponse.json({
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
    });
  });
}
