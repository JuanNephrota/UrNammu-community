/**
 * Retention policy for the unbounded collection tables.
 *
 * The OTel tables (ClaudeCodeMetric/Event, CursorMetric/Span) have had prune
 * crons for a while; everything else the collectors write grew forever. This
 * module holds the setting keys, defaults, env fallbacks and the pure helpers
 * that `/api/cron/prune-collection` drives. It has no Prisma dependency so
 * the cutoff and batching logic can be unit-tested.
 *
 * Every window is in days; `0` disables pruning for that table. UsageBucket
 * and CostBucket are deliberately absent — they are the long-term aggregate
 * that survives the raw rows being pruned.
 */

export const COLLECTION_RETENTION_SETTINGS_KEYS = {
  RAW_SNAPSHOT: "raw_snapshot_retention_days",
  API_USAGE_LOG: "api_usage_log_retention_days",
  AGENT_TOOL_CALL: "agent_tool_call_retention_days",
  POLICY_DENIAL: "policy_denial_retention_days",
  PROXY_HEALTH: "proxy_health_retention_days",
  SCAN_RESULT: "scan_result_retention_days",
  COMPLIANCE_ACTIVITY: "compliance_activity_retention_days",
} as const;

export type CollectionRetentionKey =
  (typeof COLLECTION_RETENTION_SETTINGS_KEYS)[keyof typeof COLLECTION_RETENTION_SETTINGS_KEYS];

export const COLLECTION_RETENTION_DEFAULTS: Record<CollectionRetentionKey, number> = {
  raw_snapshot_retention_days: 14,
  api_usage_log_retention_days: 180,
  agent_tool_call_retention_days: 180,
  policy_denial_retention_days: 365,
  proxy_health_retention_days: 90,
  scan_result_retention_days: 365,
  compliance_activity_retention_days: 365,
};

/**
 * Env-var fallback for each retention setting, consumed by `getSetting()`.
 * The two OTel keys live here too so the Settings → General card and the
 * settings env map share one list (the Cursor one was previously missing).
 */
export const RETENTION_ENV_VARS = {
  raw_snapshot_retention_days: "RAW_SNAPSHOT_RETENTION_DAYS",
  api_usage_log_retention_days: "API_USAGE_LOG_RETENTION_DAYS",
  agent_tool_call_retention_days: "AGENT_TOOL_CALL_RETENTION_DAYS",
  policy_denial_retention_days: "POLICY_DENIAL_RETENTION_DAYS",
  proxy_health_retention_days: "PROXY_HEALTH_RETENTION_DAYS",
  scan_result_retention_days: "SCAN_RESULT_RETENTION_DAYS",
  compliance_activity_retention_days: "COMPLIANCE_ACTIVITY_RETENTION_DAYS",
  claude_code_telemetry_retention_days: "CLAUDE_CODE_TELEMETRY_RETENTION_DAYS",
  cursor_telemetry_retention_days: "CURSOR_TELEMETRY_RETENTION_DAYS",
} as const;

export type RetentionSettingKey = keyof typeof RETENTION_ENV_VARS;

export const RETENTION_SETTING_KEYS = Object.keys(
  RETENTION_ENV_VARS
) as RetentionSettingKey[];

/** Defaults for every retention key, including the two OTel prune crons. */
export const RETENTION_DEFAULTS: Record<RetentionSettingKey, number> = {
  ...COLLECTION_RETENTION_DEFAULTS,
  claude_code_telemetry_retention_days: 30,
  cursor_telemetry_retention_days: 30,
};

export const PRUNE_BATCH_SIZE = 5000;

/**
 * Parse a configured retention window. Anything that is not a non-negative
 * integer (unset, blank, negative, garbage) falls back to the default, so a
 * typo in an env var can never silently wipe a table or disable pruning.
 */
export function resolveRetentionDays(
  configured: string | null | undefined,
  fallback: number
): number {
  if (configured == null) return fallback;
  const trimmed = configured.trim();
  if (!/^\d+$/.test(trimmed)) return fallback;
  const parsed = Number.parseInt(trimmed, 10);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

/** Rows with a timestamp strictly before this instant are eligible to prune. */
export function retentionCutoff(retentionDays: number, now: Date = new Date()): Date {
  if (!Number.isFinite(retentionDays) || retentionDays <= 0) {
    throw new RangeError("retentionDays must be a positive number");
  }
  return new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000);
}

export interface PruneBatchRow {
  id: string;
  /** The table's time column (createdAt / capturedAt). */
  ts: Date;
}

export interface PruneSource {
  /**
   * Oldest `take` rows with ts < cutoff, ordered by ts ascending. `after` is
   * the cursor from the previous batch; rows before it were already deleted
   * so the query can start there instead of rescanning from the beginning.
   */
  findOldest(cutoff: Date, take: number, after: Date | null): Promise<PruneBatchRow[]>;
  deleteByIds(ids: string[]): Promise<number>;
  /** Rows still older than cutoff once we stop (0 when fully pruned). */
  countRemaining(cutoff: Date): Promise<number>;
}

export interface PruneInBatchesOptions {
  cutoff: Date;
  batchSize?: number;
  /** Wall-clock deadline; stop before starting a batch once passed. */
  deadline?: number;
  now?: () => number;
}

export interface PruneInBatchesResult {
  deleted: number;
  remaining: number;
  batches: number;
  /** True when we stopped because of the deadline, not because we finished. */
  budgetExhausted: boolean;
}

/**
 * Delete everything older than `cutoff` in fixed-size batches, walking the
 * time column as a cursor. Bounded by `deadline` so a very large backlog is
 * drained over several daily runs instead of one function timing out.
 */
export async function pruneInBatches(
  source: PruneSource,
  opts: PruneInBatchesOptions
): Promise<PruneInBatchesResult> {
  const batchSize = opts.batchSize ?? PRUNE_BATCH_SIZE;
  if (!Number.isInteger(batchSize) || batchSize <= 0) {
    throw new RangeError("batchSize must be a positive integer");
  }
  const now = opts.now ?? Date.now;

  let deleted = 0;
  let batches = 0;
  let cursor: Date | null = null;
  let budgetExhausted = false;

  for (;;) {
    if (opts.deadline != null && now() >= opts.deadline) {
      budgetExhausted = true;
      break;
    }
    const rows = await source.findOldest(opts.cutoff, batchSize, cursor);
    if (rows.length === 0) break;

    deleted += await source.deleteByIds(rows.map((r) => r.id));
    batches += 1;
    cursor = rows[rows.length - 1].ts;

    if (rows.length < batchSize) break;
  }

  const remaining = await source.countRemaining(opts.cutoff);
  return { deleted, remaining, batches, budgetExhausted };
}

export interface ScanSummary {
  id: string;
  createdAt: Date;
  /** Providers covered by this scan's findings/results. */
  providers: string[];
}

/**
 * Scan runs to prune: older than `cutoff`, but never the newest scan overall
 * and never the newest scan that covers a given provider. That keeps the
 * "latest posture per provider" the Sensitive Scan and Provider Security
 * pages render even when a provider has not been scanned in a long time.
 */
export function selectScanIdsToPrune(scans: ScanSummary[], cutoff: Date): string[] {
  if (scans.length === 0) return [];
  const byNewest = [...scans].sort(
    (a, b) => b.createdAt.getTime() - a.createdAt.getTime()
  );

  const keep = new Set<string>([byNewest[0].id]);
  const seenProviders = new Set<string>();
  for (const scan of byNewest) {
    for (const provider of scan.providers) {
      if (seenProviders.has(provider)) continue;
      seenProviders.add(provider);
      keep.add(scan.id);
    }
  }

  return byNewest
    .filter((s) => s.createdAt.getTime() < cutoff.getTime() && !keep.has(s.id))
    .map((s) => s.id);
}
