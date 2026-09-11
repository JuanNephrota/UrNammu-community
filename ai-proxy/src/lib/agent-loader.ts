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
import { normalizeEnforcement, type McpGovernanceConfig } from "./mcp-tool-governance";

export type LoadedAgent = {
  id: string;
  name: string;
  aiSystemId: string | null;
  config: McpGovernanceConfig;
};

type CacheEntry = { value: LoadedAgent | null; expiresAt: number };

const AGENT_TTL_MS = 30_000;
const agentCache = new Map<string, CacheEntry>();

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
      },
    });
  } catch (err) {
    if (cached) {
      console.error("loadAgent: DB error, serving stale cached agent:", err);
      return cached.value;
    }
    throw err;
  }

  const value: LoadedAgent | null = row
    ? {
        id: row.id,
        name: row.name,
        aiSystemId: row.aiSystemId,
        config: {
          serverAllowlist: row.mcpServerAllowlist,
          toolAllowlist: row.mcpToolAllowlist,
          enforcement: normalizeEnforcement(row.mcpEnforcement),
        },
      }
    : null;

  agentCache.set(agentId, { value, expiresAt: now + AGENT_TTL_MS });
  return value;
}

export function __clearAgentCache() {
  agentCache.clear();
}
