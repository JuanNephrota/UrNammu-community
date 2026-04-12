import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth-guard";
import { getSettings } from "@/lib/settings";

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
  "provider_sync_enabled",
  "provider_sync_interval_hours",
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
  "openai_admin_key",
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
    hasAnthropicAdminKey: !!settingsMap.anthropic_admin_key,
    hasOpenAIAdminKey: !!settingsMap.openai_admin_key,
  };
}
