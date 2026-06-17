import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth-guard";
import { getSettings, parseEnforcementMode } from "@/lib/settings";

const SETTINGS_KEYS = [
  "google_service_account_key",
  "google_admin_email",
  "google_scan_enabled",
  "google_scan_lookback_days",
  "google_scan_interval_hours",
  "microsoft_shadow_ai_tenant_id",
  "microsoft_shadow_ai_client_id",
  "microsoft_shadow_ai_client_secret",
  "microsoft_shadow_ai_scan_enabled",
  "microsoft_shadow_ai_scan_interval_hours",
  "hexnode_api_key",
  "hexnode_subdomain",
  "hexnode_scan_enabled",
  "hexnode_scan_interval_hours",
  "gemini_billing_service_account_key",
  "gemini_billing_project_id",
  "gemini_billing_dataset",
  "gemini_billing_table",
  "gemini_billing_location",
  "provider_sync_enabled",
  "provider_sync_interval_hours",
  "anomaly_recent_window_days",
  "anomaly_baseline_window_days",
  "anomaly_min_recent_tokens",
  "anomaly_min_recent_cost",
  "anomaly_provider_multiplier",
  "anomaly_model_multiplier",
  "anomaly_project_multiplier",
  "governance_review_notice_days",
  "governance_exception_notice_days",
  "governance_escalation_overdue_days",
  "proxy_secret",
  "platform_url",
  "enable_local_auth",
  "enable_dev_login",
  "google_oauth_client_id",
  "google_oauth_client_secret",
  "microsoft_client_id",
  "microsoft_client_secret",
  "microsoft_tenant_id",
  "ai_provider",
  "ai_model",
  "ai_api_key",
  "anthropic_admin_key",
  "anthropic_managed_system_id",
  "cursor_admin_key",
  "cursor_managed_system_id",
  "openai_admin_key",
  "openrouter_provisioning_key",
  "helicone_api_key",
  "helicone_api_base_url",
  "portkey_api_key",
  "portkey_api_base_url",
  "portkey_workspace_slug",
  "litellm_api_key",
  "litellm_api_base_url",
  "datadog_api_key",
  "datadog_app_key",
  "datadog_site",
  "datadog_enabled",
  "policy_enforcement_mode",
  "azure_subscription_id",
  "azure_resource_group",
  "azure_function_app_name",
  "azure_function_app_region",
  "azure_tenant_id",
  "azure_client_id",
  "azure_client_secret",
] as const;

export async function getSettingsPageData() {
  let isAdmin = false;
  try {
    await requireRole(["ADMIN"]);
    isAdmin = true;
  } catch {
    isAdmin = false;
  }

  const users = isAdmin
    ? await prisma.user.findMany({
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          department: true,
          createdAt: true,
        },
      })
    : [];

  const settingsMap = isAdmin
    ? await getSettings([...SETTINGS_KEYS])
    : Object.fromEntries(SETTINGS_KEYS.map((key) => [key, null]));

  const currentProvider = settingsMap.ai_provider ?? "anthropic";
  const currentModel =
    settingsMap.ai_model ??
    (currentProvider === "openai" ? "gpt-4o" : "claude-sonnet-4-20250514");
  const hasAiKey =
    !!settingsMap.ai_api_key ||
    !!(currentProvider === "openai"
      ? process.env.OPENAI_API_KEY
      : process.env.ANTHROPIC_API_KEY);

  const providerLabel = currentProvider === "openai" ? "OpenAI" : "Anthropic";
  const modelLabel = currentModel;

  const proxySecret = isAdmin
    ? settingsMap.proxy_secret ??
      process.env.PROXY_SECRET ??
      "change-me-proxy-secret"
    : "";
  const platformUrl = isAdmin
    ? settingsMap.platform_url ?? process.env.NEXTAUTH_URL ?? "http://localhost:3001"
    : process.env.NEXTAUTH_URL ?? "http://localhost:3001";

  const policyEnforcementMode = parseEnforcementMode(settingsMap.policy_enforcement_mode);

  const azureMonitor = {
    subscriptionId: settingsMap.azure_subscription_id ?? "",
    resourceGroup: settingsMap.azure_resource_group ?? "",
    functionAppName: settingsMap.azure_function_app_name ?? "",
    region: settingsMap.azure_function_app_region ?? "",
    hasTenantId: !!settingsMap.azure_tenant_id,
    hasClientId: !!settingsMap.azure_client_id,
    hasClientSecret: !!settingsMap.azure_client_secret,
  };

  return {
    isAdmin,
    users,
    settingsMap,
    proxySecret,
    platformUrl,
    currentProvider,
    currentModel,
    hasAiKey,
    providerLabel,
    modelLabel,
    policyEnforcementMode,
    azureMonitor,
    hasAnthropicAdminKey: !!settingsMap.anthropic_admin_key,
    hasCursorAdminKey: !!settingsMap.cursor_admin_key,
    hasOpenAIAdminKey: !!settingsMap.openai_admin_key,
    hasOpenRouterKey: !!settingsMap.openrouter_provisioning_key,
    hasHeliconeKey: !!settingsMap.helicone_api_key,
    hasPortkeyKey: !!settingsMap.portkey_api_key,
    hasLiteLLMKey:
      !!settingsMap.litellm_api_key && !!settingsMap.litellm_api_base_url,
    hasDatadogKey: !!settingsMap.datadog_api_key,
    datadogEnabled: settingsMap.datadog_enabled === "true",
    datadogSite: settingsMap.datadog_site ?? "datadoghq.com",
    hasGeminiBillingConfig:
      !!settingsMap.gemini_billing_service_account_key &&
      !!settingsMap.gemini_billing_project_id &&
      !!settingsMap.gemini_billing_dataset &&
      !!settingsMap.gemini_billing_table,
  };
}
