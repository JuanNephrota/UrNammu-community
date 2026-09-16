import { requireRole } from "@/lib/auth-guard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Network } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { IntegrationsGrid } from "@/components/settings/integrations-grid";
import { getDirectorySyncStatuses } from "@/lib/background-jobs";
import { getDirectoryPeopleCounts } from "@/lib/directory-sync";
import { getSettingsPageData } from "../settings/data";

export default async function IntegrationsPage() {
  await requireRole(["ADMIN"]);

  const {
    settingsMap,
    currentProvider,
    currentModel,
    hasAiKey,
    hasAnthropicAdminKey,
    hasOpenAIAdminKey,
    hasOpenRouterKey,
    hasHeliconeKey,
    hasPortkeyKey,
    hasLiteLLMKey,
    hasGeminiBillingConfig,
    azureMonitor,
  } = await getSettingsPageData();

  const googleSignInConnected =
    (!!settingsMap.google_oauth_client_id && !!settingsMap.google_oauth_client_secret) ||
    (!settingsMap.google_oauth_client_id &&
      !settingsMap.google_oauth_client_secret &&
      !!process.env.GOOGLE_CLIENT_ID &&
      !!process.env.GOOGLE_CLIENT_SECRET);

  const microsoftSignInConnected =
    (!!settingsMap.microsoft_client_id &&
      !!settingsMap.microsoft_client_secret &&
      !!settingsMap.microsoft_tenant_id) ||
    (!settingsMap.microsoft_client_id &&
      !settingsMap.microsoft_client_secret &&
      !settingsMap.microsoft_tenant_id &&
      !!process.env.MICROSOFT_CLIENT_ID &&
      !!process.env.MICROSOFT_CLIENT_SECRET &&
      !!process.env.MICROSOFT_TENANT_ID);

  const googleWorkspaceConnected =
    !!settingsMap.google_service_account_key && !!settingsMap.google_admin_email;

  const microsoftShadowAIConnected =
    !!settingsMap.microsoft_shadow_ai_tenant_id &&
    !!settingsMap.microsoft_shadow_ai_client_id &&
    !!settingsMap.microsoft_shadow_ai_client_secret;

  const [directoryStatuses, directoryCounts] = await Promise.all([
    getDirectorySyncStatuses(),
    getDirectoryPeopleCounts(),
  ]);
  const directoryTile = (source: "google_workspace" | "microsoft_365") => {
    const status = directoryStatuses.find((s) => s.source === source);
    const people = directoryCounts[source];
    return {
      configured: status?.configured ?? false,
      enabled: status?.schedule.enabled ?? false,
      people: people.active + people.deactivated,
    };
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Integrations"
        description="Every external service UrNammu connects to, grouped by purpose"
      />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Network className="h-4 w-4 text-[var(--accent)]" />
            Connected services
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm leading-relaxed text-[var(--text-secondary)]">
            Click a tile to configure credentials, connection details, and sync options. Identity
            providers and shadow AI discovery link out to the settings pages where their full
            scan / auth configuration lives.
          </p>
        </CardContent>
      </Card>

      <IntegrationsGrid
        aiProvider={{
          currentProvider,
          currentModel,
          hasApiKey: hasAiKey,
        }}
        hasAnthropicAdminKey={hasAnthropicAdminKey}
        hasOpenAIAdminKey={hasOpenAIAdminKey}
        hasOpenRouterKey={hasOpenRouterKey}
        hasHeliconeKey={hasHeliconeKey}
        hasPortkeyKey={hasPortkeyKey}
        hasLiteLLMKey={hasLiteLLMKey}
        hasGeminiBillingConfig={hasGeminiBillingConfig}
        chatgptEnterprise={{
          workspaceId: settingsMap.chatgpt_workspace_id ?? "",
          hasAdminKey: !!settingsMap.chatgpt_enterprise_admin_key,
        }}
        litellm={{
          baseUrl: settingsMap.litellm_api_base_url ?? "",
          hasApiKey: !!settingsMap.litellm_api_key,
        }}
        datadog={{
          hasApiKey: !!settingsMap.datadog_api_key,
          hasAppKey: !!settingsMap.datadog_app_key,
          site: settingsMap.datadog_site ?? "datadoghq.com",
          enabled: settingsMap.datadog_enabled === "true",
        }}
        geminiBilling={{
          projectId: settingsMap.gemini_billing_project_id ?? "",
          dataset: settingsMap.gemini_billing_dataset ?? "",
          table: settingsMap.gemini_billing_table ?? "",
          location: settingsMap.gemini_billing_location ?? "US",
          hasServiceAccountKey: !!settingsMap.gemini_billing_service_account_key,
        }}
        azureMonitor={azureMonitor}
        googleWorkspaceConnected={googleWorkspaceConnected}
        microsoftShadowAIConnected={microsoftShadowAIConnected}
        googleSignInConnected={googleSignInConnected}
        microsoftSignInConnected={microsoftSignInConnected}
        directorySync={{
          google: directoryTile("google_workspace"),
          microsoft: directoryTile("microsoft_365"),
        }}
      />
    </div>
  );
}
