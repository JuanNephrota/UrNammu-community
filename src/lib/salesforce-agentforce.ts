/**
 * Salesforce Agentforce agent inventory import (source `salesforce_agentforce`).
 *
 * Auth — OAuth 2.0 client credentials against the org's My Domain (the flow
 * is not supported on login.salesforce.com / test.salesforce.com):
 *
 *   POST https://<MyDomain>.my.salesforce.com/services/oauth2/token
 *        grant_type=client_credentials&client_id=…&client_secret=…
 *
 * The connected app (or external client app) must have "Enable Client
 * Credentials Flow" on and a Run As user (ideally an integration-only user)
 * that can read the Bot setup objects.
 *
 * Inventory — an Agentforce agent is a `BotDefinition` (API v60.0+; the
 * agent ID the Agent API takes is the BotDefinition Id). Both it and
 * `BotVersion` are queryable with SOQL over REST:
 *
 *   GET /services/data/v62.0/query?q=SELECT Id, DeveloperName, MasterLabel,
 *       Description, AgentType, CreatedDate, LastModifiedDate FROM BotDefinition
 *   GET /services/data/v62.0/query?q=SELECT BotDefinitionId, VersionNumber,
 *       Status FROM BotVersion
 *
 * `GenAiPlannerDefinition` is the agent's planner (reasoning engine), not
 * the agent itself, and `GenAiPlannerBundle` / `GenAiFunction` are not
 * SOQL-queryable, so topics and actions are not imported.
 *
 * `AgentType` separates Agentforce agents from classic Einstein Bots, but
 * its field docs could not be verified; if the org rejects the field
 * (INVALID_FIELD), the import retries without it and keeps every bot.
 */
import type { DiscoveredAgentInput } from "./agent-discovery";
import {
  applyAgentImport,
  asRecord,
  asString,
  emptyImportSummary,
  readErrorMessage,
  toDate,
  type AgentImportSummary,
  type AgentUpsertFn,
  type FetchLike,
} from "./agent-import";
import { AGENT_PLATFORM_SETTINGS_KEYS, getSetting } from "./settings";

export const SALESFORCE_API_VERSION = "v62.0";
const MAX_QUERY_PAGES = 20;

const BOT_FIELDS_WITH_TYPE =
  "Id, DeveloperName, MasterLabel, Description, AgentType, CreatedDate, LastModifiedDate";
const BOT_FIELDS_BASE = "Id, DeveloperName, MasterLabel, Description, CreatedDate, LastModifiedDate";

export type SalesforceConfig = { instanceUrl: string; clientId: string; clientSecret: string };

export type BotDefinitionRecord = {
  Id?: string;
  DeveloperName?: string | null;
  MasterLabel?: string | null;
  Description?: string | null;
  AgentType?: string | null;
  CreatedDate?: string | null;
  LastModifiedDate?: string | null;
  [k: string]: unknown;
};

export type BotVersionRecord = {
  BotDefinitionId?: string;
  VersionNumber?: number | null;
  Status?: string | null;
  [k: string]: unknown;
};

const ALLOWED_HOST_SUFFIXES = [".salesforce.com", ".force.com", ".salesforce.mil"];

/**
 * Normalise the configured My Domain URL to `https://host` and refuse
 * anything that is not a Salesforce host, so the stored client secret is
 * only ever posted to Salesforce.
 */
export function normalizeSalesforceInstanceUrl(raw: string | null | undefined): string | null {
  const trimmed = raw?.trim();
  if (!trimmed) return null;
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  const host = url.hostname.toLowerCase();
  if (!ALLOWED_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix))) return null;
  if (host === "login.salesforce.com" || host === "test.salesforce.com") return null;
  return `https://${host}`;
}

export async function getSalesforceConfig(): Promise<SalesforceConfig | null> {
  const [instanceUrl, clientId, clientSecret] = await Promise.all([
    getSetting(AGENT_PLATFORM_SETTINGS_KEYS.SALESFORCE_INSTANCE_URL),
    getSetting(AGENT_PLATFORM_SETTINGS_KEYS.SALESFORCE_CLIENT_ID),
    getSetting(AGENT_PLATFORM_SETTINGS_KEYS.SALESFORCE_CLIENT_SECRET),
  ]);
  const normalized = normalizeSalesforceInstanceUrl(instanceUrl);
  if (!normalized || !clientId || !clientSecret) return null;
  return { instanceUrl: normalized, clientId, clientSecret };
}

export async function isSalesforceAgentforceConfigured(): Promise<boolean> {
  return !!(await getSalesforceConfig());
}

/** Client-credentials token. Returns the token and the instance URL to call. */
export async function getSalesforceAccessToken(
  config: SalesforceConfig,
  fetchImpl: FetchLike = fetch
): Promise<{ accessToken: string; instanceUrl: string }> {
  const res = await fetchImpl(`${config.instanceUrl}/services/oauth2/token`, {
    method: "POST",
    // Never follow a redirect: a 307/308 would re-POST the client secret to
    // wherever the configured host points.
    redirect: "error",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: config.clientId,
      client_secret: config.clientSecret,
    }).toString(),
  });
  if (!res.ok) {
    throw new Error(`Salesforce token request failed (${res.status}): ${await readErrorMessage(res)}`);
  }
  const body = asRecord(await res.json());
  const accessToken = asString(body.access_token);
  if (!accessToken) throw new Error("Salesforce token response did not include an access_token.");
  // Salesforce returns the org's instance_url; only trust it if it is a
  // Salesforce host too.
  const instanceUrl = normalizeSalesforceInstanceUrl(asString(body.instance_url)) ?? config.instanceUrl;
  return { accessToken, instanceUrl };
}

class SalesforceQueryError extends Error {
  constructor(message: string, readonly status: number, readonly body: string) {
    super(message);
    this.name = "SalesforceQueryError";
  }
}

/** Run a SOQL query and follow `nextRecordsUrl`. */
export async function salesforceQuery<T>(
  instanceUrl: string,
  accessToken: string,
  soql: string,
  fetchImpl: FetchLike = fetch
): Promise<{ records: T[]; truncated: boolean }> {
  const records: T[] = [];
  let path: string | null = `/services/data/${SALESFORCE_API_VERSION}/query?q=${encodeURIComponent(soql)}`;
  for (let i = 0; i < MAX_QUERY_PAGES && path; i++) {
    const res = await fetchImpl(`${instanceUrl}${path}`, {
      redirect: "error",
      headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
    });
    if (!res.ok) {
      const text = await res.clone().text().catch(() => "");
      throw new SalesforceQueryError(
        `Salesforce query failed (${res.status}): ${await readErrorMessage(res)}`,
        res.status,
        text
      );
    }
    const body = asRecord(await res.json());
    records.push(...((Array.isArray(body.records) ? body.records : []) as T[]));
    const next = body.done === true ? null : asString(body.nextRecordsUrl);
    // nextRecordsUrl is a path on the same instance.
    path = next && next.startsWith("/services/data/") ? next : null;
  }
  return { records, truncated: path !== null };
}

function isInvalidField(err: unknown): boolean {
  return err instanceof SalesforceQueryError && err.status === 400 && /INVALID_FIELD/.test(err.body);
}

/** Latest version number and whether any version is Active, per bot. */
export function summarizeBotVersions(
  versions: readonly BotVersionRecord[]
): Map<string, { active: boolean; latestVersion: number | null; activeVersion: number | null }> {
  const out = new Map<string, { active: boolean; latestVersion: number | null; activeVersion: number | null }>();
  for (const v of versions) {
    const botId = asString(v.BotDefinitionId);
    if (!botId) continue;
    const entry = out.get(botId) ?? { active: false, latestVersion: null, activeVersion: null };
    const num = typeof v.VersionNumber === "number" ? v.VersionNumber : null;
    if (num != null && (entry.latestVersion == null || num > entry.latestVersion)) entry.latestVersion = num;
    if (asString(v.Status)?.toLowerCase() === "active") {
      entry.active = true;
      if (num != null) entry.activeVersion = num;
    }
    out.set(botId, entry);
  }
  return out;
}

export function mapBotDefinition(
  bot: BotDefinitionRecord,
  version?: { active: boolean; latestVersion: number | null; activeVersion: number | null },
  instanceUrl?: string
): DiscoveredAgentInput | null {
  const id = asString(bot.Id);
  if (!id) return null;
  const agentType = asString(bot.AgentType);
  return {
    source: "salesforce_agentforce",
    externalId: id,
    name: asString(bot.MasterLabel) ?? asString(bot.DeveloperName) ?? id,
    description: asString(bot.Description),
    platform: "Salesforce Agentforce",
    framework: agentType,
    confidence: "high",
    firstSeenAt: toDate(bot.CreatedDate),
    lastSeenAt: new Date(),
    metadata: {
      botDefinitionId: id,
      developerName: asString(bot.DeveloperName),
      agentType,
      active: version?.active ?? null,
      activeVersion: version?.activeVersion ?? null,
      latestVersion: version?.latestVersion ?? null,
      lastModifiedAt: toDate(bot.LastModifiedDate)?.toISOString() ?? null,
      instanceHost: instanceUrl ? new URL(instanceUrl).hostname : null,
    },
  };
}

/** Query BotDefinition (with AgentType when the org supports it) and BotVersion. */
export async function listAgentforceAgents(
  instanceUrl: string,
  accessToken: string,
  fetchImpl: FetchLike = fetch
): Promise<{ bots: BotDefinitionRecord[]; versions: BotVersionRecord[]; truncated: boolean }> {
  let bots: { records: BotDefinitionRecord[]; truncated: boolean };
  try {
    bots = await salesforceQuery<BotDefinitionRecord>(
      instanceUrl,
      accessToken,
      `SELECT ${BOT_FIELDS_WITH_TYPE} FROM BotDefinition`,
      fetchImpl
    );
  } catch (err) {
    if (!isInvalidField(err)) throw err;
    bots = await salesforceQuery<BotDefinitionRecord>(
      instanceUrl,
      accessToken,
      `SELECT ${BOT_FIELDS_BASE} FROM BotDefinition`,
      fetchImpl
    );
  }
  // Version status is enrichment; a Run As user without access to
  // BotVersion still gets the agent list.
  let versions: BotVersionRecord[] = [];
  try {
    versions = (
      await salesforceQuery<BotVersionRecord>(
        instanceUrl,
        accessToken,
        "SELECT BotDefinitionId, VersionNumber, Status FROM BotVersion",
        fetchImpl
      )
    ).records;
  } catch {
    versions = [];
  }
  return { bots: bots.records, versions, truncated: bots.truncated };
}

/** No-op when instance URL, client ID or secret is missing. */
export async function importSalesforceAgentforce(
  deps: { config?: SalesforceConfig | null; fetchImpl?: FetchLike; upsert?: AgentUpsertFn } = {}
): Promise<AgentImportSummary & { configured: boolean; truncated?: boolean }> {
  const config = deps.config !== undefined ? deps.config : await getSalesforceConfig();
  if (!config) return { ...emptyImportSummary(), configured: false };
  try {
    const { accessToken, instanceUrl } = await getSalesforceAccessToken(config, deps.fetchImpl);
    const { bots, versions, truncated } = await listAgentforceAgents(instanceUrl, accessToken, deps.fetchImpl);
    const byBot = summarizeBotVersions(versions);
    const inputs = bots
      .map((bot) => mapBotDefinition(bot, byBot.get(asString(bot.Id) ?? ""), instanceUrl))
      .filter((a): a is DiscoveredAgentInput => !!a);
    const summary = await applyAgentImport(inputs, deps.upsert);
    return { ...summary, configured: true, truncated };
  } catch (err) {
    return {
      ...emptyImportSummary(),
      configured: true,
      error: err instanceof Error ? err.message : "Salesforce Agentforce import failed",
    };
  }
}

/** Connection test: token + a COUNT() of BotDefinition. */
export async function testSalesforceAgentforce(
  fetchImpl: FetchLike = fetch
): Promise<{ success: boolean; message: string }> {
  const config = await getSalesforceConfig();
  if (!config) {
    return {
      success: false,
      message:
        "Missing or invalid configuration. A My Domain URL (https://<domain>.my.salesforce.com), client ID and client secret are required.",
    };
  }
  try {
    const { accessToken, instanceUrl } = await getSalesforceAccessToken(config, fetchImpl);
    const res = await fetchImpl(
      `${instanceUrl}/services/data/${SALESFORCE_API_VERSION}/query?q=${encodeURIComponent("SELECT COUNT() FROM BotDefinition")}`,
      { redirect: "error", headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" } }
    );
    if (!res.ok) {
      return {
        success: false,
        message: `Authenticated, but the BotDefinition query failed (${res.status}): ${await readErrorMessage(res)}. Check the Run As user's access to Agentforce / Bot setup objects.`,
      };
    }
    const body = asRecord(await res.json());
    const total = typeof body.totalSize === "number" ? body.totalSize : null;
    return {
      success: true,
      message: `Connected to ${new URL(instanceUrl).hostname}${total != null ? ` — ${total} agent(s) (BotDefinition)` : ""}.`,
    };
  } catch (err) {
    return { success: false, message: err instanceof Error ? err.message : "Connection failed" };
  }
}
