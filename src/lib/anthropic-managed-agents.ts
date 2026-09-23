/**
 * Anthropic Managed Agents inventory import (source `anthropic_managed_agents`).
 *
 * Lists the saved agent configurations in one Claude Platform workspace:
 *
 *   GET https://api.anthropic.com/v1/agents?limit=100[&page=<cursor>]
 *   x-api-key: <workspace API key>
 *   anthropic-version: 2023-06-01
 *   anthropic-beta: managed-agents-2026-04-01
 *
 * Response: `{ data: Agent[], next_page: string | null }`. An Agent carries
 * `id`, `name`, `description`, `model` (string or `{ id, … }`), `tools`
 * (`agent_toolset_20260401` / `mcp_toolset` / custom), `mcp_servers`
 * (`{ type: "url", name, url }`), `skills`, `version`, `created_at`,
 * `updated_at`, `archived_at`. The `system` prompt is never read into
 * UrNammu — it is content.
 *
 * Managed Agents endpoints take a regular API key; Admin keys are rejected,
 * so this uses its own setting. See docs/plans/agent-discovery.md (Gap 2).
 */
import type { DiscoveredAgentInput } from "./agent-discovery";
import {
  applyAgentImport,
  asArray,
  asRecord,
  asString,
  emptyImportSummary,
  hostOfUrl,
  readErrorMessage,
  toDate,
  type AgentImportSummary,
  type AgentUpsertFn,
  type FetchLike,
} from "./agent-import";
import { AGENT_PLATFORM_SETTINGS_KEYS, getSetting } from "./settings";

const BASE_URL = "https://api.anthropic.com";
export const MANAGED_AGENTS_BETA = "managed-agents-2026-04-01";
const PAGE_SIZE = 100;
/** 20 pages × 100 = 2,000 agents per workspace per run. */
const MAX_PAGES = 20;

export type ManagedAgent = {
  id?: string;
  type?: string;
  name?: string | null;
  description?: string | null;
  model?: string | { id?: string } | null;
  tools?: Array<Record<string, unknown>> | null;
  mcp_servers?: Array<Record<string, unknown>> | null;
  skills?: Array<Record<string, unknown>> | null;
  version?: number | null;
  created_at?: string | null;
  updated_at?: string | null;
  archived_at?: string | null;
  metadata?: Record<string, unknown> | null;
  [k: string]: unknown;
};

export async function getManagedAgentsApiKey(): Promise<string | null> {
  return getSetting(AGENT_PLATFORM_SETTINGS_KEYS.ANTHROPIC_MANAGED_AGENTS_API_KEY);
}

export async function isAnthropicManagedAgentsConfigured(): Promise<boolean> {
  return !!(await getManagedAgentsApiKey());
}

function modelId(model: ManagedAgent["model"]): string | null {
  if (typeof model === "string") return asString(model);
  return asString(asRecord(model).id);
}

/**
 * Tool identifiers for the review queue: the prebuilt toolset type
 * (`agent_toolset_20260401`), `mcp:<server>` for an MCP toolset, and the
 * name of each custom tool. Never tool input schemas or descriptions.
 */
export function managedAgentTools(agent: ManagedAgent): string[] {
  const out: string[] = [];
  for (const raw of asArray(agent.tools)) {
    const tool = asRecord(raw);
    const type = asString(tool.type);
    if (!type) continue;
    if (type === "mcp_toolset") {
      const server = asString(tool.mcp_server_name);
      if (server) out.push(`mcp:${server}`);
    } else if (type === "custom") {
      const name = asString(tool.name);
      if (name) out.push(name);
    } else {
      out.push(type);
    }
  }
  return out;
}

/** Map one listed agent. Archived agents (read-only, cannot run) are skipped. */
export function mapManagedAgent(agent: ManagedAgent): DiscoveredAgentInput | null {
  const id = asString(agent.id);
  if (!id) return null;
  if (asString(agent.archived_at)) return null;

  const servers = asArray(agent.mcp_servers).map(asRecord);
  const mcpServers = servers.map((s) => asString(s.name)).filter((n): n is string => !!n);
  const mcpServerHosts = [...new Set(servers.map((s) => hostOfUrl(s.url)).filter((h): h is string => !!h))];
  const skills = asArray(agent.skills)
    .map((raw) => asString(asRecord(raw).skill_id))
    .filter((s): s is string => !!s);
  const model = modelId(agent.model);

  return {
    source: "anthropic_managed_agents",
    externalId: id,
    name: asString(agent.name) ?? id,
    description: asString(agent.description),
    platform: "Claude Managed Agents",
    framework: "claude-managed-agents",
    confidence: "high",
    tools: managedAgentTools(agent),
    mcpServers,
    models: model ? [model] : [],
    firstSeenAt: toDate(agent.created_at),
    lastSeenAt: new Date(),
    metadata: {
      agentId: id,
      version: typeof agent.version === "number" ? agent.version : null,
      updatedAt: asString(agent.updated_at),
      mcpServerHosts,
      skills,
    },
  };
}

type ListPage = { data?: ManagedAgent[]; next_page?: string | null };

/** Page through GET /v1/agents. Throws with the API's message on failure. */
export async function listManagedAgents(
  apiKey: string,
  fetchImpl: FetchLike = fetch
): Promise<{ agents: ManagedAgent[]; truncated: boolean }> {
  const agents: ManagedAgent[] = [];
  let page: string | null = null;
  for (let i = 0; i < MAX_PAGES; i++) {
    const query = new URLSearchParams({ limit: String(PAGE_SIZE) });
    if (page) query.set("page", page);
    const res = await fetchImpl(`${BASE_URL}/v1/agents?${query.toString()}`, {
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-beta": MANAGED_AGENTS_BETA,
      },
    });
    if (!res.ok) {
      throw new Error(`Anthropic Managed Agents API error (${res.status}): ${await readErrorMessage(res)}`);
    }
    const body = (await res.json()) as ListPage;
    agents.push(...(body.data ?? []));
    page = body.next_page ?? null;
    if (!page) return { agents, truncated: false };
  }
  return { agents, truncated: true };
}

/** No-op (all zeros) when no key is configured. */
export async function importAnthropicManagedAgents(
  deps: { apiKey?: string | null; fetchImpl?: FetchLike; upsert?: AgentUpsertFn } = {}
): Promise<AgentImportSummary & { configured: boolean; truncated?: boolean }> {
  const apiKey = deps.apiKey !== undefined ? deps.apiKey : await getManagedAgentsApiKey();
  if (!apiKey) return { ...emptyImportSummary(), configured: false };
  try {
    const { agents, truncated } = await listManagedAgents(apiKey, deps.fetchImpl);
    const inputs = agents.map(mapManagedAgent).filter((a): a is DiscoveredAgentInput => !!a);
    const summary = await applyAgentImport(inputs, deps.upsert);
    return { ...summary, configured: true, truncated };
  } catch (err) {
    return {
      ...emptyImportSummary(),
      configured: true,
      error: err instanceof Error ? err.message : "Anthropic Managed Agents import failed",
    };
  }
}

/** Connection test: one page of one agent. */
export async function testAnthropicManagedAgents(
  fetchImpl: FetchLike = fetch
): Promise<{ success: boolean; message: string }> {
  const apiKey = await getManagedAgentsApiKey();
  if (!apiKey) return { success: false, message: "No Managed Agents API key is configured." };
  try {
    const res = await fetchImpl(`${BASE_URL}/v1/agents?limit=1`, {
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-beta": MANAGED_AGENTS_BETA,
      },
    });
    if (!res.ok) {
      return {
        success: false,
        message: `Anthropic Managed Agents API error (${res.status}): ${await readErrorMessage(res)}`,
      };
    }
    const body = (await res.json()) as ListPage;
    const more = body.next_page ? " (more available)" : "";
    return {
      success: true,
      message: `Connected. ${body.data?.length ?? 0} agent(s) on the first page${more}.`,
    };
  } catch (err) {
    return { success: false, message: err instanceof Error ? err.message : "Connection failed" };
  }
}
