import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth-guard";
import { getSettings, parseEnforcementMode } from "@/lib/settings";
import {
  RETENTION_ENV_VARS,
  RETENTION_SETTING_KEYS,
  type RetentionSettingKey,
} from "@/lib/collection-retention";

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
  "directory_sync_include_guests",
  "hexnode_api_key",
  "hexnode_subdomain",
  "hexnode_scan_enabled",
  "hexnode_scan_interval_hours",
  "crowdstrike_client_id",
  "crowdstrike_client_secret",
  "crowdstrike_base_url",
  "crowdstrike_scan_enabled",
  "crowdstrike_scan_interval_hours",
  "agent_platforms_scan_enabled",
  "agent_platforms_scan_interval_hours",
  "anthropic_managed_agents_api_key",
  "microsoft_copilot_agents_enabled",
  "salesforce_instance_url",
  "salesforce_client_id",
  "salesforce_client_secret",
  "shadow_ai_blocklist_token",
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
  "azure_openai_endpoint",
  "azure_openai_deployments",
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
  "anthropic_compliance_key",
  "anthropic_analytics_key",
  "anthropic_compliance_lookback_days",
  "org_timezone",
  "anthropic_managed_system_id",
  "cursor_admin_key",
  "cursor_managed_system_id",
  "github_copilot_token",
  "github_copilot_org",
  "github_copilot_enterprise",
  "github_copilot_managed_system_id",
  "openai_admin_key",
  "openai_managed_system_id",
  "litellm_managed_system_id",
  "provider_key_system_map",
  "openrouter_provisioning_key",
  "helicone_api_key",
  "helicone_api_base_url",
  "portkey_api_key",
  "portkey_api_base_url",
  "portkey_workspace_slug",
  "litellm_api_key",
  "litellm_api_base_url",
  "chatgpt_enterprise_admin_key",
  "chatgpt_workspace_id",
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
  "raw_snapshot_retention_days",
  "api_usage_log_retention_days",
  "agent_tool_call_retention_days",
  "policy_denial_retention_days",
  "proxy_health_retention_days",
  "scan_result_retention_days",
  "compliance_activity_retention_days",
  "claude_code_telemetry_retention_days",
  "cursor_telemetry_retention_days",
] as const;

export interface RetentionSettingValue {
  /** Value saved in the Settings UI (AppSetting), null when unset. */
  configured: string | null;
  /** Env-var fallback that applies when no DB value is set. */
  envValue: string | null;
}

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

  // Azure OpenAI passthrough config shown on Settings → Proxy Setup. Env
  // fallbacks match what the Azure Functions proxy reads.
  const azureOpenAIProxy = {
    endpoint: isAdmin
      ? settingsMap.azure_openai_endpoint ?? process.env.AZURE_OPENAI_ENDPOINT ?? ""
      : "",
    deployments: isAdmin
      ? settingsMap.azure_openai_deployments ?? process.env.AZURE_OPENAI_DEPLOYMENTS ?? ""
      : "",
  };

  const azureMonitor = {
    subscriptionId: settingsMap.azure_subscription_id ?? "",
    resourceGroup: settingsMap.azure_resource_group ?? "",
    functionAppName: settingsMap.azure_function_app_name ?? "",
    region: settingsMap.azure_function_app_region ?? "",
    hasTenantId: !!settingsMap.azure_tenant_id,
    hasClientId: !!settingsMap.azure_client_id,
    hasClientSecret: !!settingsMap.azure_client_secret,
  };

  const retention = Object.fromEntries(
    RETENTION_SETTING_KEYS.map((key) => [
      key,
      {
        configured: settingsMap[key] ?? null,
        envValue: isAdmin ? process.env[RETENTION_ENV_VARS[key]] ?? null : null,
      },
    ])
  ) as Record<RetentionSettingKey, RetentionSettingValue>;

  return {
    isAdmin,
    users,
    retention,
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
    azureOpenAIProxy,
    /** Azure Functions proxy host, when the Proxy Health connection names it. */
    functionAppName: settingsMap.azure_function_app_name ?? "",
    hasAnthropicAdminKey: !!settingsMap.anthropic_admin_key,
    // The Compliance Activity Feed also accepts the Admin key; the dedicated
    // key is what unlocks session metadata.
    hasAnthropicComplianceKey: !!settingsMap.anthropic_compliance_key,
    hasClaudeEnterpriseAnalyticsKey: !!settingsMap.anthropic_analytics_key,
    complianceAlerts: {
      orgTimezone: settingsMap.org_timezone ?? "",
      lookbackDays: settingsMap.anthropic_compliance_lookback_days ?? "",
    },
    hasCursorAdminKey: !!settingsMap.cursor_admin_key,
    hasGitHubCopilotConfig:
      !!settingsMap.github_copilot_token &&
      (!!settingsMap.github_copilot_org || !!settingsMap.github_copilot_enterprise),
    githubCopilot: {
      org: settingsMap.github_copilot_org ?? "",
      enterprise: settingsMap.github_copilot_enterprise ?? "",
      hasToken: !!settingsMap.github_copilot_token,
    },
    hasOpenAIAdminKey: !!settingsMap.openai_admin_key,
    hasOpenRouterKey: !!settingsMap.openrouter_provisioning_key,
    hasHeliconeKey: !!settingsMap.helicone_api_key,
    hasPortkeyKey: !!settingsMap.portkey_api_key,
    hasLiteLLMKey:
      !!settingsMap.litellm_api_key && !!settingsMap.litellm_api_base_url,
    hasChatGPTEnterpriseConfig:
      !!settingsMap.chatgpt_enterprise_admin_key && !!settingsMap.chatgpt_workspace_id,
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
