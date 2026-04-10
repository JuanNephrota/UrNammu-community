import { prisma } from "./prisma";

/**
 * Get a setting by key. Falls back to env var if not in DB.
 */
export async function getSetting(key: string): Promise<string | null> {
  const setting = await prisma.appSetting.findUnique({ where: { key } });
  if (setting) return setting.value;

  // Fall back to env vars for backwards compatibility
  const envMap: Record<string, string | undefined> = {
    google_service_account_key: process.env.GOOGLE_SERVICE_ACCOUNT_KEY,
    google_admin_email: process.env.GOOGLE_ADMIN_EMAIL,
    google_scan_schedule: process.env.GOOGLE_SCAN_SCHEDULE,
    anthropic_api_key: process.env.ANTHROPIC_API_KEY,
  };
  return envMap[key] ?? null;
}

/**
 * Set a setting by key.
 */
export async function setSetting(key: string, value: string): Promise<void> {
  await prisma.appSetting.upsert({
    where: { key },
    update: { value },
    create: { key, value },
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
    map[key] = found?.value ?? null;
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
} as const;
