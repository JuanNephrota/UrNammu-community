/**
 * Microsoft 365 Copilot / Copilot Studio agent inventory import (source
 * `microsoft_copilot`), through the Microsoft 365 Shadow AI app registration.
 *
 * Uses the Microsoft 365 Copilot Package Management API, which lists the
 * apps and agents in the tenant catalog (the Microsoft 365 admin center's
 * Agents inventory), filtered to packages that run in Copilot:
 *
 *   GET https://graph.microsoft.com/v1.0/copilot/admin/catalog/packages
 *       ?$filter=supportedHosts/any(h:h eq 'Copilot')
 *
 * Requirements (documented on Microsoft Learn, copilotpackages-list):
 * - Application permission CopilotPackages.Read.All with admin consent on
 *   the existing app registration.
 * - A Microsoft Agent 365 license in the tenant (the API returns 403
 *   without one).
 *
 * The import is opt-in (`microsoft_copilot_agents_enabled`) so a tenant that
 * has not granted the permission does not fail every scheduled run.
 * Microsoft-built packages (`type: "microsoft"`) are skipped: they are
 * first-party product surfaces, not agents someone in the org built or
 * installed.
 */
import type { DiscoveredAgentInput } from "./agent-discovery";
import {
  applyAgentImport,
  asArray,
  asString,
  emptyImportSummary,
  readErrorMessage,
  toDate,
  type AgentImportSummary,
  type AgentUpsertFn,
  type FetchLike,
} from "./agent-import";
import { getMicrosoft365AccessToken, isMicrosoft365Configured } from "./microsoft-365-shadow-ai";
import { AGENT_PLATFORM_SETTINGS_KEYS, getSetting } from "./settings";

export const COPILOT_PACKAGES_PERMISSION = "CopilotPackages.Read.All";
export const COPILOT_AGENT_PACKAGES_PATH =
  "/copilot/admin/catalog/packages?$filter=supportedHosts/any(h:h eq 'Copilot')";
const GRAPH_BASE = "https://graph.microsoft.com/v1.0";
/** Follow at most this many @odata.nextLink pages per run. */
const MAX_PAGES = 50;

export type CopilotPackage = {
  id?: string;
  displayName?: string | null;
  /** microsoft | external | shared | custom */
  type?: string | null;
  shortDescription?: string | null;
  isBlocked?: boolean | null;
  supportedHosts?: string[] | null;
  lastModifiedDateTime?: string | null;
  publisher?: string | null;
  /** all | some | none */
  availableTo?: string | null;
  deployedTo?: string | null;
  elementTypes?: string[] | null;
  platform?: string | null;
  version?: string | null;
  manifestId?: string | null;
  appId?: string | null;
  [k: string]: unknown;
};

export async function isMicrosoftCopilotAgentsEnabled(): Promise<boolean> {
  return (await getSetting(AGENT_PLATFORM_SETTINGS_KEYS.MICROSOFT_COPILOT_ENABLED)) === "true";
}

/** Enabled and the Microsoft 365 app registration is configured. */
export async function isMicrosoftCopilotAgentsConfigured(): Promise<boolean> {
  const [enabled, configured] = await Promise.all([
    isMicrosoftCopilotAgentsEnabled(),
    isMicrosoft365Configured(),
  ]);
  return enabled && configured;
}

function platformLabel(pkg: CopilotPackage): string {
  const platform = asString(pkg.platform);
  if (platform && /copilot studio/i.test(platform)) return "Copilot Studio";
  if (platform && /agent builder/i.test(platform)) return "Microsoft 365 Copilot Agent Builder";
  return "Microsoft 365 Copilot";
}

/** Map one catalog package. Microsoft-built packages return null. */
export function mapCopilotPackage(pkg: CopilotPackage): DiscoveredAgentInput | null {
  const id = asString(pkg.id);
  if (!id) return null;
  const type = asString(pkg.type)?.toLowerCase() ?? null;
  if (type === "microsoft") return null;

  const elementTypes = asArray(pkg.elementTypes).map(asString).filter((v): v is string => !!v);
  const supportedHosts = asArray(pkg.supportedHosts).map(asString).filter((v): v is string => !!v);

  return {
    source: "microsoft_copilot",
    externalId: id,
    name: asString(pkg.displayName) ?? id,
    description: asString(pkg.shortDescription),
    platform: platformLabel(pkg),
    framework: elementTypes[0] ?? null,
    confidence: "high",
    lastSeenAt: new Date(),
    metadata: {
      packageId: id,
      packageType: type,
      publisher: asString(pkg.publisher),
      platform: asString(pkg.platform),
      elementTypes,
      supportedHosts,
      isBlocked: pkg.isBlocked === true,
      availableTo: asString(pkg.availableTo),
      deployedTo: asString(pkg.deployedTo),
      version: asString(pkg.version),
      manifestId: asString(pkg.manifestId),
      appId: asString(pkg.appId),
      lastModifiedAt: toDate(pkg.lastModifiedDateTime)?.toISOString() ?? null,
    },
  };
}

function permissionHint(status: number, message: string): string {
  if (status === 401 || status === 403) {
    return (
      `${message} — grant the ${COPILOT_PACKAGES_PERMISSION} application permission with admin consent ` +
      "on the Microsoft 365 app registration, and confirm the tenant has a Microsoft Agent 365 license."
    );
  }
  return message;
}

/** Page through the Copilot agent packages. */
export async function listCopilotAgentPackages(
  accessToken: string,
  fetchImpl: FetchLike = fetch
): Promise<{ packages: CopilotPackage[]; truncated: boolean }> {
  const packages: CopilotPackage[] = [];
  let url: string | null = `${GRAPH_BASE}${COPILOT_AGENT_PACKAGES_PATH}`;
  for (let i = 0; i < MAX_PAGES && url; i++) {
    const res = await fetchImpl(url, {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
    });
    if (!res.ok) {
      const message = await readErrorMessage(res);
      throw new Error(
        `Microsoft Graph Copilot packages request failed (${res.status}): ${permissionHint(res.status, message)}`
      );
    }
    const body = (await res.json()) as { value?: CopilotPackage[]; "@odata.nextLink"?: string };
    packages.push(...(body.value ?? []));
    const next = body["@odata.nextLink"] ?? null;
    // Only follow nextLinks that stay on Graph.
    url = next && next.startsWith(`${GRAPH_BASE}/`) ? next : null;
  }
  return { packages, truncated: url !== null };
}

/** No-op when not enabled or the Microsoft 365 app registration is missing. */
export async function importMicrosoftCopilotAgents(
  deps: { getToken?: () => Promise<string>; enabled?: boolean; fetchImpl?: FetchLike; upsert?: AgentUpsertFn } = {}
): Promise<AgentImportSummary & { configured: boolean; truncated?: boolean }> {
  const configured = deps.enabled ?? (await isMicrosoftCopilotAgentsConfigured());
  if (!configured) return { ...emptyImportSummary(), configured: false };
  try {
    const token = await (deps.getToken ?? getMicrosoft365AccessToken)();
    const { packages, truncated } = await listCopilotAgentPackages(token, deps.fetchImpl);
    const inputs = packages.map(mapCopilotPackage).filter((a): a is DiscoveredAgentInput => !!a);
    const summary = await applyAgentImport(inputs, deps.upsert);
    return { ...summary, configured: true, truncated };
  } catch (err) {
    return {
      ...emptyImportSummary(),
      configured: true,
      error: err instanceof Error ? err.message : "Microsoft Copilot agent import failed",
    };
  }
}

/** Connection test: token + first page. Works whether or not the import is enabled. */
export async function testMicrosoftCopilotAgents(
  fetchImpl: FetchLike = fetch
): Promise<{ success: boolean; message: string }> {
  if (!(await isMicrosoft365Configured())) {
    return {
      success: false,
      message: "The Microsoft 365 app registration is not configured (Settings → Shadow AI → Microsoft 365).",
    };
  }
  try {
    const token = await getMicrosoft365AccessToken();
    const res = await fetchImpl(`${GRAPH_BASE}${COPILOT_AGENT_PACKAGES_PATH}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    });
    if (!res.ok) {
      const message = await readErrorMessage(res);
      return { success: false, message: `Graph returned ${res.status}: ${permissionHint(res.status, message)}` };
    }
    const body = (await res.json()) as { value?: CopilotPackage[]; "@odata.nextLink"?: string };
    const agents = (body.value ?? []).filter((p) => mapCopilotPackage(p) !== null).length;
    return {
      success: true,
      message: `Connected. ${agents} non-Microsoft Copilot agent(s) on the first page${body["@odata.nextLink"] ? " (more available)" : ""}.`,
    };
  } catch (err) {
    return { success: false, message: err instanceof Error ? err.message : "Connection failed" };
  }
}
