/**
 * Pure helpers for the "last synced N min ago" indicator on the Proxy Health
 * board. Kept free of Prisma imports so the client component can use them.
 */

import { PROXY_HEALTH_SYNC_INTERVAL_MINUTES } from "./proxy-health-constants";

/** Human-readable age of the latest snapshot, in the wording the board shows. */
export function formatSyncAge(capturedAt: string | Date, now: number = Date.now()): string {
  const ms = now - new Date(capturedAt).getTime();
  if (ms < 60_000) return "just now";
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  return `${Math.floor(hours / 24)} d ago`;
}

export type SyncStaleness = "fresh" | "overdue" | "stale";

/**
 * Whether the scheduled sync appears to be running. The cron fires every
 * PROXY_HEALTH_SYNC_INTERVAL_MINUTES; allow one missed tick plus slack before
 * calling it overdue, and a full hour before calling it stale.
 */
export function syncStaleness(
  capturedAt: string | Date | null | undefined,
  now: number = Date.now()
): SyncStaleness {
  if (!capturedAt) return "stale";
  const minutes = (now - new Date(capturedAt).getTime()) / 60_000;
  if (minutes <= PROXY_HEALTH_SYNC_INTERVAL_MINUTES * 2 + 5) return "fresh";
  if (minutes <= 60) return "overdue";
  return "stale";
}
