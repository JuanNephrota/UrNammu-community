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

export type TelemetryAnomaly = {
  id: string;
  type: "provider_spike" | "model_spike" | "project_spike" | "new_usage";
  scope: "provider" | "model" | "project";
  label: string;
  provider: string | null;
  model: string | null;
  attribution: string | null;
  severity: "critical" | "warning" | "info";
  recentTokens: number;
  baselineTokens: number;
  recentCost: number;
  baselineCost: number;
  tokenDeltaPct: number | null;
  costDeltaPct: number | null;
  reasons: string[];
};

export type ModelDriftFinding = {
  id: string;
  aiSystemId: string;
  systemName: string;
  expectedVendor: string | null;
  expectedModelType: string | null;
  dominantProvider: string | null;
  dominantModel: string | null;
  observedProviders: string[];
  observedModels: string[];
  severity: "critical" | "warning" | "info";
  lastSeen: Date;
  reasons: string[];
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
    vendor?: string | null;
    modelType?: string | null;
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

type AnomalyThresholds = {
  minRecentTokens: number;
  minRecentCost: number;
  tokenSpikeMultiplier: number;
  costSpikeMultiplier: number;
  newUsageTokens: number;
  newUsageCost: number;
};

type AnomalyOptions = {
  now?: Date;
  recentWindowDays?: number;
  baselineWindowDays?: number;
  thresholds?: Partial<Record<"provider" | "model" | "project", Partial<AnomalyThresholds>>>;
  take?: number;
};

const DEFAULT_ANOMALY_THRESHOLDS: Record<"provider" | "model" | "project", AnomalyThresholds> = {
  provider: {
    minRecentTokens: 5000,
    minRecentCost: 10,
    tokenSpikeMultiplier: 2,
    costSpikeMultiplier: 1.8,
    newUsageTokens: 10000,
    newUsageCost: 25,
  },
  model: {
    minRecentTokens: 2500,
    minRecentCost: 5,
    tokenSpikeMultiplier: 2.5,
    costSpikeMultiplier: 2,
    newUsageTokens: 5000,
    newUsageCost: 10,
  },
  project: {
    minRecentTokens: 2500,
    minRecentCost: 5,
    tokenSpikeMultiplier: 2.25,
    costSpikeMultiplier: 1.9,
    newUsageTokens: 5000,
    newUsageCost: 10,
  },
};

function getThresholds(
  scope: "provider" | "model" | "project",
  overrides?: Partial<Record<"provider" | "model" | "project", Partial<AnomalyThresholds>>>
): AnomalyThresholds {
  return {
    ...DEFAULT_ANOMALY_THRESHOLDS[scope],
    ...(overrides?.[scope] ?? {}),
  };
}

function pctDelta(recent: number, baseline: number): number | null {
  if (baseline <= 0) return null;
  return Math.round(((recent - baseline) / baseline) * 100);
}

function normalizeFamily(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return null;
  if (normalized.includes("gpt") || normalized.includes("openai")) return "gpt";
  if (normalized.includes("claude") || normalized.includes("anthropic")) return "claude";
  if (normalized.includes("gemini") || normalized.includes("google")) return "gemini";
  if (normalized.includes("mistral")) return "mistral";
  if (normalized.includes("llama") || normalized.includes("meta")) return "llama";
  if (normalized.includes("command") || normalized.includes("cohere")) return "command";
  if (normalized.includes("copilot") || normalized.includes("microsoft")) return "copilot";
  const [first] = normalized.split(/[-\s/]/);
  return first || normalized;
}

function matchesExpectedVendor(
  provider: string,
  expectedVendor: string | null | undefined
): boolean {
  if (!expectedVendor) return true;
  const left = provider.toLowerCase();
  const right = expectedVendor.toLowerCase();
  return left.includes(right) || right.includes(left);
}

function matchesExpectedModel(
  model: string | null,
  expectedModelType: string | null | undefined
): boolean {
  if (!expectedModelType) return true;
  const actualFamily = normalizeFamily(model);
  const expectedFamily = normalizeFamily(expectedModelType);
  return actualFamily === expectedFamily;
}

export function buildTelemetryAnomalies(
  usageBuckets: UsageBucket[],
  costLookup: Map<string, number>,
  options: AnomalyOptions = {}
): TelemetryAnomaly[] {
  const now = options.now ?? new Date();
  const recentWindowDays = options.recentWindowDays ?? 7;
  const baselineWindowDays = options.baselineWindowDays ?? 7;
  const recentWindowStart = new Date(
    now.getTime() - recentWindowDays * 24 * 60 * 60 * 1000
  );
  const baselineWindowStart = new Date(
    recentWindowStart.getTime() - baselineWindowDays * 24 * 60 * 60 * 1000
  );

  const providerStats = new Map<string, { recentTokens: number; baselineTokens: number; recentCost: number; baselineCost: number }>();
  const modelStats = new Map<string, { label: string; provider: string; model: string; recentTokens: number; baselineTokens: number; recentCost: number; baselineCost: number }>();
  const projectStats = new Map<string, { label: string; attribution: string; provider: string | null; recentTokens: number; baselineTokens: number; recentCost: number; baselineCost: number }>();

  for (const bucket of usageBuckets) {
    const cost = costLookup.get(getBucketIdentityKey(bucket)) ?? 0;
    const inRecentWindow = bucket.bucketStart >= recentWindowStart;
    const inBaselineWindow =
      bucket.bucketStart >= baselineWindowStart && bucket.bucketStart < recentWindowStart;

    if (!inRecentWindow && !inBaselineWindow) continue;

    const providerEntry = providerStats.get(bucket.provider) ?? {
      recentTokens: 0,
      baselineTokens: 0,
      recentCost: 0,
      baselineCost: 0,
    };
    const modelKey = `${bucket.provider}:${bucket.model ?? "unknown"}`;
    const modelEntry = modelStats.get(modelKey) ?? {
      label: bucket.model ?? "Unspecified model",
      provider: bucket.provider,
      model: bucket.model ?? "Unspecified model",
      recentTokens: 0,
      baselineTokens: 0,
      recentCost: 0,
      baselineCost: 0,
    };
    const attribution = getTelemetryAttributionLabel(bucket);
    const projectEntry = projectStats.get(attribution) ?? {
      label: attribution,
      attribution,
      provider: null,
      recentTokens: 0,
      baselineTokens: 0,
      recentCost: 0,
      baselineCost: 0,
    };

    if (inRecentWindow) {
      providerEntry.recentTokens += bucket.totalTokens;
      providerEntry.recentCost += cost;
      modelEntry.recentTokens += bucket.totalTokens;
      modelEntry.recentCost += cost;
      projectEntry.recentTokens += bucket.totalTokens;
      projectEntry.recentCost += cost;
    } else if (inBaselineWindow) {
      providerEntry.baselineTokens += bucket.totalTokens;
      providerEntry.baselineCost += cost;
      modelEntry.baselineTokens += bucket.totalTokens;
      modelEntry.baselineCost += cost;
      projectEntry.baselineTokens += bucket.totalTokens;
      projectEntry.baselineCost += cost;
    }

    projectEntry.provider = projectEntry.provider ?? bucket.provider;
    providerStats.set(bucket.provider, providerEntry);
    modelStats.set(modelKey, modelEntry);
    projectStats.set(attribution, projectEntry);
  }

  const anomalies: TelemetryAnomaly[] = [];
  const evaluate = (
    scope: "provider" | "model" | "project",
    id: string,
    label: string,
    values: { recentTokens: number; baselineTokens: number; recentCost: number; baselineCost: number },
    extras: { provider: string | null; model: string | null; attribution: string | null }
  ) => {
    const thresholds = getThresholds(scope, options.thresholds);
    const reasons: string[] = [];
    let type: TelemetryAnomaly["type"] =
      scope === "provider" ? "provider_spike" : scope === "model" ? "model_spike" : "project_spike";
    let severity: TelemetryAnomaly["severity"] = "info";

    const tokenDeltaPct = pctDelta(values.recentTokens, values.baselineTokens);
    const costDeltaPct = pctDelta(values.recentCost, values.baselineCost);

    const hasMeaningfulRecentVolume =
      values.recentTokens >= thresholds.minRecentTokens || values.recentCost >= thresholds.minRecentCost;

    if (!hasMeaningfulRecentVolume) return;

    if (values.baselineTokens === 0 && values.baselineCost === 0) {
      if (
        values.recentTokens >= thresholds.newUsageTokens ||
        values.recentCost >= thresholds.newUsageCost
      ) {
        type = "new_usage";
        reasons.push("Recent activity appeared without any comparable baseline in the prior window.");
        severity = values.recentCost >= thresholds.newUsageCost * 2 ? "warning" : "info";
      } else {
        return;
      }
    } else {
      const tokenSpike =
        values.baselineTokens > 0 &&
        values.recentTokens >= values.baselineTokens * thresholds.tokenSpikeMultiplier;
      const costSpike =
        values.baselineCost > 0 &&
        values.recentCost >= values.baselineCost * thresholds.costSpikeMultiplier;

      if (!tokenSpike && !costSpike) return;

      if (tokenSpike && tokenDeltaPct !== null) {
        reasons.push(`Token volume increased ${tokenDeltaPct}% versus the prior window.`);
      }
      if (costSpike && costDeltaPct !== null) {
        reasons.push(`Cost increased ${costDeltaPct}% versus the prior window.`);
      }
      severity =
        (tokenDeltaPct !== null && tokenDeltaPct >= 250) ||
        (costDeltaPct !== null && costDeltaPct >= 250)
          ? "critical"
          : "warning";
    }

    anomalies.push({
      id,
      type,
      scope,
      label,
      provider: extras.provider,
      model: extras.model,
      attribution: extras.attribution,
      severity,
      recentTokens: values.recentTokens,
      baselineTokens: values.baselineTokens,
      recentCost: values.recentCost,
      baselineCost: values.baselineCost,
      tokenDeltaPct,
      costDeltaPct,
      reasons,
    });
  };

  for (const [provider, values] of providerStats.entries()) {
    evaluate("provider", `provider:${provider}`, provider, values, {
      provider,
      model: null,
      attribution: null,
    });
  }
  for (const [key, values] of modelStats.entries()) {
    evaluate("model", key, `${values.provider} / ${values.label}`, values, {
      provider: values.provider,
      model: values.model,
      attribution: null,
    });
  }
  for (const [key, values] of projectStats.entries()) {
    evaluate("project", `project:${key}`, values.label, values, {
      provider: values.provider,
      model: null,
      attribution: values.attribution,
    });
  }

  const ordered = anomalies.sort((a, b) => {
    const severityRank = { critical: 3, warning: 2, info: 1 };
    if (severityRank[b.severity] !== severityRank[a.severity]) {
      return severityRank[b.severity] - severityRank[a.severity];
    }
    if (b.recentCost !== a.recentCost) return b.recentCost - a.recentCost;
    return b.recentTokens - a.recentTokens;
  });

  return typeof options.take === "number" ? ordered.slice(0, options.take) : ordered;
}

export function buildModelDriftFindings(
  usageBuckets: BucketWithAttributedSystem[],
  costLookup: Map<string, number>,
  take?: number
): ModelDriftFinding[] {
  const bySystem = new Map<
    string,
    {
      aiSystemId: string;
      systemName: string;
      expectedVendor: string | null;
      expectedModelType: string | null;
      lastSeen: Date;
      providerTotals: Map<string, number>;
      modelTotals: Map<string, number>;
      reasons: string[];
      severity: "critical" | "warning" | "info";
    }
  >();

  for (const bucket of usageBuckets) {
    if (!bucket.aiSystem) continue;

    const cost = costLookup.get(getBucketIdentityKey(bucket)) ?? 0;
    const amount = bucket.totalTokens + cost;
    const current = bySystem.get(bucket.aiSystem.id) ?? {
      aiSystemId: bucket.aiSystem.id,
      systemName: bucket.aiSystem.name,
      expectedVendor: bucket.aiSystem.vendor ?? null,
      expectedModelType: bucket.aiSystem.modelType ?? null,
      lastSeen: bucket.bucketStart,
      providerTotals: new Map<string, number>(),
      modelTotals: new Map<string, number>(),
      reasons: [],
      severity: "info" as const,
    };

    current.providerTotals.set(
      bucket.provider,
      (current.providerTotals.get(bucket.provider) ?? 0) + amount
    );
    current.modelTotals.set(
      bucket.model ?? "Unspecified model",
      (current.modelTotals.get(bucket.model ?? "Unspecified model") ?? 0) + amount
    );
    if (bucket.bucketStart.getTime() > current.lastSeen.getTime()) current.lastSeen = bucket.bucketStart;
    bySystem.set(bucket.aiSystem.id, current);
  }

  const findings: ModelDriftFinding[] = [];
  for (const system of bySystem.values()) {
    const observedProviders = [...system.providerTotals.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([provider]) => provider);
    const observedModels = [...system.modelTotals.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([model]) => model);

    const dominantProvider = observedProviders[0] ?? null;
    const dominantModel = observedModels[0] ?? null;
    const reasons: string[] = [];
    let severity: ModelDriftFinding["severity"] = "info";

    if (dominantProvider && !matchesExpectedVendor(dominantProvider, system.expectedVendor)) {
      reasons.push(
        `Recent dominant provider ${dominantProvider} does not match the governed vendor ${system.expectedVendor}.`
      );
      severity = "critical";
    }

    if (dominantModel && !matchesExpectedModel(dominantModel, system.expectedModelType)) {
      reasons.push(
        `Recent dominant model ${dominantModel} does not align with the expected model family ${system.expectedModelType}.`
      );
      severity = severity === "critical" ? "critical" : "warning";
    }

    const observedFamilies = new Set(
      observedModels
        .map((model) => normalizeFamily(model))
        .filter((value): value is string => Boolean(value))
    );
    if (observedFamilies.size > 1) {
      reasons.push("Multiple model families are active for the same governed system.");
      severity = severity === "critical" ? "critical" : "warning";
    }

    if (observedProviders.length > 1) {
      reasons.push("Telemetry shows the system using more than one provider.");
      severity = severity === "critical" ? "critical" : "warning";
    }

    if (reasons.length === 0) continue;

    findings.push({
      id: system.aiSystemId,
      aiSystemId: system.aiSystemId,
      systemName: system.systemName,
      expectedVendor: system.expectedVendor,
      expectedModelType: system.expectedModelType,
      dominantProvider,
      dominantModel,
      observedProviders,
      observedModels,
      severity,
      lastSeen: system.lastSeen,
      reasons,
    });
  }

  const ordered = findings.sort((a, b) => {
    const severityRank = { critical: 3, warning: 2, info: 1 };
    if (severityRank[b.severity] !== severityRank[a.severity]) {
      return severityRank[b.severity] - severityRank[a.severity];
    }
    return b.lastSeen.getTime() - a.lastSeen.getTime();
  });

  return typeof take === "number" ? ordered.slice(0, take) : ordered;
}
