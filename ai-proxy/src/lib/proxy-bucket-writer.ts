import { prisma } from "./db";

/**
 * Mirror of `src/lib/proxy-bucket-writer.ts` in the main Nammu app.
 * See that file for full rationale.
 *
 * The two projects don't share code, so keep them in sync by convention.
 */

type WriteParams = {
  /** Normalized bucket provider — see `bucketProviderFor` in proxy-providers.ts. */
  provider: string;
  model: string;
  userEmail: string | null;
  department: string | null;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  /**
   * Prompt-cache breakdown. `promptTokens` already INCLUDES these (it is the
   * total input the provider processed); they are stored separately so the
   * dashboards can show cache hit rates. See `model-pricing.ts` for the
   * convention.
   */
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
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
        cacheReadTokens: { increment: params.cacheReadTokens ?? 0 },
        cacheCreationTokens: { increment: params.cacheCreationTokens ?? 0 },
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
        cacheReadTokens: params.cacheReadTokens ?? 0,
        cacheCreationTokens: params.cacheCreationTokens ?? 0,
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
          // Same late-attribution rule as the usage row above: an identified
          // request fills in actor/system on a bucket first written anonymously.
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
          amount: params.cost,
          currency: "usd",
          model: params.model,
          actorName: params.userEmail ?? undefined,
          actorExternalId: params.userEmail ?? undefined,
          lineItem: "proxy",
          syncRunId,
          aiSystemId: params.aiSystemId ?? undefined,
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
