import type { ProxyHealthSnapshot } from "@prisma/client";
import { prisma } from "./prisma";
import { fetchProxyHealth, type ProxyHealthConfig } from "./azure-monitor";
import { createAuditLog } from "./audit";
import { PROXY_HEALTH_SYNC_WINDOW_MINUTES } from "./proxy-health-constants";

/**
 * One-shot Azure Monitor → `ProxyHealthSnapshot` sync, shared by the manual
 * `POST /api/proxy-health/sync` (admin button on the board) and the scheduled
 * `GET /api/cron/proxy-health` (every 15 minutes via Vercel Cron).
 *
 * Always persists exactly one snapshot row, whether the Monitor query
 * succeeded or failed — a row with `syncError` set is the board's "last
 * attempt failed" indicator, and its `capturedAt` is what "last synced N min
 * ago" is computed from.
 */

/** Sentinel actor the cron passes. Matches the scheduler convention elsewhere. */
export const SYSTEM_ACTOR = "system";

export {
  PROXY_HEALTH_SYNC_WINDOW_MINUTES,
  PROXY_HEALTH_SYNC_INTERVAL_MINUTES,
} from "./proxy-health-constants";

export type ProxyHealthSyncResult =
  | { ok: true; snapshot: ProxyHealthSnapshot }
  | { ok: false; snapshot: ProxyHealthSnapshot; error: string };

type SnapshotClient = {
  proxyHealthSnapshot: {
    create: typeof prisma.proxyHealthSnapshot.create;
  };
  auditLog: {
    create: typeof prisma.auditLog.create;
  };
};

export type ProxyHealthSyncDeps = {
  db?: SnapshotClient;
  fetchHealth?: typeof fetchProxyHealth;
  now?: () => Date;
};

/**
 * @param config      Loaded Azure Monitor config (callers decide what to do
 *                    when it is null — the manual route 400s, the cron skips).
 * @param triggeredBy userId of the admin who pressed "Sync now", or
 *                    `SYSTEM_ACTOR` for the scheduled run. `AuditLog.userId`
 *                    is a foreign key to `User`, so system-triggered syncs
 *                    are not audit-logged; the snapshot row itself is the
 *                    record of the run.
 */
export async function runProxyHealthSync(
  config: ProxyHealthConfig,
  triggeredBy: string,
  deps: ProxyHealthSyncDeps = {}
): Promise<ProxyHealthSyncResult> {
  const db = deps.db ?? prisma;
  const fetchHealth = deps.fetchHealth ?? fetchProxyHealth;
  const now = deps.now ?? (() => new Date());
  const windowMinutes = PROXY_HEALTH_SYNC_WINDOW_MINUTES;

  try {
    const health = await fetchHealth(config, windowMinutes);
    const snapshot = await db.proxyHealthSnapshot.create({
      data: {
        windowStart: health.windowStart,
        windowEnd: health.windowEnd,
        invocationCount: health.invocationCount,
        http2xxCount: health.http2xxCount,
        http4xxCount: health.http4xxCount,
        http5xxCount: health.http5xxCount,
        avgResponseTimeMs: health.avgResponseTimeMs,
        rawMetrics: health.rawMetrics as object,
      },
    });

    if (triggeredBy !== SYSTEM_ACTOR) {
      await createAuditLog(
        {
          userId: triggeredBy,
          action: "SYNC",
          entityType: "ProxyHealth",
          entityId: snapshot.id,
        },
        db
      );
    }

    return { ok: true, snapshot };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const windowEnd = now();
    const snapshot = await db.proxyHealthSnapshot.create({
      data: {
        windowStart: new Date(windowEnd.getTime() - windowMinutes * 60 * 1000),
        windowEnd,
        syncError: message,
      },
    });
    return { ok: false, snapshot, error: message };
  }
}
