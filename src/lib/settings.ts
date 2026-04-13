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
    platform_url: process.env.NEXTAUTH_URL,
    enable_local_auth: process.env.ENABLE_LOCAL_AUTH,
    enable_dev_login: process.env.ENABLE_DEV_LOGIN,
    microsoft_client_id: process.env.MICROSOFT_CLIENT_ID,
    microsoft_client_secret: process.env.MICROSOFT_CLIENT_SECRET,
    microsoft_tenant_id: process.env.MICROSOFT_TENANT_ID,
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

export const PLATFORM_SETTINGS_KEYS = {
  PROXY_SECRET: "proxy_secret",
  PLATFORM_URL: "platform_url",
} as const;
