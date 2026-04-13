import { prisma } from "./prisma";
import { fetchOpenAIOrgData, listAssistants } from "./openai-admin";
import { logger } from "./observability";
import { syncAnthropicTelemetry, syncClaudeCodeAnalytics, syncOpenAITelemetry } from "./provider-telemetry";
import { executeScan } from "./scan-executor";
import {
  GOVERNANCE_AUTOMATION_SETTINGS_KEYS,
  getSetting,
  GOOGLE_SETTINGS_KEYS,
  MICROSOFT_SHADOW_AI_SETTINGS_KEYS,
  PROVIDER_SYNC_SETTINGS_KEYS,
} from "./settings";
import { isGoogleWorkspaceConfigured } from "./google-workspace";
import { isMicrosoft365Configured } from "./microsoft-365-shadow-ai";
import { evaluateGovernanceAutomation } from "./governance-automation";

type BackgroundActor = string;

export type ProviderSyncJobResult = {
  anthropicUsageSynced: number;
  openaiUsageSynced: number;
  claudeCodeUsageSynced: number;
  anthropicCostBucketsSynced: number;
  openaiCostBucketsSynced: number;
  claudeCodeCostsSynced: number;
  rawSnapshotsStored: number;
  assistantsFound: number;
  agentsCreated: number;
  agentsUpdated: number;
  errors: string[];
};

export type ScheduledMaintenanceResult = {
  providerSync: {
    enabled: boolean;
    due: boolean;
    skippedReason?: string;
    result?: ProviderSyncJobResult;
  };
  googleWorkspaceScan: {
    enabled: boolean;
    due: boolean;
    skippedReason?: string;
    result?: Awaited<ReturnType<typeof executeScan>>;
  };
  microsoft365Scan: {
    enabled: boolean;
    due: boolean;
    skippedReason?: string;
    result?: Awaited<ReturnType<typeof executeScan>>;
  };
  governanceAutomation: {
    reviewRenewals: number;
    exceptionRenewals: number;
    ownershipEscalations: number;
  };
};

function parseBooleanSetting(value: string | null, defaultValue: boolean) {
  if (value === null) return defaultValue;
  return value === "true";
}

function parseIntervalHours(value: string | null, defaultValue: number) {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return defaultValue;
  return parsed;
}

function isDue(lastCompletedAt: Date | null, intervalHours: number, now: Date) {
  if (!lastCompletedAt) return true;
  return now.getTime() - lastCompletedAt.getTime() >= intervalHours * 60 * 60 * 1000;
}

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

export async function runProviderSyncJob(triggeredByUserId: BackgroundActor): Promise<ProviderSyncJobResult> {
  logger.info("provider_sync.requested", {
    userId: triggeredByUserId,
    trigger: triggeredByUserId === "system" ? "scheduler" : "manual",
  });

  const [anthropicResult, openaiResult, claudeCodeResult] = await Promise.all([
    syncAnthropicTelemetry(triggeredByUserId),
    syncOpenAITelemetry(triggeredByUserId),
    syncClaudeCodeAnalytics(triggeredByUserId),
  ]);

  const results: ProviderSyncJobResult = {
    anthropicUsageSynced: anthropicResult.success ? anthropicResult.usageBucketsUpserted : 0,
    openaiUsageSynced: openaiResult.success ? openaiResult.usageBucketsUpserted : 0,
    claudeCodeUsageSynced: claudeCodeResult.success ? claudeCodeResult.usageBucketsUpserted : 0,
    anthropicCostBucketsSynced: anthropicResult.success ? anthropicResult.costBucketsUpserted : 0,
    openaiCostBucketsSynced: openaiResult.success ? openaiResult.costBucketsUpserted : 0,
    claudeCodeCostsSynced: claudeCodeResult.success ? claudeCodeResult.costBucketsUpserted : 0,
    rawSnapshotsStored:
      (anthropicResult.success ? anthropicResult.rawSnapshotsStored : 0) +
      (openaiResult.success ? openaiResult.rawSnapshotsStored : 0) +
      (claudeCodeResult.success ? claudeCodeResult.rawSnapshotsStored : 0),
    assistantsFound: 0,
    agentsCreated: 0,
    agentsUpdated: 0,
    errors: [
      ...(anthropicResult.success ? [] : [`Anthropic telemetry: ${anthropicResult.error}`]),
      ...(openaiResult.success ? [] : [`OpenAI telemetry: ${openaiResult.error}`]),
      ...(claudeCodeResult.success ? [] : [`Claude Code analytics: ${claudeCodeResult.error}`]),
    ],
  };

  if (openaiResult.success) {
    try {
      const assistantsResponse = await listAssistants({ limit: 100, order: "desc" }).catch(async () => {
        const fullData = await fetchOpenAIOrgData();
        return fullData.assistants ?? null;
      });
      const assistants = ((assistantsResponse as Record<string, unknown> | null)?.data ?? []) as Record<string, unknown>[];
      results.assistantsFound = assistants.length;

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
          results.agentsUpdated++;
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
          results.agentsCreated++;
        }
      }
    } catch (err) {
      results.errors.push(`OpenAI assistants: ${err instanceof Error ? err.message : "Failed"}`);
    }
  }

  logger.info("provider_sync.completed", {
    userId: triggeredByUserId,
    anthropicSuccess: anthropicResult.success,
    openaiSuccess: openaiResult.success,
    claudeCodeSuccess: claudeCodeResult.success,
    errors: results.errors,
    assistantsFound: results.assistantsFound,
    agentsCreated: results.agentsCreated,
    agentsUpdated: results.agentsUpdated,
  });

  return results;
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

async function getLatestCompletedScan(scanType: string) {
  return prisma.scanHistory.findFirst({
    where: {
      scanType,
      status: "completed",
      completedAt: { not: null },
    },
    orderBy: { completedAt: "desc" },
  });
}

export async function runScheduledMaintenance(now = new Date()): Promise<ScheduledMaintenanceResult> {
  const thirtyMinutesAgo = new Date(now.getTime() - 30 * 60 * 1000);
  const tenMinutesAgo = new Date(now.getTime() - 10 * 60 * 1000);

  await prisma.scanHistory.updateMany({
    where: { status: "running", startedAt: { lt: tenMinutesAgo } },
    data: { status: "failed", errorMessage: "Scan timed out", completedAt: now },
  });

  const [
    providerSyncEnabledRaw,
    providerSyncIntervalRaw,
    googleScanEnabledRaw,
    googleScanIntervalRaw,
    microsoftScanEnabledRaw,
    microsoftScanIntervalRaw,
    latestTelemetryRun,
    latestGoogleScan,
    latestMicrosoftScan,
    runningTelemetryRun,
    runningGoogleScan,
    runningMicrosoftScan,
    googleConfigured,
    microsoftConfigured,
    reviewNoticeDaysRaw,
    exceptionNoticeDaysRaw,
    escalationOverdueDaysRaw,
  ] = await Promise.all([
    getSetting(PROVIDER_SYNC_SETTINGS_KEYS.ENABLED),
    getSetting(PROVIDER_SYNC_SETTINGS_KEYS.INTERVAL_HOURS),
    getSetting(GOOGLE_SETTINGS_KEYS.SCAN_ENABLED),
    getSetting(GOOGLE_SETTINGS_KEYS.SCAN_INTERVAL_HOURS),
    getSetting(MICROSOFT_SHADOW_AI_SETTINGS_KEYS.SCAN_ENABLED),
    getSetting(MICROSOFT_SHADOW_AI_SETTINGS_KEYS.SCAN_INTERVAL_HOURS),
    prisma.providerSyncRun.findFirst({
      where: {
        syncType: "telemetry",
        status: "SUCCEEDED",
        completedAt: { not: null },
      },
      orderBy: { completedAt: "desc" },
    }),
    getLatestCompletedScan("google_workspace"),
    getLatestCompletedScan("microsoft_365"),
    prisma.providerSyncRun.findFirst({
      where: {
        syncType: "telemetry",
        status: "RUNNING",
        startedAt: { gte: thirtyMinutesAgo },
      },
      orderBy: { startedAt: "desc" },
    }),
    prisma.scanHistory.findFirst({
      where: {
        scanType: "google_workspace",
        status: "running",
        startedAt: { gte: tenMinutesAgo },
      },
      orderBy: { startedAt: "desc" },
    }),
    prisma.scanHistory.findFirst({
      where: {
        scanType: "microsoft_365",
        status: "running",
        startedAt: { gte: tenMinutesAgo },
      },
      orderBy: { startedAt: "desc" },
    }),
    isGoogleWorkspaceConfigured(),
    isMicrosoft365Configured(),
    getSetting(GOVERNANCE_AUTOMATION_SETTINGS_KEYS.REVIEW_NOTICE_DAYS),
    getSetting(GOVERNANCE_AUTOMATION_SETTINGS_KEYS.EXCEPTION_NOTICE_DAYS),
    getSetting(GOVERNANCE_AUTOMATION_SETTINGS_KEYS.ESCALATION_OVERDUE_DAYS),
  ]);

  const providerSyncEnabled = parseBooleanSetting(providerSyncEnabledRaw, true);
  const providerSyncIntervalHours = parseIntervalHours(providerSyncIntervalRaw, 6);
  const googleScanEnabled = parseBooleanSetting(googleScanEnabledRaw, false);
  const googleScanIntervalHours = parseIntervalHours(googleScanIntervalRaw, 24);
  const microsoftScanEnabled = parseBooleanSetting(
    microsoftScanEnabledRaw,
    false
  );
  const microsoftScanIntervalHours = parseIntervalHours(
    microsoftScanIntervalRaw,
    24
  );

  const providerSyncDue =
    providerSyncEnabled &&
    !runningTelemetryRun &&
    isDue(latestTelemetryRun?.completedAt ?? null, providerSyncIntervalHours, now);
  const googleScanDue =
    googleScanEnabled &&
    googleConfigured &&
    !runningGoogleScan &&
    isDue(latestGoogleScan?.completedAt ?? null, googleScanIntervalHours, now);
  const microsoftScanDue =
    microsoftScanEnabled &&
    microsoftConfigured &&
    !runningMicrosoftScan &&
    isDue(
      latestMicrosoftScan?.completedAt ?? null,
      microsoftScanIntervalHours,
      now
    );

  const result: ScheduledMaintenanceResult = {
    providerSync: {
      enabled: providerSyncEnabled,
      due: providerSyncDue,
      skippedReason:
        !providerSyncEnabled
          ? "Provider sync scheduling is disabled."
          : runningTelemetryRun
            ? "A provider sync is already running."
          : !providerSyncDue
            ? `Not due yet. Interval is ${providerSyncIntervalHours} hour(s).`
            : undefined,
    },
    googleWorkspaceScan: {
      enabled: googleScanEnabled,
      due: googleScanDue,
      skippedReason:
        !googleScanEnabled
          ? "Google Workspace auto-scan is disabled."
          : !googleConfigured
            ? "Google Workspace is not configured."
            : runningGoogleScan
              ? "A Google Workspace scan is already running."
            : !googleScanDue
              ? `Not due yet. Interval is ${googleScanIntervalHours} hour(s).`
            : undefined,
    },
    microsoft365Scan: {
      enabled: microsoftScanEnabled,
      due: microsoftScanDue,
      skippedReason:
        !microsoftScanEnabled
          ? "Microsoft 365 auto-scan is disabled."
          : !microsoftConfigured
            ? "Microsoft 365 Shadow AI is not configured."
            : runningMicrosoftScan
              ? "A Microsoft 365 scan is already running."
              : !microsoftScanDue
                ? `Not due yet. Interval is ${microsoftScanIntervalHours} hour(s).`
        : undefined,
    },
    governanceAutomation: {
      reviewRenewals: 0,
      exceptionRenewals: 0,
      ownershipEscalations: 0,
    },
  };

  if (providerSyncDue) {
    result.providerSync.result = await runProviderSyncJob("system");
  }

  if (googleScanDue) {
    result.googleWorkspaceScan.result = await executeScan(
      "system",
      "google_workspace"
    );
  }

  if (microsoftScanDue) {
    result.microsoft365Scan.result = await executeScan(
      "system",
      "microsoft_365"
    );
  }

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

  result.governanceAutomation.reviewRenewals = await syncGovernanceAutomationAlerts({
    source: "review_renewal",
    candidates: automation.reviewRenewals,
  });
  result.governanceAutomation.exceptionRenewals = await syncGovernanceAutomationAlerts({
    source: "exception_renewal",
    candidates: automation.exceptionRenewals,
  });
  result.governanceAutomation.ownershipEscalations = await syncGovernanceAutomationAlerts({
    source: "ownership_escalation",
    candidates: automation.ownershipEscalations,
  });

  return result;
}
