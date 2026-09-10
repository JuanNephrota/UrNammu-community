import type { AlertSeverity, KeyUsageConditionType } from "@prisma/client";
import {
  keyUsageRuleConfigSchema,
  type KeyUsageRuleConfig,
} from "./validations/key-usage-rule";

/**
 * Evaluation engine for KeyUsageRule.
 *
 * Everything here is pure: callers load the telemetry window, resolve costs,
 * and pass in the key profiles, so the whole engine is unit-testable without a
 * database. `src/lib/background-jobs.ts` owns the IO and the Alert writes.
 *
 * Scope note: this engine only sees buckets that carry a key identity
 * (`apiKeyExternalId`). Buckets without one are dropped by
 * `groupBucketsByKey()` — usage the provider did not attribute to a key cannot
 * be evaluated per key, and silently folding it into some "unknown key" bucket
 * would produce alerts nobody can act on.
 */

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** A usage bucket with its cost already resolved from the matching CostBucket. */
export type KeyUsageBucketInput = {
  provider: string;
  apiKeyExternalId: string | null;
  apiKeyName: string | null;
  bucketStart: Date;
  bucketEnd: Date;
  granularity: string;
  model: string | null;
  projectExternalId: string | null;
  projectName: string | null;
  actorExternalId: string | null;
  actorName: string | null;
  totalTokens: number;
  requestCount: number | null;
  cost: number;
};

export type KeyProfileInput = {
  provider: string;
  externalId: string;
  firstSeenAt: Date;
  lastActiveAt: Date;
};

export type EvaluableKeyUsageRule = {
  id: string;
  key: string;
  label: string;
  description: string | null;
  conditionType: KeyUsageConditionType;
  severity: AlertSeverity;
  providers: string[];
  apiKeyExternalIds: string[];
  config: unknown;
  enabled: boolean;
};

export type KeyUsageFinding = {
  /** Stable dedupe identity: one open Alert per (rule, provider, key). */
  dedupeKey: string;
  ruleId: string;
  ruleKey: string;
  ruleLabel: string;
  conditionType: KeyUsageConditionType;
  severity: AlertSeverity;
  provider: string;
  apiKeyExternalId: string;
  apiKeyName: string | null;
  /** Which metric drove the match, when the condition is metric-based. */
  metric: "tokens" | "cost" | "requests" | null;
  observed: number | null;
  baseline: number | null;
  threshold: number | null;
  windowStart: Date;
  windowEnd: Date;
  /** Human-readable justification lines, shown on the Alert. */
  reasons: string[];
};

export type KeyGroup = {
  provider: string;
  apiKeyExternalId: string;
  apiKeyName: string | null;
  buckets: KeyUsageBucketInput[];
};

/**
 * Parse a stored `config` JSON blob. Rules are validated on write, but a row
 * seeded by an older migration (or hand-edited in SQL) can still be malformed —
 * returning null lets the evaluator skip it instead of throwing mid-job.
 */
export function parseKeyUsageRuleConfig(config: unknown): KeyUsageRuleConfig | null {
  const parsed = keyUsageRuleConfigSchema.safeParse(config);
  return parsed.success ? parsed.data : null;
}

export function groupBucketsByKey(buckets: KeyUsageBucketInput[]): KeyGroup[] {
  const groups = new Map<string, KeyGroup>();
  for (const bucket of buckets) {
    if (!bucket.apiKeyExternalId) continue;
    const groupKey = `${bucket.provider}::${bucket.apiKeyExternalId}`;
    const existing = groups.get(groupKey);
    if (existing) {
      existing.buckets.push(bucket);
      // Prefer any non-null name: provider sync backfills key names on a
      // different cadence than usage, so some buckets carry the id only.
      existing.apiKeyName = existing.apiKeyName ?? bucket.apiKeyName;
      continue;
    }
    groups.set(groupKey, {
      provider: bucket.provider,
      apiKeyExternalId: bucket.apiKeyExternalId,
      apiKeyName: bucket.apiKeyName,
      buckets: [bucket],
    });
  }
  return [...groups.values()];
}

function ruleAppliesToKey(rule: EvaluableKeyUsageRule, group: KeyGroup): boolean {
  if (rule.providers.length > 0 && !rule.providers.includes(group.provider)) {
    return false;
  }
  if (
    rule.apiKeyExternalIds.length > 0 &&
    !rule.apiKeyExternalIds.includes(group.apiKeyExternalId)
  ) {
    return false;
  }
  return true;
}

function bucketsInWindow(
  buckets: KeyUsageBucketInput[],
  start: Date,
  end: Date
): KeyUsageBucketInput[] {
  return buckets.filter(
    (bucket) => bucket.bucketStart >= start && bucket.bucketStart < end
  );
}

/** A bucket the provider actually billed something against. */
function hasVolume(bucket: KeyUsageBucketInput): boolean {
  return bucket.totalTokens > 0 || bucket.cost > 0 || (bucket.requestCount ?? 0) > 0;
}

function sumMetric(
  buckets: KeyUsageBucketInput[],
  metric: "tokens" | "cost" | "requests"
): number {
  return buckets.reduce((total, bucket) => {
    if (metric === "tokens") return total + bucket.totalTokens;
    if (metric === "cost") return total + bucket.cost;
    return total + (bucket.requestCount ?? 0);
  }, 0);
}

/**
 * Volume floors are an OR: a key clears the floor if it moved enough tokens
 * *or* enough spend. A rule that sets only one floor is gated on that one.
 */
function clearsVolumeFloor(
  buckets: KeyUsageBucketInput[],
  floors: { minTokens?: number; minCost?: number }
): boolean {
  const { minTokens, minCost } = floors;
  if (minTokens === undefined && minCost === undefined) return true;
  const tokens = sumMetric(buckets, "tokens");
  const cost = sumMetric(buckets, "cost");
  if (minTokens !== undefined && tokens >= minTokens) return true;
  if (minCost !== undefined && cost >= minCost) return true;
  return false;
}

function formatMetric(metric: "tokens" | "cost" | "requests", value: number): string {
  if (metric === "cost") return `$${value.toFixed(2)}`;
  if (metric === "requests") return `${Math.round(value).toLocaleString()} requests`;
  return `${Math.round(value).toLocaleString()} tokens`;
}

function describeWindow(hours: number): string {
  if (hours % 24 === 0) {
    const days = hours / 24;
    return days === 1 ? "24 hours" : `${days} days`;
  }
  return hours === 1 ? "hour" : `${hours} hours`;
}

function keyDisplayName(group: KeyGroup): string {
  return group.apiKeyName ?? group.apiKeyExternalId;
}

/**
 * Which local hour a bucket started in, given a fixed UTC offset. Used only by
 * OFF_HOURS, which is why a full IANA zone database is not warranted here.
 */
function localParts(date: Date, offsetMinutes: number): { hour: number; day: number } {
  const shifted = new Date(date.getTime() + offsetMinutes * 60 * 1000);
  return { hour: shifted.getUTCHours(), day: shifted.getUTCDay() };
}

type EvaluateContext = {
  now: Date;
  profilesByKey: Map<string, KeyProfileInput>;
  /**
   * Last activity per key that predates the loaded bucket range, keyed
   * `provider::externalId`. DORMANT_REACTIVATION needs this: an idle gap can
   * be far longer than the window the evaluator loads, and without it a key
   * dormant for a year would look like it had no measurable history at all.
   */
  lastActivityBeforeLoad: Map<string, Date>;
};

function evaluateRuleForKey(
  rule: EvaluableKeyUsageRule,
  config: KeyUsageRuleConfig,
  group: KeyGroup,
  ctx: EvaluateContext
): KeyUsageFinding | null {
  const { now } = ctx;
  const windowStart = new Date(now.getTime() - config.windowHours * HOUR_MS);
  const recent = bucketsInWindow(group.buckets, windowStart, now);

  const base = {
    dedupeKey: `${rule.key}::${group.provider}::${group.apiKeyExternalId}`,
    ruleId: rule.id,
    ruleKey: rule.key,
    ruleLabel: rule.label,
    conditionType: rule.conditionType,
    severity: rule.severity,
    provider: group.provider,
    apiKeyExternalId: group.apiKeyExternalId,
    apiKeyName: group.apiKeyName,
    windowStart,
    windowEnd: now,
  };

  switch (config.conditionType) {
    case "VOLUME_THRESHOLD": {
      const observed = sumMetric(recent, config.metric);
      if (observed <= config.threshold) return null;
      return {
        ...base,
        metric: config.metric,
        observed,
        baseline: null,
        threshold: config.threshold,
        reasons: [
          `Key ${keyDisplayName(group)} recorded ${formatMetric(config.metric, observed)} in the last ${describeWindow(config.windowHours)}, over the ${formatMetric(config.metric, config.threshold)} ceiling.`,
        ],
      };
    }

    case "SPIKE_MULTIPLIER": {
      const baselineStart = new Date(
        windowStart.getTime() - config.baselineHours * HOUR_MS
      );
      const baselineBuckets = bucketsInWindow(group.buckets, baselineStart, windowStart);
      const observed = sumMetric(recent, config.metric);
      const baseline = sumMetric(baselineBuckets, config.metric);

      if (
        !clearsVolumeFloor(recent, {
          minTokens: config.minRecentTokens,
          minCost: config.minRecentCost,
        })
      ) {
        return null;
      }
      // A zero baseline is not a spike — it is a new-key event, and the
      // NEW_KEY condition handles it with the right framing. Treating 0 as a
      // spike would make every first-week key fire this rule too.
      if (baseline <= 0) return null;
      if (observed < baseline * config.multiplier) return null;

      const deltaPct = Math.round(((observed - baseline) / baseline) * 100);
      return {
        ...base,
        metric: config.metric,
        observed,
        baseline,
        threshold: baseline * config.multiplier,
        reasons: [
          `Key ${keyDisplayName(group)} recorded ${formatMetric(config.metric, observed)} in the last ${describeWindow(config.windowHours)} versus ${formatMetric(config.metric, baseline)} in the prior ${describeWindow(config.baselineHours)} — up ${deltaPct}% (${(observed / baseline).toFixed(1)}x).`,
        ],
      };
    }

    case "NEW_KEY": {
      const profile = ctx.profilesByKey.get(
        `${group.provider}::${group.apiKeyExternalId}`
      );
      // No profile means the evaluator has not recorded this key yet, which is
      // itself the new-key signal. When a profile exists, the key is only new
      // if it was first seen inside the window.
      const firstSeenAt = profile?.firstSeenAt ?? null;
      if (firstSeenAt && firstSeenAt < windowStart) return null;
      // Belt and braces: even without a profile, any loaded bucket predating
      // the window proves the key is not new.
      if (group.buckets.some((b) => b.bucketStart < windowStart)) return null;
      if (recent.length === 0) return null;
      if (!clearsVolumeFloor(recent, config)) return null;

      const tokens = sumMetric(recent, "tokens");
      const cost = sumMetric(recent, "cost");
      return {
        ...base,
        metric: "tokens",
        observed: tokens,
        baseline: null,
        threshold: config.minTokens ?? null,
        reasons: [
          `Key ${keyDisplayName(group)} appeared in ${group.provider} telemetry for the first time and moved ${formatMetric("tokens", tokens)} ($${cost.toFixed(2)}) within ${describeWindow(config.windowHours)}.`,
        ],
      };
    }

    case "DORMANT_REACTIVATION": {
      // Dormancy is measured straight from the buckets rather than from the
      // ApiKeyProfile row. The profile is mutated by this same job, so reading
      // it here would make the result depend on whether profiles were written
      // before or after evaluation. The gap between the last activity before
      // the window and the first activity inside it is unambiguous.
      const recentActive = recent
        .filter(hasVolume)
        .sort((a, b) => a.bucketStart.getTime() - b.bucketStart.getTime());
      if (recentActive.length === 0) return null;
      if (!clearsVolumeFloor(recent, config)) return null;

      const priorActive = group.buckets
        .filter((b) => b.bucketStart < windowStart && hasVolume(b))
        .sort((a, b) => a.bucketStart.getTime() - b.bucketStart.getTime());
      const priorInRange = priorActive.at(-1)?.bucketStart ?? null;
      // Fall back to history older than the loaded range. Anything in range is
      // by definition more recent, so the later of the two is the true last
      // activity before this window.
      const priorInHistory =
        ctx.lastActivityBeforeLoad.get(
          `${group.provider}::${group.apiKeyExternalId}`
        ) ?? null;
      const lastActiveBefore =
        priorInRange && priorInHistory
          ? new Date(Math.max(priorInRange.getTime(), priorInHistory.getTime()))
          : (priorInRange ?? priorInHistory);
      // No activity at all before the window means there is no dormancy to
      // measure — that is a new key, which NEW_KEY reports with better framing.
      if (!lastActiveBefore) return null;
      const firstActiveNow = recentActive[0].bucketStart;
      const idleMs = firstActiveNow.getTime() - lastActiveBefore.getTime();
      if (idleMs < config.dormantDays * DAY_MS) return null;

      const idleDays = Math.floor(idleMs / DAY_MS);
      const tokens = sumMetric(recent, "tokens");
      return {
        ...base,
        metric: "tokens",
        observed: tokens,
        baseline: null,
        threshold: null,
        reasons: [
          `Key ${keyDisplayName(group)} was idle for ${idleDays} days (last active ${lastActiveBefore.toISOString().slice(0, 10)}) and has now moved ${formatMetric("tokens", tokens)}.`,
        ],
      };
    }

    case "OFF_HOURS": {
      // Daily buckets have no intra-day resolution, so an off-hours judgement
      // on them would be a guess. Evaluate hourly buckets only and stay silent
      // rather than inventing a signal.
      const hourly = recent.filter((bucket) => bucket.granularity === "1h");
      if (hourly.length === 0) return null;

      const businessDays = new Set(config.businessDays);
      const offHours = hourly.filter((bucket) => {
        const { hour, day } = localParts(bucket.bucketStart, config.timezoneOffsetMinutes);
        if (!businessDays.has(day)) return true;
        return hour < config.businessHourStart || hour >= config.businessHourEnd;
      });
      if (offHours.length === 0) return null;
      if (!clearsVolumeFloor(offHours, config)) return null;

      const tokens = sumMetric(offHours, "tokens");
      const offsetLabel =
        config.timezoneOffsetMinutes === 0
          ? "UTC"
          : `UTC${config.timezoneOffsetMinutes > 0 ? "+" : "-"}${Math.abs(config.timezoneOffsetMinutes / 60)}`;
      return {
        ...base,
        metric: "tokens",
        observed: tokens,
        baseline: null,
        threshold: config.minTokens ?? null,
        reasons: [
          `Key ${keyDisplayName(group)} moved ${formatMetric("tokens", tokens)} across ${offHours.length} hour(s) outside ${String(config.businessHourStart).padStart(2, "0")}:00-${String(config.businessHourEnd).padStart(2, "0")}:00 ${offsetLabel} business hours.`,
        ],
      };
    }

    case "MODEL_ALLOWLIST": {
      // An empty allowlist would flag every model. Treat it as unconfigured
      // rather than as "nothing is allowed".
      if (config.allowedModels.length === 0) return null;
      const allowed = config.allowedModels.map((model) => model.toLowerCase());
      const violating = recent.filter((bucket) => {
        if (!bucket.model) return false;
        const model = bucket.model.toLowerCase();
        return !allowed.some((entry) => model.includes(entry));
      });
      if (violating.length === 0) return null;
      if (!clearsVolumeFloor(violating, config)) return null;

      const models = [
        ...new Set(violating.map((bucket) => bucket.model).filter((m): m is string => !!m)),
      ];
      const tokens = sumMetric(violating, "tokens");
      return {
        ...base,
        metric: "tokens",
        observed: tokens,
        baseline: null,
        threshold: null,
        reasons: [
          `Key ${keyDisplayName(group)} invoked non-approved model(s) ${models.join(", ")} for ${formatMetric("tokens", tokens)} in the last ${describeWindow(config.windowHours)}.`,
        ],
      };
    }

    case "FAN_OUT": {
      const values = new Set(
        recent
          .map((bucket) =>
            config.dimension === "project"
              ? (bucket.projectExternalId ?? bucket.projectName)
              : (bucket.actorExternalId ?? bucket.actorName)
          )
          .filter((value): value is string => !!value)
      );
      if (values.size <= config.maxDistinct) return null;

      return {
        ...base,
        metric: null,
        observed: values.size,
        baseline: null,
        threshold: config.maxDistinct,
        reasons: [
          `Key ${keyDisplayName(group)} was used across ${values.size} distinct ${config.dimension}s in the last ${describeWindow(config.windowHours)}, over the limit of ${config.maxDistinct}.`,
        ],
      };
    }
  }
}

const SEVERITY_RANK: Record<AlertSeverity, number> = {
  CRITICAL: 5,
  HIGH: 4,
  MEDIUM: 3,
  LOW: 2,
  INFO: 1,
};

/**
 * Evaluate every enabled rule against every key in the telemetry window.
 * Returns findings ordered most severe first.
 */
export function evaluateKeyUsageRules(input: {
  rules: EvaluableKeyUsageRule[];
  buckets: KeyUsageBucketInput[];
  profiles: KeyProfileInput[];
  /** See EvaluateContext.lastActivityBeforeLoad. */
  lastActivityBeforeLoad?: Map<string, Date>;
  now?: Date;
}): KeyUsageFinding[] {
  const now = input.now ?? new Date();
  const groups = groupBucketsByKey(input.buckets);
  const profilesByKey = new Map(
    input.profiles.map((profile) => [
      `${profile.provider}::${profile.externalId}`,
      profile,
    ])
  );

  const findings: KeyUsageFinding[] = [];
  for (const rule of input.rules) {
    if (!rule.enabled) continue;
    const config = parseKeyUsageRuleConfig(rule.config);
    if (!config || config.conditionType !== rule.conditionType) continue;

    for (const group of groups) {
      if (!ruleAppliesToKey(rule, group)) continue;
      const finding = evaluateRuleForKey(rule, config, group, {
        now,
        profilesByKey,
        lastActivityBeforeLoad: input.lastActivityBeforeLoad ?? new Map(),
      });
      if (finding) findings.push(finding);
    }
  }

  return findings.sort((a, b) => {
    if (SEVERITY_RANK[b.severity] !== SEVERITY_RANK[a.severity]) {
      return SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity];
    }
    return (b.observed ?? 0) - (a.observed ?? 0);
  });
}

/**
 * Fold the window's buckets into the per-key profile state the NEW_KEY and
 * DORMANT_REACTIVATION conditions read.
 *
 * `firstSeenAt` is derived from the earliest bucket actually observed rather
 * than from the current time, so seeding the table against an existing
 * telemetry history does not make every pre-existing key look brand new.
 */
export function buildKeyProfileUpdates(
  buckets: KeyUsageBucketInput[]
): Array<{
  provider: string;
  externalId: string;
  name: string | null;
  firstSeenAt: Date;
  lastActiveAt: Date;
}> {
  const byKey = new Map<
    string,
    {
      provider: string;
      externalId: string;
      name: string | null;
      firstSeenAt: Date;
      lastActiveAt: Date;
    }
  >();

  for (const bucket of buckets) {
    if (!bucket.apiKeyExternalId) continue;
    // Only non-empty buckets move lastActiveAt — a zero-volume bucket means
    // the provider reported the key but it did not transact.
    const active = hasVolume(bucket);
    const mapKey = `${bucket.provider}::${bucket.apiKeyExternalId}`;
    const existing = byKey.get(mapKey);

    if (!existing) {
      byKey.set(mapKey, {
        provider: bucket.provider,
        externalId: bucket.apiKeyExternalId,
        name: bucket.apiKeyName,
        firstSeenAt: bucket.bucketStart,
        lastActiveAt: active ? bucket.bucketStart : new Date(0),
      });
      continue;
    }

    if (bucket.bucketStart < existing.firstSeenAt) existing.firstSeenAt = bucket.bucketStart;
    if (active && bucket.bucketStart > existing.lastActiveAt) {
      existing.lastActiveAt = bucket.bucketStart;
    }
    existing.name = existing.name ?? bucket.apiKeyName;
  }

  // Drop keys that never transacted in the window: there is nothing to record
  // and a lastActiveAt of epoch would corrupt dormancy math.
  return [...byKey.values()].filter(
    (profile) => profile.lastActiveAt.getTime() > 0
  );
}
