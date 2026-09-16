/**
 * Pure scheduling logic for the per-provider sync crons and per-source
 * discovery-scan crons. No I/O lives here so it can be unit tested; the
 * database-backed orchestration is in `background-jobs.ts`.
 */

export const SYNC_PROVIDERS = [
  "anthropic",
  "claude_code",
  "cursor",
  "gemini",
  "openai",
  "openrouter",
  "helicone",
  "portkey",
  "litellm",
] as const;

export type SyncProviderId = (typeof SYNC_PROVIDERS)[number];

export const SYNC_PROVIDER_LABELS: Record<SyncProviderId, string> = {
  anthropic: "Anthropic telemetry",
  claude_code: "Claude Code analytics",
  cursor: "Cursor admin usage & spend",
  gemini: "Gemini telemetry",
  openai: "OpenAI telemetry",
  openrouter: "OpenRouter activity",
  helicone: "Helicone request logs",
  portkey: "Portkey analytics",
  litellm: "LiteLLM spend logs",
};

export function isSyncProvider(value: string): value is SyncProviderId {
  return (SYNC_PROVIDERS as readonly string[]).includes(value);
}

export const DISCOVERY_SCAN_SOURCES = [
  "google_workspace",
  "microsoft_365",
  "hexnode",
  "crowdstrike",
] as const;

export type DiscoveryScanSource = (typeof DISCOVERY_SCAN_SOURCES)[number];

export const DISCOVERY_SCAN_LABELS: Record<DiscoveryScanSource, string> = {
  google_workspace: "Google Workspace",
  microsoft_365: "Microsoft 365",
  hexnode: "Hexnode",
  crowdstrike: "CrowdStrike",
};

export function isDiscoveryScanSource(value: string): value is DiscoveryScanSource {
  return (DISCOVERY_SCAN_SOURCES as readonly string[]).includes(value);
}

/** Global defaults when neither a provider override nor a global key is set. */
export const PROVIDER_SYNC_DEFAULT_ENABLED = true;
export const PROVIDER_SYNC_DEFAULT_INTERVAL_HOURS = 6;

/** How long a RUNNING sync is trusted before it is assumed dead. */
export const PROVIDER_SYNC_RUNNING_GRACE_MS = 30 * 60 * 1000;
/** How long a `running` scan is trusted before it is failed as timed out. */
export const DISCOVERY_SCAN_RUNNING_GRACE_MS = 10 * 60 * 1000;

export function parseBooleanSetting(value: string | null | undefined, defaultValue: boolean) {
  if (value === null || value === undefined || value === "") return defaultValue;
  return value === "true";
}

export function parseIntervalHours(value: string | null | undefined, defaultValue: number) {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return defaultValue;
  return parsed;
}

export function isDue(lastCompletedAt: Date | null, intervalHours: number, now: Date) {
  if (!lastCompletedAt) return true;
  return now.getTime() - lastCompletedAt.getTime() >= intervalHours * 60 * 60 * 1000;
}

export function nextDueAt(lastCompletedAt: Date | null, intervalHours: number): Date | null {
  if (!lastCompletedAt) return null;
  return new Date(lastCompletedAt.getTime() + intervalHours * 60 * 60 * 1000);
}

export type ScheduleSettingSource = "provider" | "global" | "default";

export type ProviderSyncScheduleInput = {
  /** Raw `provider_sync_enabled` value (global). */
  globalEnabledRaw: string | null;
  /** Raw `provider_sync_interval_hours` value (global). */
  globalIntervalRaw: string | null;
  /** Raw `provider_sync_<provider>_enabled` value; null means inherit. */
  providerEnabledRaw: string | null;
  /** Raw `provider_sync_<provider>_interval_hours` value; null means inherit. */
  providerIntervalRaw: string | null;
  /** completedAt of the latest SUCCEEDED run **for this provider**. */
  lastSucceededAt: Date | null;
  /** True when a RUNNING row for this provider is younger than the grace period. */
  running: boolean;
  /** False when the provider's admin key / export is not configured. */
  configured: boolean;
  now: Date;
};

export type ProviderSyncSchedule = {
  enabled: boolean;
  enabledSource: ScheduleSettingSource;
  intervalHours: number;
  intervalSource: ScheduleSettingSource;
  due: boolean;
  nextDueAt: Date | null;
  skippedReason?: string;
};

/**
 * Resolve the effective schedule for one provider. Provider-level keys win,
 * then the global keys, then the built-in defaults. Due-ness is keyed off the
 * latest successful run of *this* provider only, so a healthy Anthropic sync
 * can no longer reset the clock for a stalled Cursor sync.
 */
export function resolveProviderSyncSchedule(input: ProviderSyncScheduleInput): ProviderSyncSchedule {
  const hasProviderEnabled = input.providerEnabledRaw !== null && input.providerEnabledRaw !== "";
  const hasGlobalEnabled = input.globalEnabledRaw !== null && input.globalEnabledRaw !== "";
  const enabled = hasProviderEnabled
    ? parseBooleanSetting(input.providerEnabledRaw, PROVIDER_SYNC_DEFAULT_ENABLED)
    : parseBooleanSetting(input.globalEnabledRaw, PROVIDER_SYNC_DEFAULT_ENABLED);
  const enabledSource: ScheduleSettingSource = hasProviderEnabled
    ? "provider"
    : hasGlobalEnabled
      ? "global"
      : "default";

  const globalInterval = parseIntervalHours(input.globalIntervalRaw, PROVIDER_SYNC_DEFAULT_INTERVAL_HOURS);
  const providerIntervalParsed = Number.parseInt(input.providerIntervalRaw ?? "", 10);
  const hasProviderInterval = Number.isFinite(providerIntervalParsed) && providerIntervalParsed > 0;
  const intervalHours = hasProviderInterval ? providerIntervalParsed : globalInterval;
  const intervalSource: ScheduleSettingSource = hasProviderInterval
    ? "provider"
    : input.globalIntervalRaw !== null && input.globalIntervalRaw !== ""
      ? "global"
      : "default";

  const dueByClock = isDue(input.lastSucceededAt, intervalHours, input.now);
  const due = enabled && input.configured && !input.running && dueByClock;

  const skippedReason = !enabled
    ? "Sync is disabled."
    : !input.configured
      ? "Provider is not configured."
      : input.running
        ? "A sync for this provider is already running."
        : !dueByClock
          ? `Not due yet. Interval is ${intervalHours} hour(s).`
          : undefined;

  return {
    enabled,
    enabledSource,
    intervalHours,
    intervalSource,
    due,
    nextDueAt: nextDueAt(input.lastSucceededAt, intervalHours),
    skippedReason,
  };
}

export type DiscoveryScanScheduleInput = {
  enabledRaw: string | null;
  intervalRaw: string | null;
  lastCompletedAt: Date | null;
  running: boolean;
  configured: boolean;
  now: Date;
};

export type DiscoveryScanSchedule = {
  enabled: boolean;
  intervalHours: number;
  due: boolean;
  nextDueAt: Date | null;
  skippedReason?: string;
};

export const DISCOVERY_SCAN_DEFAULT_INTERVAL_HOURS = 24;

export function resolveDiscoveryScanSchedule(
  source: DiscoveryScanSource,
  input: DiscoveryScanScheduleInput
): DiscoveryScanSchedule {
  const label = DISCOVERY_SCAN_LABELS[source];
  const enabled = parseBooleanSetting(input.enabledRaw, false);
  const intervalHours = parseIntervalHours(input.intervalRaw, DISCOVERY_SCAN_DEFAULT_INTERVAL_HOURS);
  const dueByClock = isDue(input.lastCompletedAt, intervalHours, input.now);
  const due = enabled && input.configured && !input.running && dueByClock;

  const skippedReason = !enabled
    ? `${label} auto-scan is disabled.`
    : !input.configured
      ? `${label} is not configured.`
      : input.running
        ? `A ${label} scan is already running.`
        : !dueByClock
          ? `Not due yet. Interval is ${intervalHours} hour(s).`
          : undefined;

  return {
    enabled,
    intervalHours,
    due,
    nextDueAt: nextDueAt(input.lastCompletedAt, intervalHours),
    skippedReason,
  };
}

// ---------------------------------------------------------------------------
// Directory sync (/api/cron/directory-sync/[source])
// ---------------------------------------------------------------------------

export const DIRECTORY_SYNC_SOURCES = ["google_workspace", "microsoft_365"] as const;

export type DirectorySyncSource = (typeof DIRECTORY_SYNC_SOURCES)[number];

export const DIRECTORY_SYNC_LABELS: Record<DirectorySyncSource, string> = {
  google_workspace: "Google Workspace directory",
  microsoft_365: "Microsoft Entra ID directory",
};

export function isDirectorySyncSource(value: string): value is DirectorySyncSource {
  return (DIRECTORY_SYNC_SOURCES as readonly string[]).includes(value);
}

/** Directory syncs are opt-in and daily by default. */
export const DIRECTORY_SYNC_DEFAULT_ENABLED = false;
export const DIRECTORY_SYNC_DEFAULT_INTERVAL_HOURS = 24;
/** How long a RUNNING directory sync is trusted before it is assumed dead. */
export const DIRECTORY_SYNC_RUNNING_GRACE_MS = 30 * 60 * 1000;

export type DirectorySyncScheduleInput = {
  enabledRaw: string | null;
  intervalRaw: string | null;
  /** completedAt of the latest SUCCEEDED directory run for this source. */
  lastSucceededAt: Date | null;
  running: boolean;
  configured: boolean;
  now: Date;
};

export type DirectorySyncSchedule = {
  enabled: boolean;
  intervalHours: number;
  due: boolean;
  nextDueAt: Date | null;
  skippedReason?: string;
};

export function resolveDirectorySyncSchedule(
  source: DirectorySyncSource,
  input: DirectorySyncScheduleInput
): DirectorySyncSchedule {
  const label = DIRECTORY_SYNC_LABELS[source];
  const enabled = parseBooleanSetting(input.enabledRaw, DIRECTORY_SYNC_DEFAULT_ENABLED);
  const intervalHours = parseIntervalHours(input.intervalRaw, DIRECTORY_SYNC_DEFAULT_INTERVAL_HOURS);
  const dueByClock = isDue(input.lastSucceededAt, intervalHours, input.now);
  const due = enabled && input.configured && !input.running && dueByClock;

  const skippedReason = !enabled
    ? `${label} sync is disabled.`
    : !input.configured
      ? `${label} credentials are not configured.`
      : input.running
        ? `A ${label} sync is already running.`
        : !dueByClock
          ? `Not due yet. Interval is ${intervalHours} hour(s).`
          : undefined;

  return {
    enabled,
    intervalHours,
    due,
    nextDueAt: nextDueAt(input.lastSucceededAt, intervalHours),
    skippedReason,
  };
}
