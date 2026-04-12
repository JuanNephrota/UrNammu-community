import type { CostBucket, UsageBucket } from "@prisma/client";

type BucketIdentity = Pick<
  UsageBucket | CostBucket,
  "provider" | "bucketStart" | "bucketEnd" | "granularity" | "dimensionKey"
>;

export type TelemetryActivityRow = {
  id: string;
  date: Date;
  provider: string;
  model: string;
  attribution: string;
  requests: number;
  tokens: number;
  cost: number;
};

export function getBucketIdentityKey(bucket: BucketIdentity): string {
  return [
    bucket.provider,
    bucket.bucketStart.toISOString(),
    bucket.bucketEnd.toISOString(),
    bucket.granularity,
    bucket.dimensionKey,
  ].join(":");
}

export function buildCostLookup(costBuckets: CostBucket[]): Map<string, number> {
  return new Map(
    costBuckets.map((bucket) => [getBucketIdentityKey(bucket), bucket.amount])
  );
}

export function getTelemetryAttributionLabel(
  bucket: UsageBucket,
  linkedSystemName?: string | null,
): string {
  return (
    linkedSystemName ??
    bucket.projectName ??
    bucket.actorName ??
    bucket.apiKeyName ??
    bucket.projectExternalId ??
    bucket.actorExternalId ??
    "Unattributed usage"
  );
}

export function isUnattributed(bucket: UsageBucket): boolean {
  return (
    !bucket.aiSystemId &&
    !bucket.projectName &&
    !bucket.actorName &&
    !bucket.apiKeyName &&
    !bucket.projectExternalId &&
    !bucket.actorExternalId
  );
}

type BucketWithSystem = UsageBucket & {
  aiSystem?: { id: string; name: string } | null;
};

export function buildTelemetryActivityRows(
  usageBuckets: BucketWithSystem[],
  costLookup: Map<string, number>,
  take?: number
): TelemetryActivityRow[] {
  const rows = usageBuckets.map((bucket) => ({
    id: bucket.id,
    date: bucket.bucketStart,
    provider: bucket.provider,
    model: bucket.model ?? "—",
    attribution: getTelemetryAttributionLabel(bucket, bucket.aiSystem?.name),
    requests: bucket.requestCount ?? 0,
    tokens: bucket.totalTokens,
    cost: costLookup.get(getBucketIdentityKey(bucket)) ?? 0,
  }));

  return typeof take === "number" ? rows.slice(0, take) : rows;
}
