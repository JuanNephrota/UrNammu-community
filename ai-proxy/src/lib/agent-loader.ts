/**
 * Agent governance loader for the Azure Functions proxy.
 *
 * Resolves the `x-agent-id` header to the agent's MCP allowlists with a short
 * in-memory TTL cache, following the same fail-closed contract as
 * policy-loader.ts: a DB error serves the last known value if there is one
 * and otherwise propagates so the caller can refuse the request rather than
 * forwarding it unenforced.
 */

import { prisma } from "./db";
import {
  mergeCatalogIntoConfig,
  normalizeEnforcement,
  type McpCatalogEntryLike,
  type McpGovernanceConfig,
} from "./mcp-tool-governance";
import {
  normalizeHumanReviewTriggers,
  normalizeReviewEnforcement,
  type HumanReviewEnforcement,
  type HumanReviewTrigger,
} from "./human-review-triggers";

export type LoadedAgent = {
  id: string;
  name: string;
  aiSystemId: string | null;
  /** Lifecycle status (AISystemStatus) and kill-switch timestamp; see agent-runtime-gate.ts. */
  status: string;
  suspendedAt: Date | null;
  config: McpGovernanceConfig;
  /** Human-review triggers and how a match is handled; see human-review-triggers.ts. */
  review: { triggers: HumanReviewTrigger[]; enforcement: HumanReviewEnforcement };
};

type CacheEntry = { value: LoadedAgent | null; expiresAt: number };

const AGENT_TTL_MS = 30_000;
const agentCache = new Map<string, CacheEntry>();

const CATALOG_TTL_MS = 60_000;
let catalogCache: { value: McpCatalogEntryLike[]; expiresAt: number } | null = null;

/** Active org-approved MCP catalog, cached; same fail-closed contract as the agent. */
async function loadCatalog(): Promise<McpCatalogEntryLike[]> {
  const now = Date.now();
  if (catalogCache && catalogCache.expiresAt > now) return catalogCache.value;
  try {
    const rows = await prisma.mcpCatalogEntry.findMany({ where: { active: true }, select: { server: true, tools: true } });
    catalogCache = { value: rows, expiresAt: now + CATALOG_TTL_MS };
    return rows;
  } catch (err) {
    if (catalogCache) {
      console.error("loadCatalog: DB error, serving stale cached catalog:", err);
      return catalogCache.value;
    }
    throw err;
  }
}

export async function loadAgent(agentId: string): Promise<LoadedAgent | null> {
  const now = Date.now();
  const cached = agentCache.get(agentId);
  if (cached && cached.expiresAt > now) return cached.value;

  let row;
  try {
    row = await prisma.aIAgent.findUnique({
      where: { id: agentId },
      select: {
        id: true,
        name: true,
        aiSystemId: true,
        mcpServerAllowlist: true,
        mcpToolAllowlist: true,
        mcpEnforcement: true,
        status: true,
        suspendedAt: true,
        humanReviewTriggers: true,
        humanReviewEnforcement: true,
        inheritMcpCatalog: true,
      },
    });
  } catch (err) {
    if (cached) {
      console.error("loadAgent: DB error, serving stale cached agent:", err);
      return cached.value;
    }
    throw err;
  }

  const ownConfig: McpGovernanceConfig | null = row
    ? {
        serverAllowlist: row.mcpServerAllowlist,
        toolAllowlist: row.mcpToolAllowlist,
        enforcement: normalizeEnforcement(row.mcpEnforcement),
      }
    : null;
  // Org catalog: merged when the agent inherits it. Loaded only then, and
  // failing closed like the agent row itself.
  const config =
    row && ownConfig && row.inheritMcpCatalog ? mergeCatalogIntoConfig(ownConfig, await loadCatalog()) : ownConfig;

  const value: LoadedAgent | null = row && config
    ? {
        id: row.id,
        name: row.name,
        aiSystemId: row.aiSystemId,
        status: row.status,
        suspendedAt: row.suspendedAt,
        config,
        review: {
          triggers: normalizeHumanReviewTriggers(row.humanReviewTriggers),
          enforcement: normalizeReviewEnforcement(row.humanReviewEnforcement),
        },
      }
    : null;

  agentCache.set(agentId, { value, expiresAt: now + AGENT_TTL_MS });
  return value;
}

export function __clearAgentCache() {
  agentCache.clear();
  catalogCache = null;
}
