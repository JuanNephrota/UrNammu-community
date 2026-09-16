import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSetting } from "@/lib/settings";
import { bearerTokenMatches } from "@/lib/secret-compare";
import { logger } from "@/lib/observability";
import {
  COLLECTION_RETENTION_DEFAULTS,
  COLLECTION_RETENTION_SETTINGS_KEYS,
  PRUNE_BATCH_SIZE,
  pruneInBatches,
  resolveRetentionDays,
  retentionCutoff,
  selectScanIdsToPrune,
  type CollectionRetentionKey,
  type PruneSource,
} from "@/lib/collection-retention";

/**
 * Scheduled retention job for the collection tables that are not OTel
 * telemetry. Hit daily by Vercel Cron via vercel.json and guarded by
 * `Authorization: Bearer $CRON_SECRET`.
 *
 * Tables and their settings (days; `0` disables that table):
 *   raw_snapshot_retention_days      ProviderRawSnapshot      default 14
 *   api_usage_log_retention_days     APIUsageLog              default 180
 *   agent_tool_call_retention_days   AgentToolCall            default 180
 *   policy_denial_retention_days     PolicyDenial             default 365
 *   proxy_health_retention_days      ProxyHealthSnapshot      default 90
 *   scan_result_retention_days       SensitiveScan +          default 365
 *                                    ProviderSecurityScan
 *
 * UsageBucket and CostBucket are never touched — they are the long-term
 * aggregate that APIUsageLog and AgentToolCall roll up into, so pruning the
 * raw rows does not change any dashboard total.
 *
 * Rows are deleted oldest-first in batches of 5,000, walking the time column
 * as a cursor, inside a fixed time budget. A backlog larger than one run
 * drains over consecutive days; the response reports `remaining` per table
 * so that is visible. Scan runs keep the newest scan overall and the newest
 * scan per provider regardless of age (children cascade).
 */
export const maxDuration = 300;

const TIME_BUDGET_MS = 240_000;

type TableName =
  | "ProviderRawSnapshot"
  | "APIUsageLog"
  | "AgentToolCall"
  | "PolicyDenial"
  | "ProxyHealthSnapshot"
  | "SensitiveScan"
  | "ProviderSecurityScan";

interface TableReport {
  table: TableName;
  setting: CollectionRetentionKey;
  retentionDays: number;
  cutoff: string | null;
  deleted: number;
  remaining: number;
  batches: number;
  skipped?: string;
}

function window(cutoff: Date, after: Date | null) {
  return after ? { lt: cutoff, gte: after } : { lt: cutoff };
}

const rawSnapshotSource: PruneSource = {
  async findOldest(cutoff, take, after) {
    const rows = await prisma.providerRawSnapshot.findMany({
      where: { capturedAt: window(cutoff, after) },
      orderBy: { capturedAt: "asc" },
      take,
      select: { id: true, capturedAt: true },
    });
    return rows.map((r) => ({ id: r.id, ts: r.capturedAt }));
  },
  async deleteByIds(ids) {
    const res = await prisma.providerRawSnapshot.deleteMany({ where: { id: { in: ids } } });
    return res.count;
  },
  countRemaining(cutoff) {
    return prisma.providerRawSnapshot.count({ where: { capturedAt: { lt: cutoff } } });
  },
};

const apiUsageLogSource: PruneSource = {
  async findOldest(cutoff, take, after) {
    const rows = await prisma.aPIUsageLog.findMany({
      where: { createdAt: window(cutoff, after) },
      orderBy: { createdAt: "asc" },
      take,
      select: { id: true, createdAt: true },
    });
    return rows.map((r) => ({ id: r.id, ts: r.createdAt }));
  },
  async deleteByIds(ids) {
    const res = await prisma.aPIUsageLog.deleteMany({ where: { id: { in: ids } } });
    return res.count;
  },
  countRemaining(cutoff) {
    return prisma.aPIUsageLog.count({ where: { createdAt: { lt: cutoff } } });
  },
};

const agentToolCallSource: PruneSource = {
  async findOldest(cutoff, take, after) {
    const rows = await prisma.agentToolCall.findMany({
      where: { createdAt: window(cutoff, after) },
      orderBy: { createdAt: "asc" },
      take,
      select: { id: true, createdAt: true },
    });
    return rows.map((r) => ({ id: r.id, ts: r.createdAt }));
  },
  async deleteByIds(ids) {
    const res = await prisma.agentToolCall.deleteMany({ where: { id: { in: ids } } });
    return res.count;
  },
  countRemaining(cutoff) {
    return prisma.agentToolCall.count({ where: { createdAt: { lt: cutoff } } });
  },
};

const policyDenialSource: PruneSource = {
  async findOldest(cutoff, take, after) {
    const rows = await prisma.policyDenial.findMany({
      where: { createdAt: window(cutoff, after) },
      orderBy: { createdAt: "asc" },
      take,
      select: { id: true, createdAt: true },
    });
    return rows.map((r) => ({ id: r.id, ts: r.createdAt }));
  },
  async deleteByIds(ids) {
    const res = await prisma.policyDenial.deleteMany({ where: { id: { in: ids } } });
    return res.count;
  },
  countRemaining(cutoff) {
    return prisma.policyDenial.count({ where: { createdAt: { lt: cutoff } } });
  },
};

const proxyHealthSource: PruneSource = {
  async findOldest(cutoff, take, after) {
    const rows = await prisma.proxyHealthSnapshot.findMany({
      where: { capturedAt: window(cutoff, after) },
      orderBy: { capturedAt: "asc" },
      take,
      select: { id: true, capturedAt: true },
    });
    return rows.map((r) => ({ id: r.id, ts: r.capturedAt }));
  },
  async deleteByIds(ids) {
    const res = await prisma.proxyHealthSnapshot.deleteMany({ where: { id: { in: ids } } });
    return res.count;
  },
  countRemaining(cutoff) {
    return prisma.proxyHealthSnapshot.count({ where: { capturedAt: { lt: cutoff } } });
  },
};

const BATCHED_TABLES: Array<{
  table: TableName;
  setting: CollectionRetentionKey;
  source: PruneSource;
}> = [
  {
    table: "ProviderRawSnapshot",
    setting: COLLECTION_RETENTION_SETTINGS_KEYS.RAW_SNAPSHOT,
    source: rawSnapshotSource,
  },
  {
    table: "APIUsageLog",
    setting: COLLECTION_RETENTION_SETTINGS_KEYS.API_USAGE_LOG,
    source: apiUsageLogSource,
  },
  {
    table: "AgentToolCall",
    setting: COLLECTION_RETENTION_SETTINGS_KEYS.AGENT_TOOL_CALL,
    source: agentToolCallSource,
  },
  {
    table: "PolicyDenial",
    setting: COLLECTION_RETENTION_SETTINGS_KEYS.POLICY_DENIAL,
    source: policyDenialSource,
  },
  {
    table: "ProxyHealthSnapshot",
    setting: COLLECTION_RETENTION_SETTINGS_KEYS.PROXY_HEALTH,
    source: proxyHealthSource,
  },
];

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Scan runs are few (one row per run) so we load them all, decide which to
 * keep in memory, and delete the rest by id. Findings/results cascade.
 * Response-DLP findings that belong to no scan (`scanId` null) are not
 * governed by this job.
 */
async function pruneScans(
  cutoff: Date,
  deadline: number
): Promise<{ sensitive: Omit<TableReport, "setting" | "retentionDays" | "cutoff">; security: Omit<TableReport, "setting" | "retentionDays" | "cutoff"> }> {
  const sensitiveScans = await prisma.sensitiveScan.findMany({
    select: {
      id: true,
      createdAt: true,
      findings: { select: { provider: true }, distinct: ["provider"] },
    },
  });
  const sensitiveIds = selectScanIdsToPrune(
    sensitiveScans.map((s) => ({
      id: s.id,
      createdAt: s.createdAt,
      providers: s.findings.map((f) => f.provider),
    })),
    cutoff
  );

  let sensitiveDeleted = 0;
  let sensitiveBatches = 0;
  for (const ids of chunk(sensitiveIds, PRUNE_BATCH_SIZE)) {
    if (Date.now() >= deadline) break;
    const res = await prisma.sensitiveScan.deleteMany({ where: { id: { in: ids } } });
    sensitiveDeleted += res.count;
    sensitiveBatches += 1;
  }

  const securityScans = await prisma.providerSecurityScan.findMany({
    select: {
      id: true,
      createdAt: true,
      results: { select: { provider: true }, distinct: ["provider"] },
    },
  });
  const securityIds = selectScanIdsToPrune(
    securityScans.map((s) => ({
      id: s.id,
      createdAt: s.createdAt,
      providers: s.results.map((r) => r.provider),
    })),
    cutoff
  );

  let securityDeleted = 0;
  let securityBatches = 0;
  for (const ids of chunk(securityIds, PRUNE_BATCH_SIZE)) {
    if (Date.now() >= deadline) break;
    const res = await prisma.providerSecurityScan.deleteMany({ where: { id: { in: ids } } });
    securityDeleted += res.count;
    securityBatches += 1;
  }

  return {
    sensitive: {
      table: "SensitiveScan",
      deleted: sensitiveDeleted,
      remaining: sensitiveIds.length - sensitiveDeleted,
      batches: sensitiveBatches,
    },
    security: {
      table: "ProviderSecurityScan",
      deleted: securityDeleted,
      remaining: securityIds.length - securityDeleted,
      batches: securityBatches,
    },
  };
}

export async function GET(req: Request) {
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || !bearerTokenMatches(authHeader, cronSecret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const startedAt = Date.now();
  const deadline = startedAt + TIME_BUDGET_MS;
  const now = new Date(startedAt);
  const reports: TableReport[] = [];
  let budgetExhausted = false;

  for (const { table, setting, source } of BATCHED_TABLES) {
    const retentionDays = resolveRetentionDays(
      await getSetting(setting),
      COLLECTION_RETENTION_DEFAULTS[setting]
    );
    if (retentionDays === 0) {
      reports.push({
        table,
        setting,
        retentionDays,
        cutoff: null,
        deleted: 0,
        remaining: 0,
        batches: 0,
        skipped: `retention disabled (${setting}=0)`,
      });
      continue;
    }

    const cutoff = retentionCutoff(retentionDays, now);
    if (Date.now() >= deadline) {
      budgetExhausted = true;
      reports.push({
        table,
        setting,
        retentionDays,
        cutoff: cutoff.toISOString(),
        deleted: 0,
        remaining: await source.countRemaining(cutoff),
        batches: 0,
        skipped: "time budget exhausted; continues next run",
      });
      continue;
    }

    const result = await pruneInBatches(source, { cutoff, deadline });
    budgetExhausted ||= result.budgetExhausted;
    reports.push({
      table,
      setting,
      retentionDays,
      cutoff: cutoff.toISOString(),
      deleted: result.deleted,
      remaining: result.remaining,
      batches: result.batches,
      ...(result.budgetExhausted
        ? { skipped: "time budget exhausted; continues next run" }
        : {}),
    });
  }

  const scanSetting = COLLECTION_RETENTION_SETTINGS_KEYS.SCAN_RESULT;
  const scanRetentionDays = resolveRetentionDays(
    await getSetting(scanSetting),
    COLLECTION_RETENTION_DEFAULTS[scanSetting]
  );
  if (scanRetentionDays === 0) {
    for (const table of ["SensitiveScan", "ProviderSecurityScan"] as const) {
      reports.push({
        table,
        setting: scanSetting,
        retentionDays: 0,
        cutoff: null,
        deleted: 0,
        remaining: 0,
        batches: 0,
        skipped: `retention disabled (${scanSetting}=0)`,
      });
    }
  } else {
    const scanCutoff = retentionCutoff(scanRetentionDays, now);
    const { sensitive, security } = await pruneScans(scanCutoff, deadline);
    for (const partial of [sensitive, security]) {
      const exhausted = partial.remaining > 0;
      budgetExhausted ||= exhausted;
      reports.push({
        ...partial,
        setting: scanSetting,
        retentionDays: scanRetentionDays,
        cutoff: scanCutoff.toISOString(),
        ...(exhausted ? { skipped: "time budget exhausted; continues next run" } : {}),
      });
    }
  }

  const durationMs = Date.now() - startedAt;
  logger.info("collection.prune.completed", {
    durationMs,
    budgetExhausted,
    tables: reports.map((r) => ({
      table: r.table,
      deleted: r.deleted,
      remaining: r.remaining,
    })),
  });

  return NextResponse.json({
    batchSize: PRUNE_BATCH_SIZE,
    budgetExhausted,
    durationMs,
    tables: reports,
  });
}
