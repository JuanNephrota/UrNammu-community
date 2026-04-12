import { requireRole } from "@/lib/auth-guard";
import { AdminAPISettings } from "../admin-api-settings";
import { getSettingsPageData } from "../data";

export default async function ProviderAdminSettingsPage() {
  await requireRole(["ADMIN"]);

  const {
    hasAnthropicAdminKey,
    hasOpenAIAdminKey,
    settingsMap,
  } = await getSettingsPageData();

  return (
    <AdminAPISettings
      hasAnthropicAdminKey={hasAnthropicAdminKey}
      hasOpenAIAdminKey={hasOpenAIAdminKey}
      providerSyncEnabled={settingsMap.provider_sync_enabled !== "false"}
      providerSyncIntervalHours={parseInt(settingsMap.provider_sync_interval_hours ?? "6")}
    />
  );
}
