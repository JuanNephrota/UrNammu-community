import { requireRole } from "@/lib/auth-guard";
import { prisma } from "@/lib/prisma";
import { getProviderSyncStatuses } from "@/lib/background-jobs";
import { AdminAPISettings, type ProviderSyncStatusView } from "../admin-api-settings";
import { KEY_MAPPABLE_PROVIDERS, parseProviderKeySystemMap } from "@/lib/system-attribution";
import { getSettingsPageData } from "../data";

export default async function ProviderAdminSettingsPage() {
  await requireRole(["ADMIN"]);

  const {
    hasAnthropicAdminKey,
    hasCursorAdminKey,
    hasGitHubCopilotConfig,
    githubCopilot,
    hasChatGPTEnterpriseConfig,
    hasOpenAIAdminKey,
    hasOpenRouterKey,
    hasHeliconeKey,
    hasPortkeyKey,
    hasLiteLLMKey,
    hasGeminiBillingConfig,
    settingsMap,
  } = await getSettingsPageData();

  const aiSystems = await prisma.aISystem.findMany({
    select: { id: true, name: true, vendor: true },
    orderBy: { name: "asc" },
  });

  const providerSyncStatuses: ProviderSyncStatusView[] = (await getProviderSyncStatuses()).map(
    (status) => ({
      provider: status.provider,
      label: status.label,
      configured: status.configured,
      enabled: status.schedule.enabled,
      enabledSource: status.schedule.enabledSource,
      intervalHours: status.schedule.intervalHours,
      intervalSource: status.schedule.intervalSource,
      due: status.schedule.due,
      nextDueAt: status.schedule.nextDueAt?.toISOString() ?? null,
      skippedReason: status.schedule.skippedReason,
      overrideEnabled: status.overrides.enabled,
      overrideIntervalHours: status.overrides.intervalHours,
      lastRun: status.lastRun
        ? {
            status: status.lastRun.status,
            startedAt: status.lastRun.startedAt.toISOString(),
            completedAt: status.lastRun.completedAt?.toISOString() ?? null,
            errorMessage: status.lastRun.errorMessage,
            recordsProcessed: status.lastRun.recordsProcessed,
          }
        : null,
      lastSucceededAt: status.lastSucceededAt?.toISOString() ?? null,
    })
  );
  // Provider API keys seen in the last 90 days of admin-sync telemetry, so the
  // per-key attribution editor can offer real keys instead of free text.
  const now = new Date();
  const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
  const knownKeyRows = await prisma.usageBucket.groupBy({
    by: ["provider", "apiKeyExternalId", "apiKeyName"],
    where: {
      provider: { in: [...KEY_MAPPABLE_PROVIDERS] },
      apiKeyExternalId: { not: null },
      bucketStart: { gte: ninetyDaysAgo },
    },
    _sum: { totalTokens: true },
    orderBy: [{ provider: "asc" }, { _sum: { totalTokens: "desc" } }],
    take: 300,
  });
  const seenKeys = new Set<string>();
  const knownApiKeys = knownKeyRows.flatMap((row) => {
    if (!row.apiKeyExternalId) return [];
    const dedupeKey = `${row.provider}:${row.apiKeyExternalId}`;
    if (seenKeys.has(dedupeKey)) return [];
    seenKeys.add(dedupeKey);
    return [{ provider: row.provider, apiKeyExternalId: row.apiKeyExternalId, apiKeyName: row.apiKeyName }];
  });
  const watermarks = (
    await prisma.providerSyncWatermark.findMany({ orderBy: { provider: "asc" } })
  ).map((row) => ({
    provider: row.provider,
    watermark: row.watermark.toISOString(),
    earliest: row.earliest.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }));

  return (
    <AdminAPISettings
      hasAnthropicAdminKey={hasAnthropicAdminKey}
      hasCursorAdminKey={hasCursorAdminKey}
      hasGitHubCopilotConfig={hasGitHubCopilotConfig}
      githubCopilot={githubCopilot}
      hasChatGPTEnterpriseConfig={hasChatGPTEnterpriseConfig}
      hasOpenAIAdminKey={hasOpenAIAdminKey}
      hasOpenRouterKey={hasOpenRouterKey}
      hasHeliconeKey={hasHeliconeKey}
      hasPortkeyKey={hasPortkeyKey}
      hasLiteLLMKey={hasLiteLLMKey}
      hasGeminiBillingConfig={hasGeminiBillingConfig}
      providerSyncEnabled={settingsMap.provider_sync_enabled !== "false"}
      providerSyncIntervalHours={parseInt(settingsMap.provider_sync_interval_hours ?? "6")}
      providerSyncStatuses={providerSyncStatuses}
      geminiBillingProjectId={settingsMap.gemini_billing_project_id ?? ""}
      geminiBillingDataset={settingsMap.gemini_billing_dataset ?? ""}
      geminiBillingTable={settingsMap.gemini_billing_table ?? ""}
      geminiBillingLocation={settingsMap.gemini_billing_location ?? "US"}
      anomalyRecentWindowDays={parseInt(settingsMap.anomaly_recent_window_days ?? "7")}
      anomalyBaselineWindowDays={parseInt(settingsMap.anomaly_baseline_window_days ?? "7")}
      anomalyMinRecentTokens={parseInt(settingsMap.anomaly_min_recent_tokens ?? "2500")}
      anomalyMinRecentCost={parseInt(settingsMap.anomaly_min_recent_cost ?? "5")}
      anomalyProviderMultiplier={parseFloat(settingsMap.anomaly_provider_multiplier ?? "2")}
      anomalyModelMultiplier={parseFloat(settingsMap.anomaly_model_multiplier ?? "2.5")}
      anomalyProjectMultiplier={parseFloat(settingsMap.anomaly_project_multiplier ?? "2.25")}
      governanceReviewNoticeDays={parseInt(settingsMap.governance_review_notice_days ?? "14")}
      governanceExceptionNoticeDays={parseInt(settingsMap.governance_exception_notice_days ?? "14")}
      governanceEscalationOverdueDays={parseInt(settingsMap.governance_escalation_overdue_days ?? "7")}
      anthropicManagedSystemId={settingsMap.anthropic_managed_system_id ?? ""}
      openaiManagedSystemId={settingsMap.openai_managed_system_id ?? ""}
      litellmManagedSystemId={settingsMap.litellm_managed_system_id ?? ""}
      keySystemMap={parseProviderKeySystemMap(settingsMap.provider_key_system_map ?? null)}
      knownApiKeys={knownApiKeys}
      aiSystems={aiSystems}
      watermarks={watermarks}
    />
  );
}
