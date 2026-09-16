/**
 * Pure helpers for incremental provider sync windows.
 *
 * Every `sync*Telemetry` function in provider-telemetry.ts takes an explicit
 * `{ from, to }` window. The job layer (background-jobs.ts) derives that
 * window from the provider's `ProviderSyncWatermark` row using the rules in
 * this module; the Backfill control on Settings → Provider Admin APIs walks an
 * arbitrary range in fixed-size chunks with `buildBackfillChunks`.
 *
 * This module has no runtime dependencies so it can be imported by client
 * components and unit-tested offline.
 */

import {
  SYNC_PROVIDERS,
  SYNC_PROVIDER_LABELS,
  isSyncProvider,
  type SyncProviderId,
} from "./provider-sync-schedule";

// The provider list lives in provider-sync-schedule.ts (also pure); these
// re-exports keep the window helpers self-contained for their callers.
export { SYNC_PROVIDERS, SYNC_PROVIDER_LABELS, isSyncProvider };
export type SyncProvider = SyncProviderId;

export type SyncWindow = {
  /** Inclusive lower bound (UTC). */
  from: Date;
  /** Exclusive upper bound (UTC). */
  to: Date;
};

export const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Days re-pulled before the watermark on every scheduled sync. Providers
 * revise recent days (late-arriving usage, cost corrections), so the last
 * few ingested days are always refreshed.
 */
export const DEFAULT_OVERLAP_DAYS = 2;

/**
 * How far back each provider retains history upstream (or how far back a
 * sync is allowed to reach). A scheduled window never starts earlier than
 * `now - maxLookbackDays`.
 *
 *   Cursor Admin API retains ~30 days; Anthropic/OpenAI usage and cost
 *   reports and the Gemini billing export go back much further; gateway
 *   request logs are treated as 30 days; GitHub Copilot usage reports are
 *   kept one year (the Copilot sync itself walks at most 28 days per run).
 */
export const PROVIDER_MAX_LOOKBACK_DAYS: Record<SyncProvider, number> = {
  anthropic: 90,
  claude_code: 90,
  openai: 90,
  gemini: 90,
  cursor: 30,
  github_copilot: 365,
  openrouter: 30,
  helicone: 30,
  portkey: 30,
  litellm: 30,
  // Compliance API streams are cursor-based (per-stream watermarks inside the
  // sync); the date window only labels the run.
  chatgpt_enterprise: 30,
};

/**
 * Upper bound on a single *scheduled* window. Without a watermark (fresh
 * install, or a provider that has never succeeded) the window would
 * otherwise reach the full max lookback in one 60-second function; 31 days
 * matches the Anthropic report page maximum and Cursor's retention. Deeper
 * history is pulled with Backfill, one 7-day chunk per request.
 */
export const SCHEDULED_MAX_WINDOW_DAYS = 31;

/** Chunk size the Backfill control walks, one request per chunk. */
export const BACKFILL_CHUNK_DAYS = 7;

/** Largest range a single admin-sync request may ask a provider for. */
export const MAX_REQUEST_WINDOW_DAYS = 31;

export function startOfUtcDay(input: Date): Date {
  return new Date(Date.UTC(input.getUTCFullYear(), input.getUTCMonth(), input.getUTCDate()));
}

export function addDays(input: Date, days: number): Date {
  return new Date(input.getTime() + days * DAY_MS);
}

export function daysBetween(from: Date, to: Date): number {
  return (to.getTime() - from.getTime()) / DAY_MS;
}

export type ComputeSyncWindowInput = {
  provider: SyncProvider;
  /** `ProviderSyncWatermark.watermark` for the provider, or null when none. */
  watermark: Date | null;
  now: Date;
  overlapDays?: number;
  maxLookbackDays?: number;
  /** Cap on the scheduled window length; defaults to SCHEDULED_MAX_WINDOW_DAYS. */
  maxWindowDays?: number;
};

/**
 * Compute the scheduled sync window for a provider.
 *
 *   from = max(watermark - overlapDays, now - maxLookbackDays)
 *   to   = now
 *
 * `from` is snapped to UTC midnight so the window always covers whole bucket
 * days. With no watermark the window is `now - min(maxLookbackDays,
 * maxWindowDays)`; the same cap applies when a stale watermark would open a
 * window longer than `maxWindowDays`.
 *
 * (The Tier 2 plan writes this as `min(...)`; the intent — never reach
 * further back than the provider retains — is the `max` of the two lower
 * bounds, which is what this implements.)
 */
export function computeSyncWindow(input: ComputeSyncWindowInput): SyncWindow {
  // Overlap may legitimately be 0 (no re-pull); negative / NaN falls back.
  const overlapDays =
    typeof input.overlapDays === "number" && Number.isFinite(input.overlapDays) && input.overlapDays >= 0
      ? input.overlapDays
      : DEFAULT_OVERLAP_DAYS;
  const maxLookbackDays = sanitizeDays(
    input.maxLookbackDays,
    PROVIDER_MAX_LOOKBACK_DAYS[input.provider],
  );
  const maxWindowDays = sanitizeDays(input.maxWindowDays, SCHEDULED_MAX_WINDOW_DAYS);
  const now = input.now;

  const lookbackFloor = startOfUtcDay(addDays(now, -maxLookbackDays));
  const windowFloor = startOfUtcDay(addDays(now, -maxWindowDays));
  const floor = lookbackFloor > windowFloor ? lookbackFloor : windowFloor;

  let from = floor;
  if (input.watermark) {
    const overlapStart = startOfUtcDay(addDays(input.watermark, -overlapDays));
    from = overlapStart > floor ? overlapStart : floor;
  }

  // A watermark in the future (clock skew) must not produce an empty or
  // inverted window; fall back to re-pulling the last `overlapDays`.
  if (from >= now) {
    from = startOfUtcDay(addDays(now, -overlapDays));
  }

  return { from, to: now };
}

/**
 * Split `[from, to)` into consecutive chunks of at most `chunkDays` days.
 * The last chunk is clamped to `to`. Returns [] when the range is empty.
 */
export function buildBackfillChunks(
  from: Date,
  to: Date,
  chunkDays: number = BACKFILL_CHUNK_DAYS,
): SyncWindow[] {
  const chunks: SyncWindow[] = [];
  if (!(from instanceof Date) || !(to instanceof Date)) return chunks;
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to <= from) return chunks;
  const size = sanitizeDays(chunkDays, BACKFILL_CHUNK_DAYS);

  let cursor = from;
  while (cursor < to) {
    const next = addDays(cursor, size);
    chunks.push({ from: cursor, to: next < to ? next : to });
    cursor = next;
  }
  return chunks;
}

export type WatermarkState = {
  watermark: Date;
  earliest: Date;
};

/**
 * The watermark state after a successful sync of `window`.
 *
 * `watermark` is the UTC midnight of the window end — everything strictly
 * before it has been ingested. A backfill of an older range never moves the
 * watermark backwards; `earliest` only ever moves earlier.
 */
export function advanceWatermark(
  existing: WatermarkState | null,
  window: SyncWindow,
): WatermarkState {
  const windowMark = startOfUtcDay(window.to);
  const windowEarliest = startOfUtcDay(window.from);

  if (!existing) {
    return { watermark: windowMark, earliest: windowEarliest };
  }

  return {
    watermark: windowMark > existing.watermark ? windowMark : existing.watermark,
    earliest: windowEarliest < existing.earliest ? windowEarliest : existing.earliest,
  };
}

export type RequestedWindowError =
  | "from_and_to_required"
  | "invalid_date"
  | "to_before_from"
  | "window_too_long";

/**
 * Validate a `{ from, to }` pair supplied by an API caller (the Backfill
 * control). Returns the parsed window or an error code.
 */
export function parseRequestedWindow(
  fromRaw: unknown,
  toRaw: unknown,
  maxDays: number = MAX_REQUEST_WINDOW_DAYS,
): { window: SyncWindow } | { error: RequestedWindowError } {
  if (fromRaw === undefined && toRaw === undefined) {
    return { error: "from_and_to_required" };
  }
  if (typeof fromRaw !== "string" || typeof toRaw !== "string") {
    return { error: "from_and_to_required" };
  }
  const from = new Date(fromRaw);
  const to = new Date(toRaw);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    return { error: "invalid_date" };
  }
  if (to <= from) return { error: "to_before_from" };
  if (daysBetween(from, to) > maxDays) return { error: "window_too_long" };
  return { window: { from, to } };
}

function sanitizeDays(value: number | undefined, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return fallback;
  return value;
}
