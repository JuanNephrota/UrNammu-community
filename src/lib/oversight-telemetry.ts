import type { CostBucket, DataSensitivity, UsageBucket } from "@prisma/client";

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

export type DataExposureFinding = {
  id: string;
  date: Date;
  provider: string;
  model: string;
  attribution: string;
  systemName: string | null;
  systemSensitivity: DataSensitivity | null;
  severity: "critical" | "warning" | "info";
  score: number;
  tokens: number;
  requests: number;
  cost: number;
  reasons: string[];
  matchedIndicators: string[];
  visibilitySignals: string[];
};

export type DataExposureSummary = {
  totalFindings: number;
  criticalFindings: number;
  restrictedSystemFindings: number;
  monitoredSystems: number;
};

export type SystemTelemetrySummary = {
  aiSystemId: string;
  systemName: string;
  department: string;
  status: string;
  riskLevel: string;
  dataSensitivity: DataSensitivity;
  providerCount: number;
  bucketCount: number;
  tokens: number;
  requests: number;
  cost: number;
  lastSeen: Date;
};

const INDICATOR_PATTERNS: Array<{ label: string; pattern: RegExp }> = [
  { label: "Restricted", pattern: /\brestricted\b/i },
  { label: "Confidential", pattern: /\bconfidential\b/i },
  { label: "PII", pattern: /\bpii\b|personal data|personal information/i },
  { label: "PHI", pattern: /\bphi\b|hipaa|patient|medical record/i },
  { label: "PCI", pattern: /\bpci\b|credit card|cardholder|payment card/i },
  { label: "SSN", pattern: /\bssn\b|social security/i },
  { label: "Passport", pattern: /\bpassport\b/i },
  { label: "Tax ID", pattern: /\btax id\b|tax identifier|tin\b/i },
  { label: "Payroll", pattern: /\bpayroll\b|salary|compensation/i },
];

const SENSITIVITY_KEY_PATTERN =
  /(classification|sensitivity|data[_ -]?class|contains[_ -]?(pii|phi)|restricted|confidential)/i;

type BucketWithSystem = UsageBucket & {
  aiSystem?: {
    id: string;
    name: string;
    dataSensitivity?: DataSensitivity;
  } | null;
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

function collectMetadataStrings(value: unknown, path = "metadata", acc: string[] = []): string[] {
  if (typeof value === "string") {
    acc.push(`${path}:${value}`);
    return acc;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    acc.push(`${path}:${String(value)}`);
    return acc;
  }

  if (Array.isArray(value)) {
    value.forEach((item, index) => collectMetadataStrings(item, `${path}[${index}]`, acc));
    return acc;
  }

  if (value && typeof value === "object") {
    Object.entries(value as Record<string, unknown>).forEach(([key, nested]) => {
      acc.push(`${path}.${key}`);
      collectMetadataStrings(nested, `${path}.${key}`, acc);
    });
  }

  return acc;
}

function dedupeStrings(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

export function buildDataExposureFindings(
  usageBuckets: BucketWithSystem[],
  costLookup: Map<string, number>,
  take?: number
): DataExposureFinding[] {
  const findings: DataExposureFinding[] = [];

  for (const bucket of usageBuckets) {
    const reasons: string[] = [];
    const indicators: string[] = [];
    const visibilitySignals: string[] = [];
    let score = 0;

    const attribution = getTelemetryAttributionLabel(bucket, bucket.aiSystem?.name);
    const searchableValues = dedupeStrings([
      attribution,
      bucket.model ?? "",
      bucket.projectName ?? "",
      bucket.projectExternalId ?? "",
      bucket.actorName ?? "",
      bucket.actorExternalId ?? "",
      bucket.apiKeyName ?? "",
      bucket.apiKeyExternalId ?? "",
      ...collectMetadataStrings(bucket.metadata),
    ]);

    if (bucket.aiSystem?.dataSensitivity === "RESTRICTED") {
      score += 4;
      reasons.push("Linked system is classified as restricted data.");
    } else if (bucket.aiSystem?.dataSensitivity === "CONFIDENTIAL") {
      score += 1;
      reasons.push("Linked system is classified as confidential data.");
    }

    if (bucket.projectName || bucket.projectExternalId) visibilitySignals.push("provider project telemetry");
    if (bucket.actorName || bucket.actorExternalId) visibilitySignals.push("provider actor telemetry");
    if (bucket.apiKeyName || bucket.apiKeyExternalId) visibilitySignals.push("provider API key telemetry");
    if (bucket.metadata) visibilitySignals.push("provider metadata");

    const metadataKeyHits = searchableValues
      .filter((entry) => SENSITIVITY_KEY_PATTERN.test(entry))
      .slice(0, 6);
    if (metadataKeyHits.length > 0) {
      score += 2;
      reasons.push("Provider metadata includes sensitivity or classification markers.");
      indicators.push(...metadataKeyHits);
    }

    for (const { label, pattern } of INDICATOR_PATTERNS) {
      const matches = searchableValues.filter((entry) => pattern.test(entry));
      if (matches.length > 0) {
        score += bucket.aiSystem?.dataSensitivity === "RESTRICTED" ? 1 : 2;
        indicators.push(label);
      }
    }

    const uniqueIndicators = dedupeStrings(indicators);
    if (uniqueIndicators.length > 0) {
      reasons.push("Provider-visible labels or metadata suggest restricted-data handling.");
    }

    if (visibilitySignals.length === 0) {
      continue;
    }

    if (!bucket.aiSystem && uniqueIndicators.length > 0 && visibilitySignals.length > 1) {
      score += 1;
      reasons.push("Multiple provider-visible dimensions reinforce the sensitive-data signal.");
    }

    if (score < 3) {
      continue;
    }

    findings.push({
      id: bucket.id,
      date: bucket.bucketStart,
      provider: bucket.provider,
      model: bucket.model ?? "—",
      attribution,
      systemName: bucket.aiSystem?.name ?? null,
      systemSensitivity: bucket.aiSystem?.dataSensitivity ?? null,
      severity: score >= 6 ? "critical" : score >= 3 ? "warning" : "info",
      score,
      tokens: bucket.totalTokens,
      requests: bucket.requestCount ?? 0,
      cost: costLookup.get(getBucketIdentityKey(bucket)) ?? 0,
      reasons: dedupeStrings(reasons),
      matchedIndicators: uniqueIndicators,
      visibilitySignals: dedupeStrings(visibilitySignals),
    });
  }

  const ordered = findings.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (b.tokens !== a.tokens) return b.tokens - a.tokens;
    return b.date.getTime() - a.date.getTime();
  });

  return typeof take === "number" ? ordered.slice(0, take) : ordered;
}

export function summarizeDataExposureFindings(
  findings: DataExposureFinding[]
): DataExposureSummary {
  return {
    totalFindings: findings.length,
    criticalFindings: findings.filter((finding) => finding.severity === "critical").length,
    restrictedSystemFindings: findings.filter(
      (finding) => finding.systemSensitivity === "RESTRICTED"
    ).length,
    monitoredSystems: new Set(
      findings
        .map((finding) => finding.systemName)
        .filter((value): value is string => Boolean(value))
    ).size,
  };
}

type BucketWithAttributedSystem = UsageBucket & {
  aiSystem?: {
    id: string;
    name: string;
    department: string;
    status: string;
    riskLevel: string;
    dataSensitivity: DataSensitivity;
  } | null;
};

export function buildSystemTelemetrySummaries(
  usageBuckets: BucketWithAttributedSystem[],
  costLookup: Map<string, number>,
  take?: number
): SystemTelemetrySummary[] {
  const bySystem = new Map<string, SystemTelemetrySummary & { providers: Set<string> }>();

  for (const bucket of usageBuckets) {
    if (!bucket.aiSystem) continue;

    const existing = bySystem.get(bucket.aiSystem.id) ?? {
      aiSystemId: bucket.aiSystem.id,
      systemName: bucket.aiSystem.name,
      department: bucket.aiSystem.department,
      status: bucket.aiSystem.status,
      riskLevel: bucket.aiSystem.riskLevel,
      dataSensitivity: bucket.aiSystem.dataSensitivity,
      providerCount: 0,
      bucketCount: 0,
      tokens: 0,
      requests: 0,
      cost: 0,
      lastSeen: bucket.bucketStart,
      providers: new Set<string>(),
    };

    existing.bucketCount += 1;
    existing.tokens += bucket.totalTokens;
    existing.requests += bucket.requestCount ?? 0;
    existing.cost += costLookup.get(getBucketIdentityKey(bucket)) ?? 0;
    existing.providers.add(bucket.provider);
    if (bucket.bucketStart.getTime() > existing.lastSeen.getTime()) {
      existing.lastSeen = bucket.bucketStart;
    }

    bySystem.set(bucket.aiSystem.id, existing);
  }

  const ordered = [...bySystem.values()]
    .map(({ providers, ...summary }) => ({
      ...summary,
      providerCount: providers.size,
    }))
    .sort((a, b) => {
      if (b.tokens !== a.tokens) return b.tokens - a.tokens;
      return b.lastSeen.getTime() - a.lastSeen.getTime();
    });

  return typeof take === "number" ? ordered.slice(0, take) : ordered;
}
