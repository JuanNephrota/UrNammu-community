import { prisma } from "./prisma";
import { isOpenAIAdminConfigured } from "./openai-admin";
import { importOpenAIAssistants } from "./openai-assistant-discovery";
import { isAnthropicAdminConfigured } from "./anthropic-admin";
import { isClaudeCodeAnalyticsAvailable } from "./claude-code-analytics";
import { isCursorAdminConfigured } from "./cursor-admin";
import { isGitHubCopilotConfigured } from "./github-copilot-admin";
import { isChatGPTEnterpriseConfigured } from "./chatgpt-enterprise-admin";
import { isGeminiBillingConfigured } from "./gemini-admin";
import { isOpenRouterConfigured } from "./openrouter-admin";
import { isHeliconeConfigured } from "./helicone-admin";
import { isPortkeyConfigured } from "./portkey-admin";
import { isLiteLLMConfigured } from "./litellm-admin";
import { isAnthropicComplianceConfigured } from "./anthropic-compliance";
import { isClaudeEnterpriseConfigured } from "./claude-enterprise-analytics";
import { logger } from "./observability";
import { notifyDatadog } from "./datadog-client";
import {
  syncAnthropicCompliance,
  syncAnthropicTelemetry,
  syncChatGPTEnterprise,
  syncClaudeCodeAnalytics,
  syncClaudeEnterpriseAnalytics,
  syncCursorTelemetry,
  syncGeminiTelemetry,
  syncGitHubCopilotTelemetry,
  syncHeliconeTelemetry,
  syncLiteLLMTelemetry,
  syncOpenAITelemetry,
  syncOpenRouterTelemetry,
  syncPortkeyTelemetry,
  type SyncResult,
} from "./provider-telemetry";
import { computeSyncWindow, DEFAULT_OVERLAP_DAYS, type SyncWindow } from "./provider-sync-window";
import { executeScan } from "./scan-executor";
import {
  GOVERNANCE_AUTOMATION_SETTINGS_KEYS,
  getSetting,
  getSettings,
  GOOGLE_SETTINGS_KEYS,
  HEXNODE_SETTINGS_KEYS,
  CROWDSTRIKE_SETTINGS_KEYS,
  MICROSOFT_SHADOW_AI_SETTINGS_KEYS,
  AGENT_PLATFORM_SETTINGS_KEYS,
  PROVIDER_SYNC_SETTINGS_KEYS,
  providerSyncSettingKeys,
  directorySyncSettingKeys,
} from "./settings";
import { isGoogleWorkspaceConfigured } from "./google-workspace";
import { isMicrosoft365Configured } from "./microsoft-365-shadow-ai";
import { isHexnodeConfigured } from "./hexnode";
import { isCrowdStrikeConfigured } from "./crowdstrike";
import {
  executeAgentPlatformScan,
  isAgentPlatformImportConfigured,
  type AgentPlatformScanResult,
} from "./agent-platform-imports";
import { evaluateGovernanceAutomation } from "./governance-automation";
import {
  runKeyUsageRuleEvaluation,
  type KeyUsageEvaluationResult,
} from "./key-usage-evaluation";
import {
  DIRECTORY_SYNC_LABELS,
  DIRECTORY_SYNC_RUNNING_GRACE_MS,
  DIRECTORY_SYNC_SOURCES,
  DISCOVERY_SCAN_LABELS,
  DISCOVERY_SCAN_RUNNING_GRACE_MS,
  DISCOVERY_SCAN_SOURCES,
  PROVIDER_SYNC_RUNNING_GRACE_MS,
  parseIntervalHours,
  resolveDirectorySyncSchedule,
  resolveDiscoveryScanSchedule,
  resolveProviderSyncSchedule,
  SYNC_PROVIDER_LABELS,
  SYNC_PROVIDERS,
  type DirectorySyncSchedule,
  type DirectorySyncSource,
  type DiscoveryScanSchedule,
  type DiscoveryScanSource,
  type ProviderSyncSchedule,
  type SyncProviderId,
} from "./provider-sync-schedule";
import {
  DIRECTORY_SYNC_TYPE,
  isDirectorySourceConfigured,
  runDirectorySync,
  type DirectorySyncCounts,
  type DirectorySyncResult,
} from "./directory-sync";
import {
  evaluateUsageAfterDeactivation,
  type ObservedActivity,
} from "./governance-automation";

type BackgroundActor = string;

const PROVIDER_SYNC_FUNCTIONS: Record<
  SyncProviderId,
  (triggeredByUserId: BackgroundActor, window: SyncWindow) => Promise<SyncResult>
> = {
  anthropic: syncAnthropicTelemetry,
  claude_code: syncClaudeCodeAnalytics,
  cursor: syncCursorTelemetry,
  github_copilot: syncGitHubCopilotTelemetry,
  gemini: syncGeminiTelemetry,
  openai: syncOpenAITelemetry,
  openrouter: syncOpenRouterTelemetry,
  helicone: syncHeliconeTelemetry,
  portkey: syncPortkeyTelemetry,
  litellm: syncLiteLLMTelemetry,
  chatgpt_enterprise: syncChatGPTEnterprise,
  anthropic_compliance: syncAnthropicCompliance,
  claude_enterprise: syncClaudeEnterpriseAnalytics,
};

const PROVIDER_CONFIGURED_CHECKS: Record<SyncProviderId, () => Promise<boolean>> = {
  anthropic: isAnthropicAdminConfigured,
  claude_code: isClaudeCodeAnalyticsAvailable,
  cursor: isCursorAdminConfigured,
  github_copilot: isGitHubCopilotConfigured,
  gemini: isGeminiBillingConfigured,
  openai: isOpenAIAdminConfigured,
  openrouter: isOpenRouterConfigured,
  helicone: isHeliconeConfigured,
  portkey: isPortkeyConfigured,
  litellm: isLiteLLMConfigured,
  chatgpt_enterprise: isChatGPTEnterpriseConfigured,
  anthropic_compliance: isAnthropicComplianceConfigured,
  claude_enterprise: isClaudeEnterpriseConfigured,
};

const DISCOVERY_SCAN_SETTINGS: Record<
  DiscoveryScanSource,
  { enabled: string; intervalHours: string; configured: () => Promise<boolean> }
> = {
  google_workspace: {
    enabled: GOOGLE_SETTINGS_KEYS.SCAN_ENABLED,
    intervalHours: GOOGLE_SETTINGS_KEYS.SCAN_INTERVAL_HOURS,
    configured: isGoogleWorkspaceConfigured,
  },
  microsoft_365: {
    enabled: MICROSOFT_SHADOW_AI_SETTINGS_KEYS.SCAN_ENABLED,
    intervalHours: MICROSOFT_SHADOW_AI_SETTINGS_KEYS.SCAN_INTERVAL_HOURS,
    configured: isMicrosoft365Configured,
  },
  hexnode: {
    enabled: HEXNODE_SETTINGS_KEYS.SCAN_ENABLED,
    intervalHours: HEXNODE_SETTINGS_KEYS.SCAN_INTERVAL_HOURS,
    configured: isHexnodeConfigured,
  },
  crowdstrike: {
    enabled: CROWDSTRIKE_SETTINGS_KEYS.SCAN_ENABLED,
    intervalHours: CROWDSTRIKE_SETTINGS_KEYS.SCAN_INTERVAL_HOURS,
    configured: isCrowdStrikeConfigured,
  },
  agent_platforms: {
    enabled: AGENT_PLATFORM_SETTINGS_KEYS.SCAN_ENABLED,
    intervalHours: AGENT_PLATFORM_SETTINGS_KEYS.SCAN_INTERVAL_HOURS,
    configured: isAgentPlatformImportConfigured,
  },
};

/** Outcome of syncing a single provider (one cron invocation). */
export type ProviderSyncOutcome = {
  provider: SyncProviderId;
  label: string;
  status: "succeeded" | "failed" | "skipped";
  error?: string;
  syncRunId?: string;
  usageBucketsUpserted: number;
  costBucketsUpserted: number;
  rawSnapshotsStored: number;
  projectsUpserted: number;
  actorsUpserted: number;
  /** Anthropic Compliance feed only: activity + session rows written. */
  complianceActivitiesUpserted?: number;
  complianceSessionsUpserted?: number;
  alertsCreated?: number;
  /** OpenAI only: assistant inventory follow-up discovery. */
  assistants?: { found: number; created: number; updated: number; error?: string };
  /** The window the run was asked to cover (ISO strings). */
  window?: { from: string; to: string };
  /** True when a paginated fetch hit its page cap (see run metadata + alert). */
  truncated?: boolean;
};

/** Aggregate shape kept for the manual "Sync now" panel (POST /api/admin-sync). */
export type ProviderSyncJobResult = {
  anthropicUsageSynced: number;
  openaiUsageSynced: number;
  openRouterUsageSynced: number;
  heliconeUsageSynced: number;
  portkeyUsageSynced: number;
  litellmUsageSynced: number;
  geminiUsageSynced: number;
  claudeCodeUsageSynced: number;
  cursorUsageSynced: number;
  githubCopilotUsageSynced: number;
  chatgptEnterpriseUsageSynced: number;
  claudeEnterpriseUsageSynced: number;
  anthropicComplianceActivitiesSynced: number;
  anthropicComplianceSessionsSynced: number;
  anthropicCostBucketsSynced: number;
  openaiCostBucketsSynced: number;
  openRouterCostBucketsSynced: number;
  heliconeCostBucketsSynced: number;
  portkeyCostBucketsSynced: number;
  litellmCostBucketsSynced: number;
  geminiCostBucketsSynced: number;
  claudeCodeCostsSynced: number;
  cursorCostBucketsSynced: number;
  githubCopilotCostBucketsSynced: number;
  chatgptEnterpriseCostBucketsSynced: number;
  claudeEnterpriseCostBucketsSynced: number;
  rawSnapshotsStored: number;
  assistantsFound: number;
  agentsCreated: number;
  agentsUpdated: number;
  /** Providers that were intentionally skipped because their admin key /
   *  billing export is not configured. These are not failures. */
  skipped: string[];
  errors: string[];
  /** Per-provider detail behind the aggregate counters. */
  providers: ProviderSyncOutcome[];
  /** When set, only this provider was run (targeted re-sync / backfill). */
  provider?: SyncProviderId;
  /** The window each provider that ran was asked to cover (ISO strings). */
  windows: Partial<Record<SyncProviderId, { from: string; to: string }>>;
  /** Providers whose run hit a pagination cap; see the run metadata + alert. */
  truncated: SyncProviderId[];
};

/** Options for a single-provider run (`runProviderSync`). */
export type ProviderSyncOptions = {
  /**
   * Explicit `{ from, to }` for a targeted re-sync or backfill chunk. Without
   * it the window is derived from the provider's watermark.
   */
  window?: SyncWindow;
  now?: Date;
};

export type ProviderSyncJobOptions = ProviderSyncOptions & {
  /** Restrict the run to one provider. Required when `window` is given. */
  provider?: SyncProviderId;
};

export type ProviderSyncRunSummary = {
  id: string;
  status: string;
  startedAt: Date;
  completedAt: Date | null;
  recordsProcessed: number;
  errorMessage: string | null;
};

/** Everything Settings → Provider Admin APIs needs to render one provider row. */
export type ProviderSyncStatus = {
  provider: SyncProviderId;
  label: string;
  configured: boolean;
  schedule: ProviderSyncSchedule;
  /** Raw provider-level overrides; null means "inherit the global value". */
  overrides: { enabled: string | null; intervalHours: string | null };
  lastRun: ProviderSyncRunSummary | null;
  lastSucceededAt: Date | null;
};

export type ScheduledProviderSyncResult = {
  provider: SyncProviderId;
  label: string;
  configured: boolean;
  enabled: boolean;
  intervalHours: number;
  due: boolean;
  skippedReason?: string;
  nextDueAt: Date | null;
  result?: ProviderSyncOutcome;
};

export type ScheduledDiscoveryScanResult = {
  source: DiscoveryScanSource;
  label: string;
  configured: boolean;
  enabled: boolean;
  intervalHours: number;
  due: boolean;
  skippedReason?: string;
  nextDueAt: Date | null;
  staleScansFailed: number;
  result?: Awaited<ReturnType<typeof executeScan>> | AgentPlatformScanResult;
};

export type GovernanceAutomationJobResult = {
  reviewRenewals: number;
  exceptionRenewals: number;
  ownershipEscalations: number;
  /** New `usage_after_deactivation` alerts raised this run (deduped per person per 7 days). */
  usageAfterDeactivation: number;
};

/** Everything Settings → Users & Identity needs to render one directory-sync card. */
export type DirectorySyncStatus = {
  source: DirectorySyncSource;
  label: string;
  configured: boolean;
  /** True when a RUNNING directory run for this source is younger than the grace period. */
  running: boolean;
  schedule: DirectorySyncSchedule;
  /** Raw saved values; null means "built-in default". */
  settings: { enabled: string | null; intervalHours: string | null };
  lastRun: (ProviderSyncRunSummary & { counts: DirectorySyncCounts | null }) | null;
  lastSucceededAt: Date | null;
};

export type ScheduledDirectorySyncResult = {
  source: DirectorySyncSource;
  label: string;
  configured: boolean;
  enabled: boolean;
  intervalHours: number;
  due: boolean;
  skippedReason?: string;
  nextDueAt: Date | null;
  staleRunsFailed: number;
  result?: DirectorySyncResult;
};

/**
 * Compatibility shape returned by the deprecated `/api/scheduler/maintenance`
 * shim. New deployments schedule the per-job `/api/cron/**` routes instead.
 */
export type ScheduledMaintenanceResult = {
  deprecated: string;
  providerSync: Record<SyncProviderId, ScheduledProviderSyncResult>;
  discoveryScans: Record<DiscoveryScanSource, ScheduledDiscoveryScanResult>;
  governanceAutomation: GovernanceAutomationJobResult;
  keyUsageRules: KeyUsageEvaluationResult;
};

async function syncGovernanceAutomationAlerts(input: {
  source: string;
  candidates: Array<{
    key: string;
    aiSystemId: string;
    title: string;
    description: string;
    severity: "HIGH" | "MEDIUM" | "LOW";
  }>;
}) {
  const openAlerts = await prisma.alert.findMany({
    where: {
      source: input.source,
      status: { in: ["OPEN", "ACKNOWLEDGED"] },
    },
    select: { id: true, title: true, aiSystemId: true },
  });

  const desiredKeys = new Set(input.candidates.map((candidate) => candidate.key));

  for (const candidate of input.candidates) {
    const existing = openAlerts.find(
      (alert) => alert.aiSystemId === candidate.aiSystemId && alert.title === candidate.title
    );

    if (existing) {
      await prisma.alert.update({
        where: { id: existing.id },
        data: {
          description: candidate.description,
          severity: candidate.severity,
        },
      });
      continue;
    }

    await prisma.alert.create({
      data: {
        title: candidate.title,
        description: candidate.description,
        severity: candidate.severity,
        source: input.source,
        aiSystemId: candidate.aiSystemId,
      },
    });

    await notifyDatadog({
      title: `[UrNammu] ${candidate.title}`,
      text: candidate.description,
      tags: [
        "source:urnammu",
        `alert_source:${input.source}`,
        `severity:${candidate.severity.toLowerCase()}`,
        `ai_system:${candidate.aiSystemId}`,
      ],
      alertType:
        candidate.severity === "HIGH"
          ? "error"
          : candidate.severity === "MEDIUM"
            ? "warning"
            : "info",
      aggregationKey: `urnammu:${input.source}:${candidate.aiSystemId}`,
    });
  }

  for (const alert of openAlerts) {
    const stillDesired = input.candidates.some(
      (candidate) => candidate.aiSystemId === alert.aiSystemId && candidate.title === alert.title
    );
    if (!stillDesired) {
      await prisma.alert.update({
        where: { id: alert.id },
        data: { status: "RESOLVED" },
      });
    }
  }

  return desiredKeys.size;
}

/**
 * Discover OpenAI Assistants as agents. Runs after a successful OpenAI
 * telemetry sync so the inventory and the usage data come from the same key.
 * Writes DiscoveredAgent rows (source `openai_assistants`) and links, rather
 * than duplicates, the AIAgent rows the pre-discovery importer created.
 */
async function discoverOpenAIAssistants(): Promise<NonNullable<ProviderSyncOutcome["assistants"]>> {
  return importOpenAIAssistants();
}

function parseOverlapDays(value: string | null) {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed) || parsed < 0) return DEFAULT_OVERLAP_DAYS;
  return parsed;
}

/**
 * The scheduled window for one provider, derived from its
 * `ProviderSyncWatermark` (see `computeSyncWindow`). A provider without a
 * watermark gets the capped initial window.
 */
export async function getProviderSyncWindow(provider: SyncProviderId, now = new Date()): Promise<SyncWindow> {
  const [watermark, overlapRaw] = await Promise.all([
    prisma.providerSyncWatermark.findUnique({ where: { provider }, select: { watermark: true } }),
    getSetting(PROVIDER_SYNC_SETTINGS_KEYS.OVERLAP_DAYS),
  ]);
  return computeSyncWindow({
    provider,
    watermark: watermark?.watermark ?? null,
    now,
    overlapDays: parseOverlapDays(overlapRaw),
  });
}

/** The scheduled window for every provider (one watermark read). */
export async function getProviderSyncWindows(now = new Date()): Promise<Record<SyncProviderId, SyncWindow>> {
  const [watermarks, overlapRaw] = await Promise.all([
    prisma.providerSyncWatermark.findMany({ select: { provider: true, watermark: true } }),
    getSetting(PROVIDER_SYNC_SETTINGS_KEYS.OVERLAP_DAYS),
  ]);
  const overlapDays = parseOverlapDays(overlapRaw);
  const watermarkByProvider = new Map(watermarks.map((row) => [row.provider, row.watermark]));

  const windows = {} as Record<SyncProviderId, SyncWindow>;
  for (const provider of SYNC_PROVIDERS) {
    windows[provider] = computeSyncWindow({
      provider,
      watermark: watermarkByProvider.get(provider) ?? null,
      now,
      overlapDays,
    });
  }
  return windows;
}

/**
 * Sync exactly one provider. This is the unit of work behind
 * `/api/cron/provider-sync/[provider]` and each Backfill chunk; a provider
 * that is not configured is reported as skipped without touching the
 * upstream API or ProviderSyncRun. The window comes from the provider's
 * watermark unless an explicit one is given.
 */
export async function runProviderSync(
  provider: SyncProviderId,
  triggeredByUserId: BackgroundActor,
  options: ProviderSyncOptions = {},
): Promise<ProviderSyncOutcome> {
  const label = SYNC_PROVIDER_LABELS[provider];
  const window = options.window ?? (await getProviderSyncWindow(provider, options.now ?? new Date()));
  const windowIso = { from: window.from.toISOString(), to: window.to.toISOString() };

  logger.info("provider_sync.requested", {
    provider,
    userId: triggeredByUserId,
    trigger: triggeredByUserId === "system" ? "scheduler" : options.window ? "backfill" : "manual",
    window: windowIso,
  });

  let raw: SyncResult;
  try {
    raw = await PROVIDER_SYNC_FUNCTIONS[provider](triggeredByUserId, window);
  } catch (error) {
    // The sync functions catch their own errors and fail the run row, so this
    // is only reached for programming errors (e.g. a thrown non-Error).
    raw = {
      provider,
      success: false,
      error: error instanceof Error ? error.message : "Unknown sync error",
    };
  }

  const outcome: ProviderSyncOutcome = {
    provider,
    label,
    status: raw.success ? "succeeded" : "skipped" in raw && raw.skipped ? "skipped" : "failed",
    error: raw.success ? undefined : raw.error,
    syncRunId: raw.success ? raw.syncRunId : undefined,
    usageBucketsUpserted: raw.success ? raw.usageBucketsUpserted : 0,
    costBucketsUpserted: raw.success ? raw.costBucketsUpserted : 0,
    rawSnapshotsStored: raw.success ? raw.rawSnapshotsStored : 0,
    projectsUpserted: raw.success ? raw.projectsUpserted : 0,
    actorsUpserted: raw.success ? raw.actorsUpserted : 0,
    window: windowIso,
    truncated: raw.success ? raw.truncated : false,
    complianceActivitiesUpserted: raw.success ? raw.complianceActivitiesUpserted : undefined,
    complianceSessionsUpserted: raw.success ? raw.complianceSessionsUpserted : undefined,
    alertsCreated: raw.success ? raw.alertsCreated : undefined,
  };

  // Assistant inventory rides along with a regular OpenAI sync; a backfill
  // chunk is about history, so it skips the inventory pass.
  if (provider === "openai" && raw.success && !options.window) {
    outcome.assistants = await discoverOpenAIAssistants();
  }

  logger.info("provider_sync.completed", {
    provider,
    userId: triggeredByUserId,
    status: outcome.status,
    error: outcome.error,
    window: windowIso,
    truncated: outcome.truncated,
    usageBucketsUpserted: outcome.usageBucketsUpserted,
    costBucketsUpserted: outcome.costBucketsUpserted,
    assistants: outcome.assistants,
  });

  return outcome;
}

/**
 * Sync every provider at once, or one provider (optionally over an explicit
 * window — a Backfill chunk). Used by POST /api/admin-sync; the scheduler
 * runs providers individually via `runScheduledProviderSync` so one slow
 * provider cannot starve the others.
 */
export async function runProviderSyncJob(
  triggeredByUserId: BackgroundActor,
  options: ProviderSyncJobOptions = {},
): Promise<ProviderSyncJobResult> {
  const now = options.now ?? new Date();
  const only = options.provider;
  if (options.window && !only) {
    throw new Error("A provider is required when an explicit sync window is given.");
  }
  const providers: readonly SyncProviderId[] = only ? [only] : SYNC_PROVIDERS;
  const outcomes = await Promise.all(
    providers.map((provider) =>
      runProviderSync(provider, triggeredByUserId, { window: only === provider ? options.window : undefined, now })
    )
  );
  return { ...aggregateProviderSyncOutcomes(outcomes), provider: only };
}

export function aggregateProviderSyncOutcomes(outcomes: ProviderSyncOutcome[]): ProviderSyncJobResult {
  const byProvider = new Map(outcomes.map((outcome) => [outcome.provider, outcome]));
  const usage = (provider: SyncProviderId) => byProvider.get(provider)?.usageBucketsUpserted ?? 0;
  const cost = (provider: SyncProviderId) => byProvider.get(provider)?.costBucketsUpserted ?? 0;

  const skipped: string[] = [];
  const errors: string[] = [];
  const truncated: SyncProviderId[] = [];
  const windows: ProviderSyncJobResult["windows"] = {};
  for (const outcome of outcomes) {
    if (outcome.status === "skipped") skipped.push(`${outcome.label}: ${outcome.error}`);
    else if (outcome.status === "failed") errors.push(`${outcome.label}: ${outcome.error}`);
    if (outcome.assistants?.error) errors.push(`OpenAI assistants: ${outcome.assistants.error}`);
    if (outcome.status === "succeeded" && outcome.window) windows[outcome.provider] = outcome.window;
    if (outcome.truncated) truncated.push(outcome.provider);
  }

  const assistants = byProvider.get("openai")?.assistants;

  return {
    anthropicUsageSynced: usage("anthropic"),
    openaiUsageSynced: usage("openai"),
    openRouterUsageSynced: usage("openrouter"),
    heliconeUsageSynced: usage("helicone"),
    portkeyUsageSynced: usage("portkey"),
    litellmUsageSynced: usage("litellm"),
    geminiUsageSynced: usage("gemini"),
    claudeCodeUsageSynced: usage("claude_code"),
    cursorUsageSynced: usage("cursor"),
    githubCopilotUsageSynced: usage("github_copilot"),
    chatgptEnterpriseUsageSynced: usage("chatgpt_enterprise"),
    claudeEnterpriseUsageSynced: usage("claude_enterprise"),
    anthropicComplianceActivitiesSynced: byProvider.get("anthropic_compliance")?.complianceActivitiesUpserted ?? 0,
    anthropicComplianceSessionsSynced: byProvider.get("anthropic_compliance")?.complianceSessionsUpserted ?? 0,
    anthropicCostBucketsSynced: cost("anthropic"),
    openaiCostBucketsSynced: cost("openai"),
    openRouterCostBucketsSynced: cost("openrouter"),
    heliconeCostBucketsSynced: cost("helicone"),
    portkeyCostBucketsSynced: cost("portkey"),
    litellmCostBucketsSynced: cost("litellm"),
    geminiCostBucketsSynced: cost("gemini"),
    claudeCodeCostsSynced: cost("claude_code"),
    cursorCostBucketsSynced: cost("cursor"),
    githubCopilotCostBucketsSynced: cost("github_copilot"),
    chatgptEnterpriseCostBucketsSynced: cost("chatgpt_enterprise"),
    claudeEnterpriseCostBucketsSynced: cost("claude_enterprise"),
    rawSnapshotsStored: outcomes.reduce((sum, outcome) => sum + outcome.rawSnapshotsStored, 0),
    assistantsFound: assistants?.found ?? 0,
    agentsCreated: assistants?.created ?? 0,
    agentsUpdated: assistants?.updated ?? 0,
    skipped,
    errors,
    providers: outcomes,
    windows,
    truncated,
  };
}

// ---------------------------------------------------------------------------
// Per-provider scheduled sync (/api/cron/provider-sync/[provider])
// ---------------------------------------------------------------------------

function summarizeRun(
  run: {
    id: string;
    status: string;
    startedAt: Date;
    completedAt: Date | null;
    recordsProcessed: number;
    errorMessage: string | null;
  } | null
): ProviderSyncRunSummary | null {
  if (!run) return null;
  return {
    id: run.id,
    status: run.status,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    recordsProcessed: run.recordsProcessed,
    errorMessage: run.errorMessage,
  };
}

async function loadProviderSyncRuns(providers: readonly SyncProviderId[], now: Date) {
  const runningSince = new Date(now.getTime() - PROVIDER_SYNC_RUNNING_GRACE_MS);
  const [succeeded, latest, running] = await Promise.all([
    prisma.providerSyncRun.findMany({
      where: {
        provider: { in: [...providers] },
        syncType: "telemetry",
        status: "SUCCEEDED",
        completedAt: { not: null },
      },
      orderBy: { completedAt: "desc" },
      distinct: ["provider"],
    }),
    prisma.providerSyncRun.findMany({
      where: { provider: { in: [...providers] }, syncType: "telemetry" },
      orderBy: { startedAt: "desc" },
      distinct: ["provider"],
    }),
    prisma.providerSyncRun.findMany({
      where: {
        provider: { in: [...providers] },
        syncType: "telemetry",
        status: "RUNNING",
        startedAt: { gte: runningSince },
      },
      select: { provider: true },
      distinct: ["provider"],
    }),
  ]);

  return {
    lastSucceededAt: new Map(succeeded.map((run) => [run.provider, run.completedAt])),
    latestRun: new Map(latest.map((run) => [run.provider, run])),
    running: new Set(running.map((run) => run.provider)),
  };
}

/**
 * Resolve the effective schedule, last run, and configuration state for the
 * given providers. Due-ness is computed **per provider** from that provider's
 * own latest SUCCEEDED run.
 */
export async function getProviderSyncStatuses(
  providers: readonly SyncProviderId[] = SYNC_PROVIDERS,
  now = new Date()
): Promise<ProviderSyncStatus[]> {
  const overrideKeys = providers.flatMap((provider) => {
    const keys = providerSyncSettingKeys(provider);
    return [keys.enabled, keys.intervalHours];
  });

  const [globalEnabledRaw, globalIntervalRaw, overrides, runs, configuredFlags] = await Promise.all([
    getSetting(PROVIDER_SYNC_SETTINGS_KEYS.ENABLED),
    getSetting(PROVIDER_SYNC_SETTINGS_KEYS.INTERVAL_HOURS),
    getSettings(overrideKeys),
    loadProviderSyncRuns(providers, now),
    Promise.all(
      providers.map((provider) =>
        PROVIDER_CONFIGURED_CHECKS[provider]().catch(() => false)
      )
    ),
  ]);

  return providers.map((provider, index) => {
    const keys = providerSyncSettingKeys(provider);
    // getSettings only reads the DB; fall back to the env var the same way
    // getSetting does so PROVIDER_SYNC_<P>_* env overrides are honoured.
    const enabledRaw = overrides[keys.enabled] ?? process.env[keys.enabled.toUpperCase()] ?? null;
    const intervalRaw =
      overrides[keys.intervalHours] ?? process.env[keys.intervalHours.toUpperCase()] ?? null;
    const lastSucceededAt = runs.lastSucceededAt.get(provider) ?? null;
    const configured = configuredFlags[index];

    return {
      provider,
      label: SYNC_PROVIDER_LABELS[provider],
      configured,
      schedule: resolveProviderSyncSchedule({
        globalEnabledRaw,
        globalIntervalRaw,
        providerEnabledRaw: enabledRaw,
        providerIntervalRaw: intervalRaw,
        lastSucceededAt,
        running: runs.running.has(provider),
        configured,
        now,
      }),
      overrides: { enabled: enabledRaw, intervalHours: intervalRaw },
      lastRun: summarizeRun(runs.latestRun.get(provider) ?? null),
      lastSucceededAt,
    };
  });
}

/**
 * Cron entry point for one provider: sync it if (and only if) it is enabled,
 * configured, idle, and past its own interval.
 */
export async function runScheduledProviderSync(
  provider: SyncProviderId,
  now = new Date()
): Promise<ScheduledProviderSyncResult> {
  const [status] = await getProviderSyncStatuses([provider], now);
  const result: ScheduledProviderSyncResult = {
    provider,
    label: status.label,
    configured: status.configured,
    enabled: status.schedule.enabled,
    intervalHours: status.schedule.intervalHours,
    due: status.schedule.due,
    skippedReason: status.schedule.skippedReason,
    nextDueAt: status.schedule.nextDueAt,
  };

  if (status.schedule.due) {
    result.result = await runProviderSync(provider, "system");
  }

  return result;
}

// ---------------------------------------------------------------------------
// Per-source scheduled discovery scan (/api/cron/discovery-scan/[source])
// ---------------------------------------------------------------------------

/**
 * Mark scans stuck in `running` beyond the grace period as failed. Scoped to
 * one source when called from that source's cron so a Hexnode run cannot fail
 * an in-flight Google Workspace scan on a different function.
 */
export async function failStaleScans(now = new Date(), source?: DiscoveryScanSource) {
  const cutoff = new Date(now.getTime() - DISCOVERY_SCAN_RUNNING_GRACE_MS);
  const result = await prisma.scanHistory.updateMany({
    where: {
      status: "running",
      startedAt: { lt: cutoff },
      ...(source ? { scanType: source } : {}),
    },
    data: { status: "failed", errorMessage: "Scan timed out", completedAt: now },
  });
  return result.count;
}

export async function getDiscoveryScanSchedule(
  source: DiscoveryScanSource,
  now = new Date()
): Promise<{ configured: boolean; schedule: DiscoveryScanSchedule; lastCompletedAt: Date | null }> {
  const config = DISCOVERY_SCAN_SETTINGS[source];
  const runningSince = new Date(now.getTime() - DISCOVERY_SCAN_RUNNING_GRACE_MS);

  const [enabledRaw, intervalRaw, latestCompleted, runningScan, configured] = await Promise.all([
    getSetting(config.enabled),
    getSetting(config.intervalHours),
    prisma.scanHistory.findFirst({
      where: { scanType: source, status: "completed", completedAt: { not: null } },
      orderBy: { completedAt: "desc" },
      select: { completedAt: true },
    }),
    prisma.scanHistory.findFirst({
      where: { scanType: source, status: "running", startedAt: { gte: runningSince } },
      select: { id: true },
    }),
    config.configured().catch(() => false),
  ]);

  const lastCompletedAt = latestCompleted?.completedAt ?? null;
  return {
    configured,
    lastCompletedAt,
    schedule: resolveDiscoveryScanSchedule(source, {
      enabledRaw,
      intervalRaw,
      lastCompletedAt,
      running: !!runningScan,
      configured,
      now,
    }),
  };
}

export async function runScheduledDiscoveryScan(
  source: DiscoveryScanSource,
  now = new Date()
): Promise<ScheduledDiscoveryScanResult> {
  const staleScansFailed = await failStaleScans(now, source);
  const { configured, schedule } = await getDiscoveryScanSchedule(source, now);

  const result: ScheduledDiscoveryScanResult = {
    source,
    label: DISCOVERY_SCAN_LABELS[source],
    configured,
    enabled: schedule.enabled,
    intervalHours: schedule.intervalHours,
    due: schedule.due,
    skippedReason: schedule.skippedReason,
    nextDueAt: schedule.nextDueAt,
    staleScansFailed,
  };

  if (schedule.due) {
    result.result =
      source === "agent_platforms"
        ? await executeAgentPlatformScan("system")
        : await executeScan("system", source);
  }

  return result;
}

// ---------------------------------------------------------------------------
// Per-source scheduled directory sync (/api/cron/directory-sync/[source])
// ---------------------------------------------------------------------------

/**
 * Fail directory runs stuck in RUNNING beyond the grace period, scoped to one
 * source so a Google run cannot fail an in-flight Entra run.
 */
export async function failStaleDirectorySyncs(now = new Date(), source?: DirectorySyncSource) {
  const cutoff = new Date(now.getTime() - DIRECTORY_SYNC_RUNNING_GRACE_MS);
  const result = await prisma.providerSyncRun.updateMany({
    where: {
      syncType: DIRECTORY_SYNC_TYPE,
      status: "RUNNING",
      startedAt: { lt: cutoff },
      ...(source ? { provider: source } : {}),
    },
    data: { status: "FAILED", errorMessage: "Directory sync timed out", completedAt: now },
  });
  return result.count;
}

function directoryCountsFromMetadata(metadata: unknown): DirectorySyncCounts | null {
  if (!metadata || typeof metadata !== "object") return null;
  const m = metadata as Record<string, unknown>;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  return {
    fetched: num(m.fetched),
    created: num(m.created),
    updated: num(m.updated),
    deactivated: num(m.deactivated),
    usersSuspended: num(m.usersSuspended),
    pages: num(m.pages),
    truncated: m.truncated === true,
  };
}

/**
 * Resolve schedule, last run, and configuration for the directory-sync
 * sources. Due-ness is keyed off each source's own latest SUCCEEDED run with
 * syncType "directory".
 */
export async function getDirectorySyncStatuses(
  sources: readonly DirectorySyncSource[] = DIRECTORY_SYNC_SOURCES,
  now = new Date()
): Promise<DirectorySyncStatus[]> {
  const settingKeys = sources.flatMap((source) => {
    const keys = directorySyncSettingKeys(source);
    return [keys.enabled, keys.intervalHours];
  });
  const runningSince = new Date(now.getTime() - DIRECTORY_SYNC_RUNNING_GRACE_MS);

  const [settings, succeeded, latest, running, configuredFlags] = await Promise.all([
    getSettings(settingKeys),
    prisma.providerSyncRun.findMany({
      where: {
        provider: { in: [...sources] },
        syncType: DIRECTORY_SYNC_TYPE,
        status: "SUCCEEDED",
        completedAt: { not: null },
      },
      orderBy: { completedAt: "desc" },
      distinct: ["provider"],
      select: { provider: true, completedAt: true },
    }),
    prisma.providerSyncRun.findMany({
      where: { provider: { in: [...sources] }, syncType: DIRECTORY_SYNC_TYPE },
      orderBy: { startedAt: "desc" },
      distinct: ["provider"],
    }),
    prisma.providerSyncRun.findMany({
      where: {
        provider: { in: [...sources] },
        syncType: DIRECTORY_SYNC_TYPE,
        status: "RUNNING",
        startedAt: { gte: runningSince },
      },
      select: { provider: true },
      distinct: ["provider"],
    }),
    Promise.all(sources.map((source) => isDirectorySourceConfigured(source).catch(() => false))),
  ]);

  const lastSucceeded = new Map(succeeded.map((run) => [run.provider, run.completedAt]));
  const latestRun = new Map(latest.map((run) => [run.provider, run]));
  const runningSet = new Set(running.map((run) => run.provider));

  return sources.map((source, index) => {
    const keys = directorySyncSettingKeys(source);
    // getSettings only reads the DB; honour the env fallback like getSetting.
    const enabledRaw = settings[keys.enabled] ?? process.env[keys.enabled.toUpperCase()] ?? null;
    const intervalRaw =
      settings[keys.intervalHours] ?? process.env[keys.intervalHours.toUpperCase()] ?? null;
    const lastSucceededAt = lastSucceeded.get(source) ?? null;
    const configured = configuredFlags[index];
    const run = latestRun.get(source) ?? null;
    const summary = summarizeRun(run);

    return {
      source,
      label: DIRECTORY_SYNC_LABELS[source],
      configured,
      running: runningSet.has(source),
      schedule: resolveDirectorySyncSchedule(source, {
        enabledRaw,
        intervalRaw,
        lastSucceededAt,
        running: runningSet.has(source),
        configured,
        now,
      }),
      settings: { enabled: enabledRaw, intervalHours: intervalRaw },
      lastRun: summary ? { ...summary, counts: directoryCountsFromMetadata(run?.metadata) } : null,
      lastSucceededAt,
    };
  });
}

/**
 * Cron entry point for one directory source: fail its stale runs, then sync
 * if (and only if) it is enabled, configured, idle, and past its interval.
 */
export async function runScheduledDirectorySync(
  source: DirectorySyncSource,
  now = new Date()
): Promise<ScheduledDirectorySyncResult> {
  const staleRunsFailed = await failStaleDirectorySyncs(now, source);
  const [status] = await getDirectorySyncStatuses([source], now);
  const result: ScheduledDirectorySyncResult = {
    source,
    label: status.label,
    configured: status.configured,
    enabled: status.schedule.enabled,
    intervalHours: status.schedule.intervalHours,
    due: status.schedule.due,
    skippedReason: status.schedule.skippedReason,
    nextDueAt: status.schedule.nextDueAt,
    staleRunsFailed,
  };

  if (status.schedule.due) {
    result.result = await runDirectorySync(source, "system");
  }

  return result;
}

// ---------------------------------------------------------------------------
// Governance automation (/api/cron/governance-automation)
// ---------------------------------------------------------------------------

const USAGE_AFTER_DEACTIVATION_SOURCE = "usage_after_deactivation";
const USAGE_AFTER_DEACTIVATION_DEDUPE_MS = 7 * 24 * 60 * 60 * 1000;
/** Only people deactivated this recently are checked; older leavers have had their credentials cleaned up or not, and re-alerting forever helps no one. */
const USAGE_AFTER_DEACTIVATION_LOOKBACK_MS = 180 * 24 * 60 * 60 * 1000;

/**
 * Raise a HIGH alert for every deactivated directory person whose email (or
 * alias) still shows AI activity dated after `deactivatedAt`, across the
 * proxy usage buckets, coding-assistant daily stats, and the proxy request
 * log. One alert per person per 7 days, regardless of alert status.
 */
async function syncUsageAfterDeactivationAlerts(now: Date): Promise<number> {
  const people = await prisma.directoryPerson.findMany({
    where: {
      active: false,
      deactivatedAt: { not: null, gte: new Date(now.getTime() - USAGE_AFTER_DEACTIVATION_LOOKBACK_MS) },
    },
    select: { primaryEmail: true, aliases: true, displayName: true, source: true, deactivatedAt: true },
  });
  if (people.length === 0) return 0;

  const emails = [...new Set(people.flatMap((p) => [p.primaryEmail, ...p.aliases]))];
  const earliest = people.reduce(
    (min, p) => (p.deactivatedAt! < min ? p.deactivatedAt! : min),
    people[0].deactivatedAt!
  );

  const [buckets, stats, logs] = await Promise.all([
    prisma.usageBucket.groupBy({
      by: ["actorExternalId"],
      where: { actorExternalId: { in: emails, mode: "insensitive" }, bucketStart: { gt: earliest } },
      _max: { bucketStart: true },
    }),
    prisma.assistantDailyStat.groupBy({
      by: ["provider", "actorExternalId"],
      where: { actorExternalId: { in: emails, mode: "insensitive" }, day: { gt: earliest } },
      _max: { day: true },
    }),
    prisma.aPIUsageLog.groupBy({
      by: ["userId"],
      where: {
        createdAt: { gt: earliest },
        user: { email: { in: emails, mode: "insensitive" } },
      },
      _max: { createdAt: true },
    }),
  ]);

  const logUserIds = logs.map((l) => l.userId).filter((id): id is string => !!id);
  const logUsers = logUserIds.length
    ? await prisma.user.findMany({ where: { id: { in: logUserIds } }, select: { id: true, email: true } })
    : [];
  const emailByUserId = new Map(logUsers.map((u) => [u.id, u.email]));

  const activity: ObservedActivity[] = [];
  for (const b of buckets) {
    if (b.actorExternalId && b._max.bucketStart) {
      activity.push({ email: b.actorExternalId, surface: "proxy", lastActiveAt: b._max.bucketStart });
    }
  }
  for (const s of stats) {
    if (s._max.day) activity.push({ email: s.actorExternalId, surface: s.provider, lastActiveAt: s._max.day });
  }
  for (const l of logs) {
    const email = l.userId ? emailByUserId.get(l.userId) : null;
    if (email && l._max.createdAt) activity.push({ email, surface: "proxy", lastActiveAt: l._max.createdAt });
  }

  const candidates = evaluateUsageAfterDeactivation({
    people: people.map((p) => ({
      primaryEmail: p.primaryEmail,
      aliases: p.aliases,
      displayName: p.displayName,
      source: p.source,
      deactivatedAt: p.deactivatedAt!,
    })),
    activity,
  });
  if (candidates.length === 0) return 0;

  const recent = await prisma.alert.findMany({
    where: {
      source: USAGE_AFTER_DEACTIVATION_SOURCE,
      createdAt: { gte: new Date(now.getTime() - USAGE_AFTER_DEACTIVATION_DEDUPE_MS) },
      title: { in: candidates.map((c) => c.title) },
    },
    select: { title: true },
  });
  const recentTitles = new Set(recent.map((a) => a.title));

  let created = 0;
  for (const candidate of candidates) {
    if (recentTitles.has(candidate.title)) continue;
    await prisma.alert.create({
      data: {
        title: candidate.title,
        description: candidate.description,
        severity: candidate.severity,
        source: USAGE_AFTER_DEACTIVATION_SOURCE,
      },
    });
    created += 1;
    await notifyDatadog({
      title: `[UrNammu] ${candidate.title}`,
      text: candidate.description,
      tags: [
        "source:urnammu",
        `alert_source:${USAGE_AFTER_DEACTIVATION_SOURCE}`,
        "severity:high",
        ...candidate.surfaces.map((s) => `surface:${s}`),
      ],
      alertType: "error",
      aggregationKey: `urnammu:${candidate.key}`,
    });
  }
  return created;
}

export async function runGovernanceAutomationJob(now = new Date()): Promise<GovernanceAutomationJobResult> {
  const [reviewNoticeDaysRaw, exceptionNoticeDaysRaw, escalationOverdueDaysRaw] = await Promise.all([
    getSetting(GOVERNANCE_AUTOMATION_SETTINGS_KEYS.REVIEW_NOTICE_DAYS),
    getSetting(GOVERNANCE_AUTOMATION_SETTINGS_KEYS.EXCEPTION_NOTICE_DAYS),
    getSetting(GOVERNANCE_AUTOMATION_SETTINGS_KEYS.ESCALATION_OVERDUE_DAYS),
  ]);

  const reviewNoticeDays = parseIntervalHours(reviewNoticeDaysRaw, 14);
  const exceptionNoticeDays = parseIntervalHours(exceptionNoticeDaysRaw, 14);
  const escalationOverdueDays = parseIntervalHours(escalationOverdueDaysRaw, 7);

  const systems = await prisma.aISystem.findMany({
    select: {
      id: true,
      name: true,
      status: true,
      nextReviewDate: true,
      owner: { select: { name: true, email: true } },
      approvals: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { decision: true },
      },
      policyAssignments: {
        select: { complianceStatus: true },
      },
      governanceReviews: {
        orderBy: { createdAt: "desc" },
        select: { stage: true, approved: true },
      },
      governanceExceptions: {
        where: { status: "ACTIVE", expiresAt: { gte: now } },
        select: { status: true, expiresAt: true },
      },
      _count: {
        select: { riskAssessments: true },
      },
      requireOwnerApproval: true,
      requireSecurityApproval: true,
      requireLegalApproval: true,
      requireComplianceApproval: true,
    },
  });

  const exceptions = await prisma.governanceException.findMany({
    where: {
      status: "ACTIVE",
      expiresAt: { gte: now },
    },
    select: {
      id: true,
      title: true,
      expiresAt: true,
      aiSystemId: true,
      aiSystem: { select: { name: true } },
    },
  });

  const automation = evaluateGovernanceAutomation({
    now,
    reviewNoticeDays,
    exceptionNoticeDays,
    escalationOverdueDays,
    systems: systems.map((system) => {
      const latestStageApprovals = new Map<string, boolean>();
      for (const review of system.governanceReviews) {
        if (!latestStageApprovals.has(review.stage)) {
          latestStageApprovals.set(review.stage, review.approved);
        }
      }
      const requiredStages = [
        ...(system.requireOwnerApproval ? (["OWNER"] as const) : []),
        ...(system.requireSecurityApproval ? (["SECURITY"] as const) : []),
        ...(system.requireLegalApproval ? (["LEGAL"] as const) : []),
        ...(system.requireComplianceApproval ? (["COMPLIANCE"] as const) : []),
      ];

      return {
        id: system.id,
        name: system.name,
        ownerName: system.owner.name,
        ownerEmail: system.owner.email,
        status: system.status,
        nextReviewDate: system.nextReviewDate,
        riskAssessmentsCount: system._count.riskAssessments,
        policyAssignmentsCount: system.policyAssignments.length,
        notAssessedAssignments: system.policyAssignments.filter(
          (assignment) => assignment.complianceStatus === "NOT_ASSESSED"
        ).length,
        nonCompliantAssignments: system.policyAssignments.filter(
          (assignment) => assignment.complianceStatus === "NON_COMPLIANT"
        ).length,
        partialAssignments: system.policyAssignments.filter(
          (assignment) => assignment.complianceStatus === "PARTIALLY_COMPLIANT"
        ).length,
        latestApprovalDecision: system.approvals[0]?.decision ?? null,
        activeExceptionCount: system.governanceExceptions.length,
        requiredStages,
        approvedStages: requiredStages.filter(
          (stage) => latestStageApprovals.get(stage) === true
        ),
      };
    }),
    exceptions: exceptions.map((exception) => ({
      id: exception.id,
      aiSystemId: exception.aiSystemId,
      systemName: exception.aiSystem.name,
      title: exception.title,
      expiresAt: exception.expiresAt,
    })),
  });

  const reviewRenewals = await syncGovernanceAutomationAlerts({
    source: "review_renewal",
    candidates: automation.reviewRenewals,
  });
  const exceptionRenewals = await syncGovernanceAutomationAlerts({
    source: "exception_renewal",
    candidates: automation.exceptionRenewals,
  });
  const ownershipEscalations = await syncGovernanceAutomationAlerts({
    source: "ownership_escalation",
    candidates: automation.ownershipEscalations,
  });

  let usageAfterDeactivation = 0;
  try {
    usageAfterDeactivation = await syncUsageAfterDeactivationAlerts(now);
  } catch (error) {
    // A telemetry read failure must not take the renewal / escalation alerts
    // down with it; log and report zero for this run.
    logger.error("governance_automation.usage_after_deactivation_failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return { reviewRenewals, exceptionRenewals, ownershipEscalations, usageAfterDeactivation };
}

// ---------------------------------------------------------------------------
// Key usage rules (/api/cron/key-usage-rules)
// ---------------------------------------------------------------------------

const EMPTY_KEY_USAGE_RESULT: KeyUsageEvaluationResult = {
  rulesEvaluated: 0,
  keysEvaluated: 0,
  findings: 0,
  alertsCreated: 0,
  alertsUpdated: 0,
  alertsResolved: 0,
  profilesUpserted: 0,
};

/**
 * Evaluate key-usage rules. Never throws: a bad rule config or a slow
 * telemetry read is logged and reported as an empty result so the caller
 * (cron route or compatibility shim) still returns 200.
 */
export async function runKeyUsageRulesJob(
  now = new Date()
): Promise<{ ok: boolean; error?: string; result: KeyUsageEvaluationResult }> {
  try {
    return { ok: true, result: await runKeyUsageRuleEvaluation(now) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`key-usage rule evaluation failed: ${message}`);
    return { ok: false, error: message, result: EMPTY_KEY_USAGE_RESULT };
  }
}

// ---------------------------------------------------------------------------
// Deprecated compatibility shim (/api/scheduler/maintenance)
// ---------------------------------------------------------------------------

export const MAINTENANCE_SHIM_DEPRECATION =
  "GET /api/scheduler/maintenance is deprecated and will be removed next release. " +
  "Schedule /api/cron/provider-sync/<provider>, /api/cron/discovery-scan/<source>, " +
  "/api/cron/governance-automation, and /api/cron/key-usage-rules instead (see vercel.json).";

/**
 * Runs every job the old hourly pass ran, composed from the per-job functions
 * above so due-ness and skip semantics match the dedicated cron routes exactly.
 */
export async function runScheduledMaintenance(now = new Date()): Promise<ScheduledMaintenanceResult> {
  logger.warn("scheduler.maintenance_shim_invoked", { message: MAINTENANCE_SHIM_DEPRECATION });

  const providerResults = await Promise.all(
    SYNC_PROVIDERS.map((provider) => runScheduledProviderSync(provider, now))
  );

  const scanResults: ScheduledDiscoveryScanResult[] = [];
  for (const source of DISCOVERY_SCAN_SOURCES) {
    scanResults.push(await runScheduledDiscoveryScan(source, now));
  }

  const governanceAutomation = await runGovernanceAutomationJob(now);
  const keyUsageRules = await runKeyUsageRulesJob(now);

  return {
    deprecated: MAINTENANCE_SHIM_DEPRECATION,
    providerSync: Object.fromEntries(
      providerResults.map((result) => [result.provider, result])
    ) as Record<SyncProviderId, ScheduledProviderSyncResult>,
    discoveryScans: Object.fromEntries(
      scanResults.map((result) => [result.source, result])
    ) as Record<DiscoveryScanSource, ScheduledDiscoveryScanResult>,
    governanceAutomation,
    keyUsageRules: keyUsageRules.result,
  };
}
