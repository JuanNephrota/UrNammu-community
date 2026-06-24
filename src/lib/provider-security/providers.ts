import {
  getSetting,
  PLATFORM_SETTINGS_KEYS,
  THIRD_PARTY_PROXY_SETTINGS_KEYS,
} from "../settings";
import { ANTHROPIC_ADMIN_SETTINGS } from "../anthropic-admin";
import { OPENAI_ADMIN_SETTINGS } from "../openai-admin";
import { CURSOR_ADMIN_SETTINGS } from "../cursor-admin";
import { GEMINI_OVERSIGHT_SETTINGS_KEYS } from "../settings";

/**
 * Known AI providers UrNammu can be wired to, with the stable, publicly
 * documented privacy/security facts we score their configuration against.
 *
 * `trainsOnApiDataByDefault` / `zeroDataRetentionAvailable` reflect each
 * provider's documented default posture for API/business usage. They are used
 * as the *baseline* attestation when no live signal contradicts them — the
 * scan tags such checks "inferred" (or "attested" when backed by a
 * VendorProfile) rather than "verified".
 */
export type ProviderKind = "model" | "gateway";

export interface ProviderMeta {
  /** Stable provider id, also used as ProviderSecurityResult.provider. */
  id: string;
  /** Display name. */
  label: string;
  kind: ProviderKind;
  /** VendorProfile.vendor strings this provider should match (case-insensitive). */
  vendorAliases: string[];
  /** AppSetting key holding the primary credential — presence => configured. */
  credentialKey: string;
  /** AppSetting key holding a configurable base URL, when the provider has one. */
  baseUrlKey?: string;
  /** Documented default: does API/business data train models? */
  trainsOnApiDataByDefault: boolean | "varies";
  /** Documented availability of a zero-data-retention / no-logging option. */
  zeroDataRetentionAvailable: boolean;
  /** Does this provider retain prompt/response content as logs by default?
   *  Gateways/observability proxies do; this drives retention checks. */
  retainsContentLogsByDefault: boolean;
  /** Documented regional data-residency options. */
  dataResidencyOptions: boolean;
  /** A best-effort live verification adapter exists for this provider. */
  hasLiveAdapter: boolean;
}

export const PROVIDER_REGISTRY: ProviderMeta[] = [
  {
    id: "anthropic",
    label: "Anthropic",
    kind: "model",
    vendorAliases: ["anthropic", "claude"],
    credentialKey: ANTHROPIC_ADMIN_SETTINGS.ADMIN_KEY,
    trainsOnApiDataByDefault: false,
    zeroDataRetentionAvailable: true,
    retainsContentLogsByDefault: false,
    dataResidencyOptions: false,
    hasLiveAdapter: true,
  },
  {
    id: "openai",
    label: "OpenAI",
    kind: "model",
    vendorAliases: ["openai", "chatgpt", "gpt"],
    credentialKey: OPENAI_ADMIN_SETTINGS.ADMIN_KEY,
    trainsOnApiDataByDefault: false,
    zeroDataRetentionAvailable: true,
    retainsContentLogsByDefault: false,
    dataResidencyOptions: true,
    hasLiveAdapter: true,
  },
  {
    id: "gemini",
    label: "Google Gemini",
    kind: "model",
    vendorAliases: ["google", "gemini", "vertex", "google cloud"],
    credentialKey: GEMINI_OVERSIGHT_SETTINGS_KEYS.SERVICE_ACCOUNT_KEY,
    trainsOnApiDataByDefault: false,
    zeroDataRetentionAvailable: true,
    retainsContentLogsByDefault: false,
    dataResidencyOptions: true,
    hasLiveAdapter: false,
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    kind: "gateway",
    vendorAliases: ["openrouter"],
    credentialKey: THIRD_PARTY_PROXY_SETTINGS_KEYS.OPENROUTER_PROVISIONING_KEY,
    // Routes to many downstream providers; training depends on the route and
    // per-model data policy, so this can't be asserted globally.
    trainsOnApiDataByDefault: "varies",
    zeroDataRetentionAvailable: true,
    retainsContentLogsByDefault: false,
    dataResidencyOptions: false,
    hasLiveAdapter: false,
  },
  {
    id: "helicone",
    label: "Helicone",
    kind: "gateway",
    vendorAliases: ["helicone"],
    credentialKey: THIRD_PARTY_PROXY_SETTINGS_KEYS.HELICONE_API_KEY,
    baseUrlKey: THIRD_PARTY_PROXY_SETTINGS_KEYS.HELICONE_API_BASE_URL,
    trainsOnApiDataByDefault: false,
    zeroDataRetentionAvailable: true,
    retainsContentLogsByDefault: true,
    dataResidencyOptions: true,
    hasLiveAdapter: false,
  },
  {
    id: "portkey",
    label: "Portkey",
    kind: "gateway",
    vendorAliases: ["portkey"],
    credentialKey: THIRD_PARTY_PROXY_SETTINGS_KEYS.PORTKEY_API_KEY,
    baseUrlKey: THIRD_PARTY_PROXY_SETTINGS_KEYS.PORTKEY_API_BASE_URL,
    trainsOnApiDataByDefault: false,
    zeroDataRetentionAvailable: true,
    retainsContentLogsByDefault: true,
    dataResidencyOptions: true,
    hasLiveAdapter: false,
  },
  {
    id: "litellm",
    label: "LiteLLM",
    kind: "gateway",
    vendorAliases: ["litellm"],
    credentialKey: THIRD_PARTY_PROXY_SETTINGS_KEYS.LITELLM_API_KEY,
    baseUrlKey: THIRD_PARTY_PROXY_SETTINGS_KEYS.LITELLM_API_BASE_URL,
    trainsOnApiDataByDefault: false,
    zeroDataRetentionAvailable: true,
    retainsContentLogsByDefault: true,
    dataResidencyOptions: false,
    hasLiveAdapter: false,
  },
  {
    id: "cursor",
    label: "Cursor",
    kind: "model",
    vendorAliases: ["cursor", "anysphere"],
    credentialKey: CURSOR_ADMIN_SETTINGS.ADMIN_KEY,
    // Cursor trains on data unless Privacy Mode is enabled for the team.
    trainsOnApiDataByDefault: "varies",
    zeroDataRetentionAvailable: true,
    retainsContentLogsByDefault: false,
    dataResidencyOptions: false,
    hasLiveAdapter: false,
  },
];

export function getProviderMeta(id: string): ProviderMeta | undefined {
  return PROVIDER_REGISTRY.find((p) => p.id === id);
}

/**
 * Return the providers that are actually configured in this UrNammu instance
 * (their credential setting resolves to a non-empty value). Also reports the
 * shared proxy secret + base URLs needed by the rule engine.
 */
export async function getConfiguredProviders(): Promise<{
  providers: ProviderMeta[];
  proxySecret: string | null;
  baseUrls: Record<string, string | null>;
}> {
  const proxySecret = await getSetting(PLATFORM_SETTINGS_KEYS.PROXY_SECRET);

  const credentialChecks = await Promise.all(
    PROVIDER_REGISTRY.map(async (meta) => ({
      meta,
      credential: await getSetting(meta.credentialKey),
      baseUrl: meta.baseUrlKey ? await getSetting(meta.baseUrlKey) : null,
    }))
  );

  const providers: ProviderMeta[] = [];
  const baseUrls: Record<string, string | null> = {};
  for (const check of credentialChecks) {
    if (check.credential && check.credential.trim().length > 0) {
      providers.push(check.meta);
      baseUrls[check.meta.id] = check.baseUrl;
    }
  }

  return { providers, proxySecret, baseUrls };
}
