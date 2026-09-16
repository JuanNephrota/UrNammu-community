import { prisma } from "./prisma";
import { fetchOpenAIOrgData, isOpenAIAdminConfigured, listAssistants } from "./openai-admin";
import { isAnthropicAdminConfigured } from "./anthropic-admin";
import { isClaudeCodeAnalyticsAvailable } from "./claude-code-analytics";
import { isCursorAdminConfigured } from "./cursor-admin";
import { isGeminiBillingConfigured } from "./gemini-admin";
import { isOpenRouterConfigured } from "./openrouter-admin";
import { isHeliconeConfigured } from "./helicone-admin";
import { isPortkeyConfigured } from "./portkey-admin";
import { isLiteLLMConfigured } from "./litellm-admin";
import { logger } from "./observability";
import { notifyDatadog } from "./datadog-client";
import {
  syncAnthropicTelemetry,
  syncClaudeCodeAnalytics,
  syncCursorTelemetry,
  syncGeminiTelemetry,
  syncHeliconeTelemetry,
  syncLiteLLMTelemetry,
  syncOpenAITelemetry,
  syncOpenRouterTelemetry,
  syncPortkeyTelemetry,
} from "./provider-telemetry";
import { executeScan } from "./scan-executor";
import {
  GOVERNANCE_AUTOMATION_SETTINGS_KEYS,
  getSetting,
  getSettings,
  GOOGLE_SETTINGS_KEYS,
  HEXNODE_SETTINGS_KEYS,
  CROWDSTRIKE_SETTINGS_KEYS,
  MICROSOFT_SHADOW_AI_SETTINGS_KEYS,
  PROVIDER_SYNC_SETTINGS_KEYS,
  providerSyncSettingKeys,
} from "./settings";
import { isGoogleWorkspaceConfigured } from "./google-workspace";
import { isMicrosoft365Configured } from "./microsoft-365-shadow-ai";
import { isHexnodeConfigured } from "./hexnode";
import { isCrowdStrikeConfigured } from "./crowdstrike";
import { evaluateGovernanceAutomation } from "./governance-automation";
import {
  runKeyUsageRuleEvaluation,
  type KeyUsageEvaluationResult,
} from "./key-usage-evaluation";
import {
  DISCOVERY_SCAN_LABELS,
  DISCOVERY_SCAN_RUNNING_GRACE_MS,
  DISCOVERY_SCAN_SOURCES,
  PROVIDER_SYNC_RUNNING_GRACE_MS,
  parseIntervalHours,
  resolveDiscoveryScanSchedule,
  resolveProviderSyncSchedule,
  SYNC_PROVIDER_LABELS,
  SYNC_PROVIDERS,
  type DiscoveryScanSchedule,
  type DiscoveryScanSource,
  type ProviderSyncSchedule,
  type SyncProviderId,
} from "./provider-sync-schedule";

type BackgroundActor = string;

type TelemetrySyncResult = Awaited<ReturnType<typeof syncAnthropicTelemetry>>;

const PROVIDER_SYNC_FUNCTIONS: Record<
  SyncProviderId,
  (triggeredByUserId: BackgroundActor) => Promise<TelemetrySyncResult>
> = {
  anthropic: syncAnthropicTelemetry,
  claude_code: syncClaudeCodeAnalytics,
  cursor: syncCursorTelemetry,
  gemini: syncGeminiTelemetry,
  openai: syncOpenAITelemetry,
  openrouter: syncOpenRouterTelemetry,
  helicone: syncHeliconeTelemetry,
  portkey: syncPortkeyTelemetry,
  litellm: syncLiteLLMTelemetry,
};

const PROVIDER_CONFIGURED_CHECKS: Record<SyncProviderId, () => Promise<boolean>> = {
  anthropic: isAnthropicAdminConfigured,
  claude_code: isClaudeCodeAnalyticsAvailable,
  cursor: isCursorAdminConfigured,
  gemini: isGeminiBillingConfigured,
  openai: isOpenAIAdminConfigured,
  openrouter: isOpenRouterConfigured,
  helicone: isHeliconeConfigured,
  portkey: isPortkeyConfigured,
  litellm: isLiteLLMConfigured,
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
  /** OpenAI only: assistant inventory follow-up discovery. */
  assistants?: { found: number; created: number; updated: number; error?: string };
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
  anthropicCostBucketsSynced: number;
  openaiCostBucketsSynced: number;
  openRouterCostBucketsSynced: number;
  heliconeCostBucketsSynced: number;
  portkeyCostBucketsSynced: number;
  litellmCostBucketsSynced: number;
  geminiCostBucketsSynced: number;
  claudeCodeCostsSynced: number;
  cursorCostBucketsSynced: number;
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
  result?: Awaited<ReturnType<typeof executeScan>>;
};

export type GovernanceAutomationJobResult = {
  reviewRenewals: number;
  exceptionRenewals: number;
  ownershipEscalations: number;
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
 * Discover OpenAI Assistants as AI agents. Runs after a successful OpenAI
 * telemetry sync so the inventory and the usage data come from the same key.
 */
async function discoverOpenAIAssistants(
  triggeredByUserId: BackgroundActor
): Promise<NonNullable<ProviderSyncOutcome["assistants"]>> {
  const summary: NonNullable<ProviderSyncOutcome["assistants"]> = { found: 0, created: 0, updated: 0 };
  try {
    const assistantsResponse = await listAssistants({ limit: 100, order: "desc" }).catch(async () => {
      const fullData = await fetchOpenAIOrgData();
      return fullData.assistants ?? null;
    });
    const assistants = ((assistantsResponse as Record<string, unknown> | null)?.data ?? []) as Record<string, unknown>[];
    summary.found = assistants.length;

    for (const assistant of assistants) {
      const name = (assistant.name as string) ?? "Unnamed Assistant";
      const description =
        (assistant.instructions as string)?.slice(0, 500) ??
        (assistant.description as string) ??
        null;
      const tools = ((assistant.tools ?? []) as Record<string, unknown>[]).map((t) => t.type as string);

      const existing = await prisma.aIAgent.findFirst({
        where: { name, department: "OpenAI" },
      });

      if (existing) {
        await prisma.aIAgent.update({
          where: { id: existing.id },
          data: {
            description: description ?? existing.description,
            capabilities: tools.length > 0 ? tools : (existing.capabilities as string[]) ?? [],
          },
        });
        summary.updated++;
      } else {
        await prisma.aIAgent.create({
          data: {
            name,
            description,
            ownerId: triggeredByUserId === "system" ? (await getFallbackOwnerId()) : triggeredByUserId,
            capabilities: tools,
            accessLevel: "api",
            autonomyLevel: "SUPERVISED",
            connectedSystems: ["OpenAI Platform"],
            humanReviewRequired: false,
            riskLevel: "MEDIUM",
            status: "DEPLOYED",
            department: "OpenAI",
          },
        });
        summary.created++;
      }
    }
  } catch (err) {
    summary.error = err instanceof Error ? err.message : "Failed";
  }
  return summary;
}

/**
 * Sync exactly one provider. This is the unit of work behind
 * `/api/cron/provider-sync/[provider]`; a provider that is not configured is
 * reported as skipped without touching the upstream API or ProviderSyncRun.
 */
export async function runProviderSync(
  provider: SyncProviderId,
  triggeredByUserId: BackgroundActor
): Promise<ProviderSyncOutcome> {
  const label = SYNC_PROVIDER_LABELS[provider];
  logger.info("provider_sync.requested", {
    provider,
    userId: triggeredByUserId,
    trigger: triggeredByUserId === "system" ? "scheduler" : "manual",
  });

  let raw: TelemetrySyncResult;
  try {
    raw = await PROVIDER_SYNC_FUNCTIONS[provider](triggeredByUserId);
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
  };

  if (provider === "openai" && raw.success) {
    outcome.assistants = await discoverOpenAIAssistants(triggeredByUserId);
  }

  logger.info("provider_sync.completed", {
    provider,
    userId: triggeredByUserId,
    status: outcome.status,
    error: outcome.error,
    usageBucketsUpserted: outcome.usageBucketsUpserted,
    costBucketsUpserted: outcome.costBucketsUpserted,
    assistants: outcome.assistants,
  });

  return outcome;
}

/**
 * Sync every provider at once. Used by the manual "Sync now" button
 * (POST /api/admin-sync); the scheduler runs providers individually via
 * `runScheduledProviderSync` so one slow provider cannot starve the others.
 */
export async function runProviderSyncJob(triggeredByUserId: BackgroundActor): Promise<ProviderSyncJobResult> {
  const outcomes = await Promise.all(
    SYNC_PROVIDERS.map((provider) => runProviderSync(provider, triggeredByUserId))
  );
  return aggregateProviderSyncOutcomes(outcomes);
}

export function aggregateProviderSyncOutcomes(outcomes: ProviderSyncOutcome[]): ProviderSyncJobResult {
  const byProvider = new Map(outcomes.map((outcome) => [outcome.provider, outcome]));
  const usage = (provider: SyncProviderId) => byProvider.get(provider)?.usageBucketsUpserted ?? 0;
  const cost = (provider: SyncProviderId) => byProvider.get(provider)?.costBucketsUpserted ?? 0;

  const skipped: string[] = [];
  const errors: string[] = [];
  for (const outcome of outcomes) {
    if (outcome.status === "skipped") skipped.push(`${outcome.label}: ${outcome.error}`);
    else if (outcome.status === "failed") errors.push(`${outcome.label}: ${outcome.error}`);
    if (outcome.assistants?.error) errors.push(`OpenAI assistants: ${outcome.assistants.error}`);
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
    anthropicCostBucketsSynced: cost("anthropic"),
    openaiCostBucketsSynced: cost("openai"),
    openRouterCostBucketsSynced: cost("openrouter"),
    heliconeCostBucketsSynced: cost("helicone"),
    portkeyCostBucketsSynced: cost("portkey"),
    litellmCostBucketsSynced: cost("litellm"),
    geminiCostBucketsSynced: cost("gemini"),
    claudeCodeCostsSynced: cost("claude_code"),
    cursorCostBucketsSynced: cost("cursor"),
    rawSnapshotsStored: outcomes.reduce((sum, outcome) => sum + outcome.rawSnapshotsStored, 0),
    assistantsFound: assistants?.found ?? 0,
    agentsCreated: assistants?.created ?? 0,
    agentsUpdated: assistants?.updated ?? 0,
    skipped,
    errors,
    providers: outcomes,
  };
}

async function getFallbackOwnerId() {
  const adminUser = await prisma.user.findFirst({
    where: { role: "ADMIN" },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });

  if (!adminUser) {
    throw new Error("No admin user is available to own scheduled agent discoveries.");
  }

  return adminUser.id;
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
    result.result = await executeScan("system", source);
  }

  return result;
}

// ---------------------------------------------------------------------------
// Governance automation (/api/cron/governance-automation)
// ---------------------------------------------------------------------------

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


  return { reviewRenewals, exceptionRenewals, ownershipEscalations };
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
