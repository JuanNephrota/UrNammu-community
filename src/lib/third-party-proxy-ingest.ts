import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "./prisma";

function toJsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function makeDimensionKey(parts: Record<string, string | null | undefined>): string {
  return Object.entries(parts)
    .filter(([, value]) => !!value)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("|") || "all";
}

function normalizeBucketDate(value: Date, granularity: string): { bucketStart: Date; bucketEnd: Date } {
  const bucketStart = new Date(value);

  if (granularity === "1h") {
    bucketStart.setUTCMinutes(0, 0, 0);
    return {
      bucketStart,
      bucketEnd: new Date(bucketStart.getTime() + 60 * 60 * 1000),
    };
  }

  bucketStart.setUTCHours(0, 0, 0, 0);
  return {
    bucketStart,
    bucketEnd: new Date(bucketStart.getTime() + 24 * 60 * 60 * 1000),
  };
}

const jsonRecordSchema = z.record(z.string(), z.unknown());

export const thirdPartyProxyTelemetryEntrySchema = z.object({
  provider: z.string().min(1),
  model: z.string().trim().min(1).optional(),
  projectExternalId: z.string().trim().min(1).optional(),
  projectName: z.string().trim().min(1).optional(),
  actorExternalId: z.string().trim().min(1).optional(),
  actorName: z.string().trim().min(1).optional(),
  actorEmail: z.string().email().optional(),
  apiKeyExternalId: z.string().trim().min(1).optional(),
  apiKeyName: z.string().trim().min(1).optional(),
  department: z.string().trim().min(1).optional(),
  lineItem: z.string().trim().min(1).optional(),
  currency: z.string().trim().min(1).optional().default("usd"),
  granularity: z.enum(["day", "1h"]).optional().default("day"),
  bucketStart: z.coerce.date(),
  bucketEnd: z.coerce.date().optional(),
  requestCount: z.number().int().min(0).optional(),
  inputTokens: z.number().int().min(0).optional().default(0),
  outputTokens: z.number().int().min(0).optional().default(0),
  totalTokens: z.number().int().min(0).optional(),
  cacheReadTokens: z.number().int().min(0).optional().default(0),
  cacheCreationTokens: z.number().int().min(0).optional().default(0),
  amount: z.number().min(0).optional().default(0),
  aiSystemId: z.string().trim().min(1).optional(),
  metadata: jsonRecordSchema.optional().default({}),
});

export const thirdPartyProxyTelemetryPayloadSchema = z.union([
  z.array(thirdPartyProxyTelemetryEntrySchema),
  z.object({
    source: z.string().trim().min(1).optional(),
    entries: z.array(thirdPartyProxyTelemetryEntrySchema),
  }),
]);

export type ThirdPartyProxyTelemetryEntry = z.infer<typeof thirdPartyProxyTelemetryEntrySchema>;

export function parseThirdPartyProxyTelemetryPayload(body: unknown): {
  source: string;
  entries: ThirdPartyProxyTelemetryEntry[];
} {
  const parsed = thirdPartyProxyTelemetryPayloadSchema.parse(body);
  if (Array.isArray(parsed)) {
    return {
      source: "third_party_proxy",
      entries: parsed,
    };
  }

  return {
    source: parsed.source ?? "third_party_proxy",
    entries: parsed.entries,
  };
}

type IngestParams = {
  source: string;
  entries: ThirdPartyProxyTelemetryEntry[];
  triggeredByUserId: string | null;
};

export async function ingestThirdPartyProxyTelemetry({
  source,
  entries,
  triggeredByUserId,
}: IngestParams) {
  const byProvider = new Map<string, ThirdPartyProxyTelemetryEntry[]>();
  for (const entry of entries) {
    const list = byProvider.get(entry.provider) ?? [];
    list.push(entry);
    byProvider.set(entry.provider, list);
  }

  const providerRuns = new Map<string, string>();
  const providerSummaries = new Map<
    string,
    { usageBucketsUpserted: number; costBucketsUpserted: number; projectsUpserted: number; actorsUpserted: number; apiUsageLogsCreated: number }
  >();

  await prisma.$transaction(async (tx) => {
    for (const [provider, providerEntries] of byProvider.entries()) {
      const run = await tx.providerSyncRun.create({
        data: {
          provider,
          syncType: "telemetry_ingest",
          status: "RUNNING",
          triggeredByUserId: triggeredByUserId ?? undefined,
          metadata: toJsonValue({
            source,
            entryCount: providerEntries.length,
          }),
        },
        select: { id: true },
      });
      providerRuns.set(provider, run.id);
      providerSummaries.set(provider, {
        usageBucketsUpserted: 0,
        costBucketsUpserted: 0,
        projectsUpserted: 0,
        actorsUpserted: 0,
        apiUsageLogsCreated: 0,
      });
    }

    for (const entry of entries) {
      const syncRunId = providerRuns.get(entry.provider);
      const summary = providerSummaries.get(entry.provider);
      if (!syncRunId || !summary) continue;

      const totalTokens = entry.totalTokens ?? entry.inputTokens + entry.outputTokens;
      const { bucketStart, bucketEnd } = entry.bucketEnd
        ? { bucketStart: entry.bucketStart, bucketEnd: entry.bucketEnd }
        : normalizeBucketDate(entry.bucketStart, entry.granularity);
      const dimensionKey = makeDimensionKey({
        model: entry.model,
        projectExternalId: entry.projectExternalId,
        actorExternalId: entry.actorExternalId,
        apiKeyExternalId: entry.apiKeyExternalId,
        lineItem: entry.lineItem,
        date: bucketStart.toISOString(),
      });

      await tx.usageBucket.upsert({
        where: {
          provider_bucketStart_bucketEnd_granularity_dimensionKey: {
            provider: entry.provider,
            bucketStart,
            bucketEnd,
            granularity: entry.granularity,
            dimensionKey,
          },
        },
        update: {
          model: entry.model,
          projectExternalId: entry.projectExternalId,
          projectName: entry.projectName,
          actorExternalId: entry.actorExternalId,
          actorName: entry.actorName,
          apiKeyExternalId: entry.apiKeyExternalId,
          apiKeyName: entry.apiKeyName,
          inputTokens: entry.inputTokens,
          outputTokens: entry.outputTokens,
          totalTokens,
          cacheReadTokens: entry.cacheReadTokens,
          cacheCreationTokens: entry.cacheCreationTokens,
          requestCount: entry.requestCount,
          metadata: toJsonValue({
            source,
            department: entry.department,
            ...entry.metadata,
          }),
          syncRunId,
          aiSystemId: entry.aiSystemId,
        },
        create: {
          provider: entry.provider,
          bucketStart,
          bucketEnd,
          granularity: entry.granularity,
          dimensionKey,
          model: entry.model,
          projectExternalId: entry.projectExternalId,
          projectName: entry.projectName,
          actorExternalId: entry.actorExternalId,
          actorName: entry.actorName,
          apiKeyExternalId: entry.apiKeyExternalId,
          apiKeyName: entry.apiKeyName,
          inputTokens: entry.inputTokens,
          outputTokens: entry.outputTokens,
          totalTokens,
          cacheReadTokens: entry.cacheReadTokens,
          cacheCreationTokens: entry.cacheCreationTokens,
          requestCount: entry.requestCount,
          metadata: toJsonValue({
            source,
            department: entry.department,
            ...entry.metadata,
          }),
          syncRunId,
          aiSystemId: entry.aiSystemId,
        },
      });
      summary.usageBucketsUpserted++;

      if (entry.amount > 0) {
        await tx.costBucket.upsert({
          where: {
            provider_bucketStart_bucketEnd_granularity_dimensionKey: {
              provider: entry.provider,
              bucketStart,
              bucketEnd,
              granularity: entry.granularity,
              dimensionKey,
            },
          },
          update: {
            amount: entry.amount,
            currency: entry.currency,
            model: entry.model,
            projectExternalId: entry.projectExternalId,
            projectName: entry.projectName,
            actorExternalId: entry.actorExternalId,
            actorName: entry.actorName,
            lineItem: entry.lineItem ?? "proxy",
            metadata: toJsonValue({
              source,
              department: entry.department,
              ...entry.metadata,
            }),
            syncRunId,
          },
          create: {
            provider: entry.provider,
            bucketStart,
            bucketEnd,
            granularity: entry.granularity,
            dimensionKey,
            amount: entry.amount,
            currency: entry.currency,
            model: entry.model,
            projectExternalId: entry.projectExternalId,
            projectName: entry.projectName,
            actorExternalId: entry.actorExternalId,
            actorName: entry.actorName,
            lineItem: entry.lineItem ?? "proxy",
            metadata: toJsonValue({
              source,
              department: entry.department,
              ...entry.metadata,
            }),
            syncRunId,
          },
        });
        summary.costBucketsUpserted++;
      }

      if (entry.projectExternalId) {
        await tx.providerProject.upsert({
          where: {
            provider_externalId: {
              provider: entry.provider,
              externalId: entry.projectExternalId,
            },
          },
          update: {
            name: entry.projectName,
            status: "active",
            metadata: toJsonValue({
              source,
              model: entry.model,
              lineItem: entry.lineItem,
            }),
            lastSeenAt: new Date(),
            syncRunId,
          },
          create: {
            provider: entry.provider,
            externalId: entry.projectExternalId,
            name: entry.projectName,
            status: "active",
            metadata: toJsonValue({
              source,
              model: entry.model,
              lineItem: entry.lineItem,
            }),
            syncRunId,
          },
        });
        summary.projectsUpserted++;
      }

      if (entry.actorExternalId) {
        await tx.providerActor.upsert({
          where: {
            provider_externalId: {
              provider: entry.provider,
              externalId: entry.actorExternalId,
            },
          },
          update: {
            email: entry.actorEmail,
            name: entry.actorName,
            metadata: toJsonValue({
              source,
              department: entry.department,
            }),
            lastSeenAt: new Date(),
            syncRunId,
          },
          create: {
            provider: entry.provider,
            externalId: entry.actorExternalId,
            email: entry.actorEmail,
            name: entry.actorName,
            metadata: toJsonValue({
              source,
              department: entry.department,
            }),
            syncRunId,
          },
        });
        summary.actorsUpserted++;
      }

      await tx.aPIUsageLog.create({
        data: {
          provider: entry.provider,
          model: entry.model ?? "unknown",
          department: entry.department ?? "third_party_proxy",
          aiSystemId: entry.aiSystemId,
          promptTokens: entry.inputTokens,
          completionTokens: entry.outputTokens,
          totalTokens,
          cost: entry.amount,
          flagged: false,
          promptMetadata: toJsonValue({
            source,
            dimensionKey,
            projectExternalId: entry.projectExternalId,
            actorExternalId: entry.actorExternalId,
            apiKeyExternalId: entry.apiKeyExternalId,
            lineItem: entry.lineItem,
            metadata: entry.metadata,
          }),
          createdAt: bucketStart,
        },
      });
      summary.apiUsageLogsCreated++;
    }

    for (const [provider, syncRunId] of providerRuns.entries()) {
      const summary = providerSummaries.get(provider);
      if (!summary) continue;
      await tx.providerSyncRun.update({
        where: { id: syncRunId },
        data: {
          status: "SUCCEEDED",
          completedAt: new Date(),
          recordsProcessed:
            summary.usageBucketsUpserted +
            summary.costBucketsUpserted +
            summary.projectsUpserted +
            summary.actorsUpserted,
          metadata: toJsonValue({
            source,
            ...summary,
          }),
        },
      });
    }
  });

  return {
    source,
    providerRuns: Object.fromEntries(providerRuns.entries()),
    providers: Object.fromEntries(providerSummaries.entries()),
    processed: entries.length,
  };
}
