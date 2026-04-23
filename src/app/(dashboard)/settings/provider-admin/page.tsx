import { requireRole } from "@/lib/auth-guard";
import { prisma } from "@/lib/prisma";
import { AdminAPISettings } from "../admin-api-settings";
import { getSettingsPageData } from "../data";

export default async function ProviderAdminSettingsPage() {
  await requireRole(["ADMIN"]);

  const {
    hasAnthropicAdminKey,
    hasOpenAIAdminKey,
    hasOpenRouterKey,
    hasHeliconeKey,
    hasPortkeyKey,
    hasGeminiBillingConfig,
    settingsMap,
  } = await getSettingsPageData();

  const aiSystems = await prisma.aISystem.findMany({
    select: { id: true, name: true, vendor: true },
    orderBy: { name: "asc" },
  });

  return (
    <AdminAPISettings
      hasAnthropicAdminKey={hasAnthropicAdminKey}
      hasOpenAIAdminKey={hasOpenAIAdminKey}
      hasOpenRouterKey={hasOpenRouterKey}
      hasHeliconeKey={hasHeliconeKey}
      hasPortkeyKey={hasPortkeyKey}
      hasGeminiBillingConfig={hasGeminiBillingConfig}
      providerSyncEnabled={settingsMap.provider_sync_enabled !== "false"}
      providerSyncIntervalHours={parseInt(settingsMap.provider_sync_interval_hours ?? "6")}
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
      aiSystems={aiSystems}
    />
  );
}
