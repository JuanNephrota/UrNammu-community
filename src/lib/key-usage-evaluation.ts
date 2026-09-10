import type { AlertSeverity, KeyUsageConditionType } from "@prisma/client";
import { prisma } from "./prisma";
import { logger } from "./observability";
import { notifyDatadog } from "./datadog-client";
import { EXCLUDE_PROXY_DUPLICATES, EXCLUDE_PROXY_DUPLICATES_COST, buildCostLookup, getBucketIdentityKey } from "./oversight-telemetry";
import {
  buildKeyProfileUpdates,
  evaluateKeyUsageRules,
  parseKeyUsageRuleConfig,
  type KeyUsageBucketInput,
  type KeyUsageFinding,
} from "./key-usage-rules";

/**
 * IO layer for the key-usage rule engine. Loads the telemetry window, runs the
 * pure evaluator in `key-usage-rules.ts`, reconciles Alerts, and maintains the
 * ApiKeyProfile table. Called hourly from `runScheduledMaintenance()`.
 */

export const KEY_USAGE_ALERT_SOURCE = "key_usage_rule";

const HOUR_MS = 60 * 60 * 1000;

/**
 * Hard ceiling on how far back a single evaluation pass reads, regardless of
 * how a rule is configured. Keeps the hourly job inside the 60s function
 * budget on a large telemetry table.
 */
const MAX_LOOKBACK_HOURS = 24 * 90;

/** Defensive cap on rows pulled into memory for one pass. */
const MAX_BUCKETS = 200_000;

/**
 * Conditions describing a *live* state, where the alert should clear on its own
 * once the condition stops holding.
 *
 * The point-in-time conditions (NEW_KEY, DORMANT_REACTIVATION, OFF_HOURS)
 * are deliberately excluded: they describe an event that happened, not a
 * condition that persists. Auto-resolving those would quietly retract the
 * alert as soon as the window rolled past the event — often before anyone
 * looked at it. They stay open until a human dispositions them.
 */
const AUTO_RESOLVING_CONDITIONS: ReadonlySet<KeyUsageConditionType> = new Set([
  "VOLUME_THRESHOLD",
  "SPIKE_MULTIPLIER",
  "MODEL_ALLOWLIST",
  "FAN_OUT",
]);

export type KeyUsageEvaluationResult = {
  rulesEvaluated: number;
  keysEvaluated: number;
  findings: number;
  alertsCreated: number;
  alertsUpdated: number;
  alertsResolved: number;
  profilesUpserted: number;
  skippedReason?: string;
};

function severityToDatadogType(severity: AlertSeverity): "error" | "warning" | "info" {
  if (severity === "CRITICAL" || severity === "HIGH") return "error";
  if (severity === "MEDIUM") return "warning";
  return "info";
}

function buildAlertTitle(finding: KeyUsageFinding): string {
  const keyLabel = finding.apiKeyName ?? finding.apiKeyExternalId;
  return `${finding.ruleLabel}: ${finding.provider} / ${keyLabel}`;
}

function buildAlertDescription(finding: KeyUsageFinding): string {
  const lines = [...finding.reasons];
  lines.push(
    `Key id: ${finding.apiKeyExternalId} · Provider: ${finding.provider} · Window: ${finding.windowStart.toISOString()} to ${finding.windowEnd.toISOString()}`
  );
  return lines.join("\n\n");
}

/**
 * Determine how far back to read: each rule's own window, plus the baseline
 * behind it for spike rules.
 *
 * Dormancy rules deliberately do NOT extend this. An idle gap can be arbitrarily
 * long, and sizing the bucket read to cover it would mean loading months of
 * telemetry every hour. `loadActivityBefore()` answers that exactly with one
 * grouped query instead.
 */
export function computeLookbackHours(configs: ReturnType<typeof parseKeyUsageRuleConfig>[]): number {
  let maxHours = 0;
  for (const config of configs) {
    if (!config) continue;
    let hours = config.windowHours;
    if (config.conditionType === "SPIKE_MULTIPLIER") {
      hours += config.baselineHours;
    }
    maxHours = Math.max(maxHours, hours);
  }
  return Math.min(maxHours, MAX_LOOKBACK_HOURS);
}

/**
 * Last activity per key that predates the loaded bucket range. A key can be
 * dormant for far longer than the evaluator reads, so DORMANT_REACTIVATION
 * would otherwise silently miss exactly the long gaps it exists to catch.
 * One grouped query, served by the (provider, apiKeyExternalId, bucketStart)
 * index.
 */
async function loadActivityBefore(
  boundary: Date,
  observed: Array<{ provider: string; externalId: string }>
): Promise<Map<string, Date>> {
  if (observed.length === 0) return new Map();
  const rows = await prisma.usageBucket.groupBy({
    by: ["provider", "apiKeyExternalId"],
    where: {
      bucketStart: { lt: boundary },
      totalTokens: { gt: 0 },
      OR: observed.map((key) => ({
        provider: key.provider,
        apiKeyExternalId: key.externalId,
      })),
    },
    _max: { bucketStart: true },
  });
  const map = new Map<string, Date>();
  for (const row of rows) {
    if (row._max.bucketStart && row.apiKeyExternalId) {
      map.set(`${row.provider}::${row.apiKeyExternalId}`, row._max.bucketStart);
    }
  }
  return map;
}

/**
 * Ensure an ApiKeyProfile exists for every key seen in the window, with
 * `firstSeenAt` derived from the key's earliest bucket across *all* history —
 * not from the loaded window, and not from the current time. Without this, the
 * first run after deploy would classify every existing key as brand new and
 * raise a NEW_KEY alert for each one.
 */
async function backfillMissingProfiles(
  observed: Array<{ provider: string; externalId: string; name: string | null }>,
  existingKeys: Set<string>
): Promise<number> {
  const missing = observed.filter(
    (key) => !existingKeys.has(`${key.provider}::${key.externalId}`)
  );
  if (missing.length === 0) return 0;

  const earliest = await prisma.usageBucket.groupBy({
    by: ["provider", "apiKeyExternalId"],
    where: {
      OR: missing.map((key) => ({
        provider: key.provider,
        apiKeyExternalId: key.externalId,
      })),
    },
    _min: { bucketStart: true },
    _max: { bucketStart: true },
  });

  const earliestByKey = new Map(
    earliest.map((row) => [
      `${row.provider}::${row.apiKeyExternalId}`,
      { min: row._min.bucketStart, max: row._max.bucketStart },
    ])
  );

  let created = 0;
  for (const key of missing) {
    const bounds = earliestByKey.get(`${key.provider}::${key.externalId}`);
    if (!bounds?.min || !bounds.max) continue;
    await prisma.apiKeyProfile.upsert({
      where: {
        provider_externalId: { provider: key.provider, externalId: key.externalId },
      },
      create: {
        provider: key.provider,
        externalId: key.externalId,
        name: key.name,
        firstSeenAt: bounds.min,
        lastActiveAt: bounds.max,
      },
      update: {},
    });
    created += 1;
  }
  return created;
}

/**
 * Reconcile findings against open alerts. One open alert per (rule, provider,
 * key); repeat findings refresh the existing alert rather than piling up.
 */
async function syncKeyUsageAlerts(findings: KeyUsageFinding[]): Promise<{
  created: number;
  updated: number;
  resolved: number;
}> {
  const openAlerts = await prisma.alert.findMany({
    where: {
      source: KEY_USAGE_ALERT_SOURCE,
      status: { in: ["OPEN", "ACKNOWLEDGED"] },
    },
    select: { id: true, keyUsageMetadata: true },
  });

  const openByDedupeKey = new Map<string, string>();
  for (const alert of openAlerts) {
    const metadata = alert.keyUsageMetadata as { dedupeKey?: unknown } | null;
    const dedupeKey = typeof metadata?.dedupeKey === "string" ? metadata.dedupeKey : null;
    if (dedupeKey) openByDedupeKey.set(dedupeKey, alert.id);
  }

  let created = 0;
  let updated = 0;
  const seen = new Set<string>();

  for (const finding of findings) {
    // Two rules of the same kind can match one key in a single pass; the first
    // finding wins the alert and the rest are skipped rather than thrashing it.
    if (seen.has(finding.dedupeKey)) continue;
    seen.add(finding.dedupeKey);

    const metadata = {
      dedupeKey: finding.dedupeKey,
      ruleId: finding.ruleId,
      ruleKey: finding.ruleKey,
      conditionType: finding.conditionType,
      provider: finding.provider,
      apiKeyExternalId: finding.apiKeyExternalId,
      apiKeyName: finding.apiKeyName,
      metric: finding.metric,
      observed: finding.observed,
      baseline: finding.baseline,
      threshold: finding.threshold,
      windowStart: finding.windowStart.toISOString(),
      windowEnd: finding.windowEnd.toISOString(),
      reasons: finding.reasons,
    };

    const existingId = openByDedupeKey.get(finding.dedupeKey);
    if (existingId) {
      await prisma.alert.update({
        where: { id: existingId },
        data: {
          title: buildAlertTitle(finding),
          description: buildAlertDescription(finding),
          severity: finding.severity,
          keyUsageMetadata: metadata,
        },
      });
      updated += 1;
      continue;
    }

    await prisma.alert.create({
      data: {
        title: buildAlertTitle(finding),
        description: buildAlertDescription(finding),
        severity: finding.severity,
        source: KEY_USAGE_ALERT_SOURCE,
        keyUsageMetadata: metadata,
      },
    });
    created += 1;

    await notifyDatadog({
      title: `[UrNammu] ${buildAlertTitle(finding)}`,
      text: buildAlertDescription(finding),
      tags: [
        "source:urnammu",
        `alert_source:${KEY_USAGE_ALERT_SOURCE}`,
        `severity:${finding.severity.toLowerCase()}`,
        `rule:${finding.ruleKey}`,
        `provider:${finding.provider}`,
      ],
      alertType: severityToDatadogType(finding.severity),
      aggregationKey: `urnammu:${KEY_USAGE_ALERT_SOURCE}:${finding.dedupeKey}`,
    });
  }

  // Clear alerts for live conditions that no longer hold. Point-in-time
  // conditions are left alone — see AUTO_RESOLVING_CONDITIONS.
  let resolved = 0;
  for (const alert of openAlerts) {
    const metadata = alert.keyUsageMetadata as
      | { dedupeKey?: unknown; conditionType?: unknown }
      | null;
    const dedupeKey = typeof metadata?.dedupeKey === "string" ? metadata.dedupeKey : null;
    const conditionType = metadata?.conditionType as KeyUsageConditionType | undefined;
    if (!dedupeKey || seen.has(dedupeKey)) continue;
    if (!conditionType || !AUTO_RESOLVING_CONDITIONS.has(conditionType)) continue;

    await prisma.alert.update({
      where: { id: alert.id },
      data: { status: "RESOLVED" },
    });
    resolved += 1;
  }

  return { created, updated, resolved };
}

export async function runKeyUsageRuleEvaluation(
  now = new Date()
): Promise<KeyUsageEvaluationResult> {
  const empty: KeyUsageEvaluationResult = {
    rulesEvaluated: 0,
    keysEvaluated: 0,
    findings: 0,
    alertsCreated: 0,
    alertsUpdated: 0,
    alertsResolved: 0,
    profilesUpserted: 0,
  };

  const rules = await prisma.keyUsageRule.findMany({ where: { enabled: true } });
  if (rules.length === 0) {
    return { ...empty, skippedReason: "No enabled key-usage rules." };
  }

  const configs = rules.map((rule) => parseKeyUsageRuleConfig(rule.config));
  const lookbackHours = computeLookbackHours(configs);
  if (lookbackHours === 0) {
    return { ...empty, skippedReason: "No rule produced a usable evaluation window." };
  }
  const windowStart = new Date(now.getTime() - lookbackHours * HOUR_MS);

  const [usageBuckets, costBuckets] = await Promise.all([
    prisma.usageBucket.findMany({
      where: {
        bucketStart: { gte: windowStart },
        apiKeyExternalId: { not: null },
        ...EXCLUDE_PROXY_DUPLICATES,
      },
      orderBy: { bucketStart: "asc" },
      take: MAX_BUCKETS,
    }),
    prisma.costBucket.findMany({
      where: {
        bucketStart: { gte: windowStart },
        ...EXCLUDE_PROXY_DUPLICATES_COST,
      },
      take: MAX_BUCKETS,
    }),
  ]);

  if (usageBuckets.length === 0) {
    // Still reconcile: no telemetry means no live condition holds any more, so
    // open spike/threshold alerts must clear. Returning early here would leave
    // them open forever once traffic stopped — the exact case where the alert
    // should close on its own.
    const quiet = await syncKeyUsageAlerts([]);
    return {
      ...empty,
      rulesEvaluated: rules.length,
      alertsResolved: quiet.resolved,
      skippedReason: "No key-attributed telemetry in the window.",
    };
  }
  if (usageBuckets.length === MAX_BUCKETS) {
    logger.warn(
      `key-usage evaluation hit the ${MAX_BUCKETS}-bucket read cap; findings for this pass may be incomplete`
    );
  }

  const costLookup = buildCostLookup(costBuckets);
  const buckets: KeyUsageBucketInput[] = usageBuckets.map((bucket) => ({
    provider: bucket.provider,
    apiKeyExternalId: bucket.apiKeyExternalId,
    apiKeyName: bucket.apiKeyName,
    bucketStart: bucket.bucketStart,
    bucketEnd: bucket.bucketEnd,
    granularity: bucket.granularity,
    model: bucket.model,
    projectExternalId: bucket.projectExternalId,
    projectName: bucket.projectName,
    actorExternalId: bucket.actorExternalId,
    actorName: bucket.actorName,
    totalTokens: bucket.totalTokens,
    requestCount: bucket.requestCount,
    cost: costLookup.get(getBucketIdentityKey(bucket)) ?? 0,
  }));

  const observedKeys = [
    ...new Map(
      buckets
        .filter((bucket) => bucket.apiKeyExternalId)
        .map((bucket) => [
          `${bucket.provider}::${bucket.apiKeyExternalId}`,
          {
            provider: bucket.provider,
            externalId: bucket.apiKeyExternalId as string,
            name: bucket.apiKeyName,
          },
        ])
    ).values(),
  ];

  const existingProfiles = await prisma.apiKeyProfile.findMany({
    where: { OR: observedKeys.map((k) => ({ provider: k.provider, externalId: k.externalId })) },
  });
  const existingKeySet = new Set(
    existingProfiles.map((p) => `${p.provider}::${p.externalId}`)
  );

  // Backfill BEFORE evaluating, so NEW_KEY sees each key's true first-seen date
  // rather than treating an unrecorded key as newly appeared.
  const backfilled = await backfillMissingProfiles(observedKeys, existingKeySet);
  const profiles = backfilled > 0
    ? await prisma.apiKeyProfile.findMany({
        where: { OR: observedKeys.map((k) => ({ provider: k.provider, externalId: k.externalId })) },
      })
    : existingProfiles;

  const lastActivityBeforeLoad = await loadActivityBefore(windowStart, observedKeys);

  const findings = evaluateKeyUsageRules({
    rules: rules.map((rule) => ({
      id: rule.id,
      key: rule.key,
      label: rule.label,
      description: rule.description,
      conditionType: rule.conditionType,
      severity: rule.severity,
      providers: rule.providers,
      apiKeyExternalIds: rule.apiKeyExternalIds,
      config: rule.config,
      enabled: rule.enabled,
    })),
    buckets,
    profiles: profiles.map((profile) => ({
      provider: profile.provider,
      externalId: profile.externalId,
      firstSeenAt: profile.firstSeenAt,
      lastActiveAt: profile.lastActiveAt,
    })),
    lastActivityBeforeLoad,
    now,
  });

  const alertResult = await syncKeyUsageAlerts(findings);

  // Profiles are advanced AFTER evaluation so this pass reads pre-window state.
  const profileUpdates = buildKeyProfileUpdates(buckets);
  for (const update of profileUpdates) {
    await prisma.apiKeyProfile.upsert({
      where: {
        provider_externalId: { provider: update.provider, externalId: update.externalId },
      },
      create: {
        provider: update.provider,
        externalId: update.externalId,
        name: update.name,
        firstSeenAt: update.firstSeenAt,
        lastActiveAt: update.lastActiveAt,
      },
      update: {
        name: update.name ?? undefined,
        lastActiveAt: update.lastActiveAt,
      },
    });
  }

  return {
    rulesEvaluated: rules.length,
    keysEvaluated: observedKeys.length,
    findings: findings.length,
    alertsCreated: alertResult.created,
    alertsUpdated: alertResult.updated,
    alertsResolved: alertResult.resolved,
    profilesUpserted: profileUpdates.length,
  };
}

/**
 * Dry-run a rule config against live telemetry without writing anything.
 * Backs the "preview" action in the rules UI so an admin can see how noisy a
 * threshold is before enabling it.
 */
export async function previewKeyUsageRule(input: {
  conditionType: KeyUsageConditionType;
  config: unknown;
  providers?: string[];
  apiKeyExternalIds?: string[];
  now?: Date;
}): Promise<{ findings: KeyUsageFinding[]; keysEvaluated: number }> {
  const now = input.now ?? new Date();
  const config = parseKeyUsageRuleConfig(input.config);
  if (!config) return { findings: [], keysEvaluated: 0 };

  const lookbackHours = computeLookbackHours([config]);
  const windowStart = new Date(now.getTime() - lookbackHours * HOUR_MS);

  const [usageBuckets, costBuckets] = await Promise.all([
    prisma.usageBucket.findMany({
      where: {
        bucketStart: { gte: windowStart },
        apiKeyExternalId: { not: null },
        ...(input.providers?.length ? { provider: { in: input.providers } } : {}),
        ...(input.apiKeyExternalIds?.length
          ? { apiKeyExternalId: { in: input.apiKeyExternalIds } }
          : {}),
        ...EXCLUDE_PROXY_DUPLICATES,
      },
      orderBy: { bucketStart: "asc" },
      take: MAX_BUCKETS,
    }),
    prisma.costBucket.findMany({
      where: { bucketStart: { gte: windowStart }, ...EXCLUDE_PROXY_DUPLICATES_COST },
      take: MAX_BUCKETS,
    }),
  ]);

  const costLookup = buildCostLookup(costBuckets);
  const buckets: KeyUsageBucketInput[] = usageBuckets.map((bucket) => ({
    provider: bucket.provider,
    apiKeyExternalId: bucket.apiKeyExternalId,
    apiKeyName: bucket.apiKeyName,
    bucketStart: bucket.bucketStart,
    bucketEnd: bucket.bucketEnd,
    granularity: bucket.granularity,
    model: bucket.model,
    projectExternalId: bucket.projectExternalId,
    projectName: bucket.projectName,
    actorExternalId: bucket.actorExternalId,
    actorName: bucket.actorName,
    totalTokens: bucket.totalTokens,
    requestCount: bucket.requestCount,
    cost: costLookup.get(getBucketIdentityKey(bucket)) ?? 0,
  }));

  const observedKeys = new Set(
    buckets.map((bucket) => `${bucket.provider}::${bucket.apiKeyExternalId}`)
  );

  const profiles = await prisma.apiKeyProfile.findMany();
  const lastActivityBeforeLoad = await loadActivityBefore(
    windowStart,
    [...observedKeys].map((composite) => {
      const [provider, externalId] = composite.split("::");
      return { provider, externalId };
    })
  );

  const findings = evaluateKeyUsageRules({
    rules: [
      {
        id: "preview",
        key: "preview",
        label: "Preview",
        description: null,
        conditionType: input.conditionType,
        severity: "INFO",
        providers: input.providers ?? [],
        apiKeyExternalIds: input.apiKeyExternalIds ?? [],
        config: input.config,
        enabled: true,
      },
    ],
    buckets,
    profiles: profiles.map((profile) => ({
      provider: profile.provider,
      externalId: profile.externalId,
      firstSeenAt: profile.firstSeenAt,
      lastActiveAt: profile.lastActiveAt,
    })),
    lastActivityBeforeLoad,
    now,
  });

  return { findings, keysEvaluated: observedKeys.size };
}
