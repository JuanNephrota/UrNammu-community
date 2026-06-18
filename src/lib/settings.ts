import { prisma } from "./prisma";
import { decryptSettingValue, encryptSettingValue } from "./settings-crypto";

/**
 * Get a setting by key. Falls back to env var if not in DB.
 */
export async function getSetting(key: string): Promise<string | null> {
  const setting = await prisma.appSetting.findUnique({ where: { key } });
  if (setting) return decryptSettingValue(key, setting.value);

  // Fall back to env vars for backwards compatibility
  const envMap: Record<string, string | undefined> = {
    google_service_account_key: process.env.GOOGLE_SERVICE_ACCOUNT_KEY,
    google_admin_email: process.env.GOOGLE_ADMIN_EMAIL,
    google_scan_schedule: process.env.GOOGLE_SCAN_SCHEDULE,
    google_scan_interval_hours: process.env.GOOGLE_SCAN_INTERVAL_HOURS,
    google_scan_enabled: process.env.GOOGLE_SCAN_ENABLED,
    google_scan_lookback_days: process.env.GOOGLE_SCAN_LOOKBACK_DAYS,
    google_oauth_client_id: process.env.GOOGLE_CLIENT_ID,
    google_oauth_client_secret: process.env.GOOGLE_CLIENT_SECRET,
    microsoft_shadow_ai_tenant_id: process.env.MICROSOFT_SHADOW_AI_TENANT_ID,
    microsoft_shadow_ai_client_id: process.env.MICROSOFT_SHADOW_AI_CLIENT_ID,
    microsoft_shadow_ai_client_secret:
      process.env.MICROSOFT_SHADOW_AI_CLIENT_SECRET,
    microsoft_shadow_ai_scan_enabled:
      process.env.MICROSOFT_SHADOW_AI_SCAN_ENABLED,
    microsoft_shadow_ai_scan_interval_hours:
      process.env.MICROSOFT_SHADOW_AI_SCAN_INTERVAL_HOURS,
    hexnode_api_key: process.env.HEXNODE_API_KEY,
    hexnode_subdomain: process.env.HEXNODE_SUBDOMAIN,
    hexnode_scan_enabled: process.env.HEXNODE_SCAN_ENABLED,
    hexnode_scan_interval_hours: process.env.HEXNODE_SCAN_INTERVAL_HOURS,
    crowdstrike_client_id: process.env.CROWDSTRIKE_CLIENT_ID,
    crowdstrike_client_secret: process.env.CROWDSTRIKE_CLIENT_SECRET,
    crowdstrike_base_url: process.env.CROWDSTRIKE_BASE_URL,
    crowdstrike_scan_enabled: process.env.CROWDSTRIKE_SCAN_ENABLED,
    crowdstrike_scan_interval_hours: process.env.CROWDSTRIKE_SCAN_INTERVAL_HOURS,
    gemini_billing_service_account_key:
      process.env.GEMINI_BILLING_SERVICE_ACCOUNT_KEY,
    gemini_billing_project_id: process.env.GEMINI_BILLING_PROJECT_ID,
    gemini_billing_dataset: process.env.GEMINI_BILLING_DATASET,
    gemini_billing_table: process.env.GEMINI_BILLING_TABLE,
    gemini_billing_location: process.env.GEMINI_BILLING_LOCATION,
    provider_sync_enabled: process.env.PROVIDER_SYNC_ENABLED,
    provider_sync_interval_hours: process.env.PROVIDER_SYNC_INTERVAL_HOURS,
    anomaly_recent_window_days: process.env.ANOMALY_RECENT_WINDOW_DAYS,
    anomaly_baseline_window_days: process.env.ANOMALY_BASELINE_WINDOW_DAYS,
    anomaly_min_recent_tokens: process.env.ANOMALY_MIN_RECENT_TOKENS,
    anomaly_min_recent_cost: process.env.ANOMALY_MIN_RECENT_COST,
    anomaly_provider_multiplier: process.env.ANOMALY_PROVIDER_MULTIPLIER,
    anomaly_model_multiplier: process.env.ANOMALY_MODEL_MULTIPLIER,
    anomaly_project_multiplier: process.env.ANOMALY_PROJECT_MULTIPLIER,
    governance_review_notice_days: process.env.GOVERNANCE_REVIEW_NOTICE_DAYS,
    governance_exception_notice_days: process.env.GOVERNANCE_EXCEPTION_NOTICE_DAYS,
    governance_escalation_overdue_days:
      process.env.GOVERNANCE_ESCALATION_OVERDUE_DAYS,
    anthropic_api_key: process.env.ANTHROPIC_API_KEY,
    proxy_secret: process.env.PROXY_SECRET,
    openrouter_provisioning_key: process.env.OPENROUTER_PROVISIONING_KEY,
    helicone_api_key: process.env.HELICONE_API_KEY,
    helicone_api_base_url: process.env.HELICONE_API_BASE_URL,
    portkey_api_key: process.env.PORTKEY_API_KEY,
    portkey_api_base_url: process.env.PORTKEY_API_BASE_URL,
    portkey_workspace_slug: process.env.PORTKEY_WORKSPACE_SLUG,
    litellm_api_key: process.env.LITELLM_API_KEY,
    litellm_api_base_url: process.env.LITELLM_API_BASE_URL,
    datadog_api_key: process.env.DATADOG_API_KEY,
    datadog_app_key: process.env.DATADOG_APP_KEY,
    datadog_site: process.env.DATADOG_SITE,
    datadog_enabled: process.env.DATADOG_ENABLED,
    claude_code_telemetry_secret: process.env.CLAUDE_CODE_TELEMETRY_SECRET,
    claude_code_telemetry_retention_days:
      process.env.CLAUDE_CODE_TELEMETRY_RETENTION_DAYS,
    platform_url: process.env.NEXTAUTH_URL,
    enable_local_auth: process.env.ENABLE_LOCAL_AUTH,
    enable_dev_login: process.env.ENABLE_DEV_LOGIN,
    microsoft_client_id: process.env.MICROSOFT_CLIENT_ID,
    microsoft_client_secret: process.env.MICROSOFT_CLIENT_SECRET,
    microsoft_tenant_id: process.env.MICROSOFT_TENANT_ID,
    resend_api_key: process.env.RESEND_API_KEY,
    report_email_from: process.env.REPORT_EMAIL_FROM,
  };
  return envMap[key] ?? null;
}

/**
 * Set a setting by key.
 */
export async function setSetting(key: string, value: string): Promise<void> {
  const storedValue = encryptSettingValue(key, value);
  await prisma.appSetting.upsert({
    where: { key },
    update: { value: storedValue },
    create: { key, value: storedValue },
  });
}

/**
 * Get multiple settings at once.
 */
export async function getSettings(
  keys: string[]
): Promise<Record<string, string | null>> {
  const settings = await prisma.appSetting.findMany({
    where: { key: { in: keys } },
  });
  const map: Record<string, string | null> = {};
  for (const key of keys) {
    const found = settings.find((s) => s.key === key);
    map[key] = found ? decryptSettingValue(key, found.value) : null;
  }
  return map;
}

/**
 * Delete a setting by key.
 */
export async function deleteSetting(key: string): Promise<void> {
  await prisma.appSetting.deleteMany({ where: { key } });
}

// Keys used by Google Workspace integration
export const GOOGLE_SETTINGS_KEYS = {
  SERVICE_ACCOUNT_KEY: "google_service_account_key",
  ADMIN_EMAIL: "google_admin_email",
  SCAN_ENABLED: "google_scan_enabled",
  SCAN_LOOKBACK_DAYS: "google_scan_lookback_days",
  SCAN_INTERVAL_HOURS: "google_scan_interval_hours",
} as const;

export const MICROSOFT_SHADOW_AI_SETTINGS_KEYS = {
  TENANT_ID: "microsoft_shadow_ai_tenant_id",
  CLIENT_ID: "microsoft_shadow_ai_client_id",
  CLIENT_SECRET: "microsoft_shadow_ai_client_secret",
  SCAN_ENABLED: "microsoft_shadow_ai_scan_enabled",
  SCAN_INTERVAL_HOURS: "microsoft_shadow_ai_scan_interval_hours",
} as const;

// Keys used by the Hexnode UEM/MDM shadow AI integration. Hexnode exposes a
// per-tenant REST API at https://<subdomain>.hexnodemdm.com/api/v1/ authed by
// an API key. We enumerate managed devices and their installed apps to detect
// AI tools deployed on endpoints.
export const HEXNODE_SETTINGS_KEYS = {
  API_KEY: "hexnode_api_key",
  SUBDOMAIN: "hexnode_subdomain",
  SCAN_ENABLED: "hexnode_scan_enabled",
  SCAN_INTERVAL_HOURS: "hexnode_scan_interval_hours",
} as const;

// Keys used by the CrowdStrike Falcon shadow AI integration. Falcon exposes a
// per-cloud REST API authed via OAuth2 client-credentials (an API client's ID
// and secret). We enumerate Falcon Discover application inventory to detect AI
// tools installed across managed endpoints.
export const CROWDSTRIKE_SETTINGS_KEYS = {
  CLIENT_ID: "crowdstrike_client_id",
  CLIENT_SECRET: "crowdstrike_client_secret",
  BASE_URL: "crowdstrike_base_url",
  SCAN_ENABLED: "crowdstrike_scan_enabled",
  SCAN_INTERVAL_HOURS: "crowdstrike_scan_interval_hours",
} as const;

export const GEMINI_OVERSIGHT_SETTINGS_KEYS = {
  SERVICE_ACCOUNT_KEY: "gemini_billing_service_account_key",
  PROJECT_ID: "gemini_billing_project_id",
  DATASET: "gemini_billing_dataset",
  TABLE: "gemini_billing_table",
  LOCATION: "gemini_billing_location",
} as const;

export const PROVIDER_SYNC_SETTINGS_KEYS = {
  ENABLED: "provider_sync_enabled",
  INTERVAL_HOURS: "provider_sync_interval_hours",
} as const;

// Maps each provider's admin-sync'd UsageBucket rows to a registered AISystem
// so the Usage Trend and Activity views attribute telemetry to that system
// instead of falling back to api-key-level labels.
export const PROVIDER_MANAGED_SYSTEM_SETTINGS_KEYS = {
  ANTHROPIC: "anthropic_managed_system_id",
  CURSOR: "cursor_managed_system_id",
} as const;

export const OVERSIGHT_ANOMALY_SETTINGS_KEYS = {
  RECENT_WINDOW_DAYS: "anomaly_recent_window_days",
  BASELINE_WINDOW_DAYS: "anomaly_baseline_window_days",
  MIN_RECENT_TOKENS: "anomaly_min_recent_tokens",
  MIN_RECENT_COST: "anomaly_min_recent_cost",
  PROVIDER_MULTIPLIER: "anomaly_provider_multiplier",
  MODEL_MULTIPLIER: "anomaly_model_multiplier",
  PROJECT_MULTIPLIER: "anomaly_project_multiplier",
} as const;

export const GOVERNANCE_AUTOMATION_SETTINGS_KEYS = {
  REVIEW_NOTICE_DAYS: "governance_review_notice_days",
  EXCEPTION_NOTICE_DAYS: "governance_exception_notice_days",
  ESCALATION_OVERDUE_DAYS: "governance_escalation_overdue_days",
} as const;

export const AUTH_SETTINGS_KEYS = {
  ENABLE_LOCAL_AUTH: "enable_local_auth",
  ENABLE_DEV_LOGIN: "enable_dev_login",
  GOOGLE_CLIENT_ID: "google_oauth_client_id",
  GOOGLE_CLIENT_SECRET: "google_oauth_client_secret",
  MICROSOFT_CLIENT_ID: "microsoft_client_id",
  MICROSOFT_CLIENT_SECRET: "microsoft_client_secret",
  MICROSOFT_TENANT_ID: "microsoft_tenant_id",
} as const;

// Email delivery for scheduled reports (Resend). Optional — when unset,
// scheduled runs still succeed and stay downloadable from the in-app history.
export const REPORT_SETTINGS_KEYS = {
  RESEND_API_KEY: "resend_api_key",
  EMAIL_FROM: "report_email_from",
} as const;

export const PLATFORM_SETTINGS_KEYS = {
  PROXY_SECRET: "proxy_secret",
  PLATFORM_URL: "platform_url",
} as const;

export const THIRD_PARTY_PROXY_SETTINGS_KEYS = {
  OPENROUTER_PROVISIONING_KEY: "openrouter_provisioning_key",
  HELICONE_API_KEY: "helicone_api_key",
  HELICONE_API_BASE_URL: "helicone_api_base_url",
  PORTKEY_API_KEY: "portkey_api_key",
  PORTKEY_API_BASE_URL: "portkey_api_base_url",
  PORTKEY_WORKSPACE_SLUG: "portkey_workspace_slug",
  LITELLM_API_KEY: "litellm_api_key",
  LITELLM_API_BASE_URL: "litellm_api_base_url",
} as const;

// Datadog outbound event forwarding. When enabled, governance alerts and
// other notable events get shipped as Datadog events for correlation with
// the customer's existing observability stack.
export const DATADOG_SETTINGS_KEYS = {
  API_KEY: "datadog_api_key",
  APP_KEY: "datadog_app_key",
  SITE: "datadog_site",
  ENABLED: "datadog_enabled",
} as const;

export const DATADOG_SUPPORTED_SITES = [
  "datadoghq.com",
  "us3.datadoghq.com",
  "us5.datadoghq.com",
  "datadoghq.eu",
  "ap1.datadoghq.com",
  "ddog-gov.com",
] as const;

export type DatadogSite = (typeof DATADOG_SUPPORTED_SITES)[number];
export const DATADOG_DEFAULT_SITE: DatadogSite = "datadoghq.com";

// Runtime policy-as-code enforcement controls. Evaluated by the Azure Functions
// proxy. Default is "off" — changing this is the explicit opt-in to prevention.
export const POLICY_ENFORCEMENT_SETTINGS_KEYS = {
  MODE: "policy_enforcement_mode",
} as const;

export type PolicyEnforcementMode = "off" | "dryrun" | "enforce";

export const POLICY_ENFORCEMENT_MODE_DEFAULT: PolicyEnforcementMode = "off";

export function parseEnforcementMode(value: string | null | undefined): PolicyEnforcementMode {
  if (value === "dryrun" || value === "enforce") return value;
  return POLICY_ENFORCEMENT_MODE_DEFAULT;
}

// Azure Monitor access for the proxy-health sync. Service-principal values
// are only needed when the host doesn't have ambient Azure CLI credentials
// (i.e., production deploys). Locally, az login covers it.
export const AZURE_MONITOR_SETTINGS_KEYS = {
  SUBSCRIPTION_ID: "azure_subscription_id",
  RESOURCE_GROUP: "azure_resource_group",
  FUNCTION_APP_NAME: "azure_function_app_name",
  // Region slug used to pick the Azure Monitor regional endpoint
  // (https://{region}.metrics.monitor.azure.com). Defaults to "eastus".
  REGION: "azure_function_app_region",
  TENANT_ID: "azure_tenant_id",
  CLIENT_ID: "azure_client_id",
  CLIENT_SECRET: "azure_client_secret",
} as const;
