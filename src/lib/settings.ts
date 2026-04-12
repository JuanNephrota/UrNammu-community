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
    google_oauth_client_id: process.env.GOOGLE_CLIENT_ID,
    google_oauth_client_secret: process.env.GOOGLE_CLIENT_SECRET,
    provider_sync_enabled: process.env.PROVIDER_SYNC_ENABLED,
    provider_sync_interval_hours: process.env.PROVIDER_SYNC_INTERVAL_HOURS,
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

export const PROVIDER_SYNC_SETTINGS_KEYS = {
  ENABLED: "provider_sync_enabled",
  INTERVAL_HOURS: "provider_sync_interval_hours",
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
