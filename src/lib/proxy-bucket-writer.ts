import { prisma } from "./prisma";

/**
 * Writes proxy-observed usage into the normalized `UsageBucket` / `CostBucket`
 * tables alongside the legacy `APIUsageLog`. This closes the gap where proxy
 * traffic only appeared on the legacy usage page and not on the main Oversight
 * dashboard (which reads the normalized tables).
 *
 * Bucketing strategy
 * ------------------
 * - Granularity: hourly (`"1h"`). One proxy call increments the bucket for
 *   its hour; many calls within the same hour accumulate into a single row.
 * - Dimension key: `source=proxy | model=<model> | actor=<email>`. This keeps
 *   per-actor attribution without exploding row counts.
 * - Parent `ProviderSyncRun`: one synthetic run per (provider, hour) with
 *   `syncType: "proxy_live"` and `status: "SUCCEEDED"`. Shared by every bucket
 *   written in that hour, so the normalized tables stay self-consistent
 *   without creating a run per request.
 * - Provider naming: `"anthropic"` / `"openai"` to match the admin-sync
 *   convention so proxy rows roll up into the same provider totals on
 *   Oversight. (Legacy `APIUsageLog` continues to use `"claude"` / `"chatgpt"`
 *   for backward compatibility.)
 *
 * All writes are best-effort: failures are caught and logged so that a proxy
 * request never fails because of a telemetry write.
 */

type WriteParams = {
  provider: "anthropic" | "openai";
  model: string;
  userEmail: string | null;
  department: string | null;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cost: number;
  aiSystemId?: string | null;
  at?: Date;
};

function hourStart(d: Date): Date {
  const x = new Date(d);
  x.setUTCMinutes(0, 0, 0);
  return x;
}

function makeDimensionKey(parts: Record<string, string | null | undefined>): string {
  return Object.entries(parts)
    .filter(([, value]) => !!value)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("|") || "all";
}

async function getOrCreateProxyRun(provider: string, bucketStart: Date): Promise<string> {
  const bucketEnd = new Date(bucketStart.getTime() + 3_600_000);
  const existing = await prisma.providerSyncRun.findFirst({
    where: {
      provider,
      syncType: "proxy_live",
      startedAt: { gte: bucketStart, lt: bucketEnd },
    },
    select: { id: true },
    orderBy: { startedAt: "desc" },
  });
  if (existing) return existing.id;

  const created = await prisma.providerSyncRun.create({
    data: {
      provider,
      syncType: "proxy_live",
      status: "SUCCEEDED",
      startedAt: bucketStart,
      completedAt: new Date(),
      metadata: { source: "proxy" },
    },
    select: { id: true },
  });
  return created.id;
}

export async function writeProxyUsageBucket(params: WriteParams): Promise<void> {
  try {
    const now = params.at ?? new Date();
    const start = hourStart(now);
    const end = new Date(start.getTime() + 3_600_000);
    // Include department in the dimension key so usage from different
    // departments doesn't merge into one bucket (losing attribution).
    const dimensionKey = makeDimensionKey({
      source: "proxy",
      model: params.model,
      actor: params.userEmail ?? undefined,
      department: params.department ?? undefined,
    });
    const syncRunId = await getOrCreateProxyRun(params.provider, start);

    await prisma.usageBucket.upsert({
      where: {
        provider_bucketStart_bucketEnd_granularity_dimensionKey: {
          provider: params.provider,
          bucketStart: start,
          bucketEnd: end,
          granularity: "1h",
          dimensionKey,
        },
      },
      update: {
        inputTokens: { increment: params.promptTokens },
        outputTokens: { increment: params.completionTokens },
        totalTokens: { increment: params.totalTokens },
        requestCount: { increment: 1 },
        // Ensure actor fields are populated even if the first request in
        // this hourly window was anonymous — a later identified request
        // should still fill in the attribution.
        ...(params.userEmail ? {
          actorName: params.userEmail,
          actorExternalId: params.userEmail,
        } : {}),
        ...(params.aiSystemId ? { aiSystemId: params.aiSystemId } : {}),
      },
      create: {
        provider: params.provider,
        bucketStart: start,
        bucketEnd: end,
        granularity: "1h",
        dimensionKey,
        model: params.model,
        actorName: params.userEmail ?? undefined,
        actorExternalId: params.userEmail ?? undefined,
        inputTokens: params.promptTokens,
        outputTokens: params.completionTokens,
        totalTokens: params.totalTokens,
        requestCount: 1,
        syncRunId,
        aiSystemId: params.aiSystemId ?? undefined,
        metadata: {
          source: "proxy",
          department: params.department ?? undefined,
        },
      },
    });

    if (params.cost > 0) {
      await prisma.costBucket.upsert({
        where: {
          provider_bucketStart_bucketEnd_granularity_dimensionKey: {
            provider: params.provider,
            bucketStart: start,
            bucketEnd: end,
            granularity: "1h",
            dimensionKey,
          },
        },
        update: {
          amount: { increment: params.cost },
        },
        create: {
          provider: params.provider,
          bucketStart: start,
          bucketEnd: end,
          granularity: "1h",
          dimensionKey,
          amount: params.cost,
          currency: "usd",
          model: params.model,
          actorName: params.userEmail ?? undefined,
          lineItem: "proxy",
          syncRunId,
          metadata: {
            source: "proxy",
            department: params.department ?? undefined,
          },
        },
      });
    }
  } catch (err) {
    console.error("Failed to write proxy usage bucket:", err);
  }
}
