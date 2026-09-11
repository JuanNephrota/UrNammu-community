/**
 * IO layer for MCP tool governance in the Next.js (Vercel fallback) proxy.
 * Mirrored for the Azure proxy in `ai-proxy/src/lib/tool-activity.ts`.
 *
 * Records what tools an agent's model calls actually invoked, keeps a
 * first-seen/last-seen profile per (scope, server, tool), and raises alerts
 * for tools outside the agent's allowlist and for tools never seen before.
 */

import { prisma } from "./prisma";
import {
  dedupeToolUses,
  evaluateToolUses,
  isServerAllowed,
  normalizeEnforcement,
  scopeKeyFor,
  toolLabel,
  type DeclaredMcpServer,
  type McpGovernanceConfig,
  type ObservedToolUse,
} from "./mcp-tool-governance";

export const MCP_ALERT_SOURCE = "mcp_tool_governance";
export const MCP_SERVER_DENIAL_RULE = "mcp_server_not_allowed";

export type AgentGovernance = {
  id: string;
  name: string;
  aiSystemId: string | null;
  config: McpGovernanceConfig;
};

export async function loadAgentGovernance(agentId: string | null): Promise<AgentGovernance | null> {
  if (!agentId) return null;
  try {
    const agent = await prisma.aIAgent.findUnique({
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
    if (!agent) return null;
    return {
      id: agent.id,
      name: agent.name,
      aiSystemId: agent.aiSystemId,
      config: {
        serverAllowlist: agent.mcpServerAllowlist,
        toolAllowlist: agent.mcpToolAllowlist,
        enforcement: normalizeEnforcement(agent.mcpEnforcement),
      },
    };
  } catch (err) {
    console.error("loadAgentGovernance failed:", err);
    return null;
  }
}

export async function logMcpServerDenial(input: {
  provider: string;
  model: string;
  agent: AgentGovernance;
  aiSystemId: string | null;
  userEmail: string | null;
  department: string | null;
  deniedServers: DeclaredMcpServer[];
  isStreaming: boolean;
}) {
  try {
    await prisma.policyDenial.create({
      data: {
        provider: input.provider,
        model: input.model,
        aiSystemId: input.aiSystemId,
        userEmail: input.userEmail,
        department: input.department,
        mode: input.agent.config.enforcement === "enforce" ? "enforced" : "dryrun",
        policyIds: [],
        reasons: input.deniedServers.map((server) => ({
          ruleKey: MCP_SERVER_DENIAL_RULE,
          message: `MCP server "${server.name}"${server.host ? ` (${server.host})` : ""} is not on the allowlist for agent "${input.agent.name}".`,
          policyId: input.agent.id,
          policyName: `Agent MCP allowlist: ${input.agent.name}`,
        })),
        promptExcerpt: null,
        requestMetadata: {
          isStreaming: input.isStreaming,
          agentId: input.agent.id,
          deniedServers: input.deniedServers.map((s) => ({ name: s.name, host: s.host })),
        },
      },
    });
  } catch (err) {
    console.error("logMcpServerDenial failed:", err);
  }
}

const ALERT_DEDUPE_MS = 24 * 60 * 60 * 1000;

async function upsertAlert(input: {
  title: string;
  description: string;
  severity: "HIGH" | "MEDIUM";
  aiSystemId: string | null;
}) {
  const recent = await prisma.alert.findFirst({
    where: {
      source: MCP_ALERT_SOURCE,
      title: input.title,
      status: { in: ["OPEN", "ACKNOWLEDGED"] },
      createdAt: { gte: new Date(Date.now() - ALERT_DEDUPE_MS) },
    },
    select: { id: true },
  });
  if (recent) {
    await prisma.alert.update({
      where: { id: recent.id },
      data: { description: input.description, severity: input.severity },
    });
    return;
  }
  await prisma.alert.create({
    data: {
      title: input.title,
      description: input.description,
      severity: input.severity,
      source: MCP_ALERT_SOURCE,
      aiSystemId: input.aiSystemId,
    },
  });
}

/**
 * Persist one request's tool activity. Safe to call with empty inputs (no-op).
 * Never throws — failures are logged so the proxy response is unaffected.
 */
export async function recordToolActivity(input: {
  agent: AgentGovernance | null;
  aiSystemId: string | null;
  provider: string;
  model: string;
  requestId?: string | null;
  userEmail: string | null;
  department: string | null;
  declaredServers: DeclaredMcpServer[];
  toolUses: ObservedToolUse[];
}) {
  if (input.declaredServers.length === 0 && input.toolUses.length === 0) return;
  try {
    const agentId = input.agent?.id ?? null;
    const aiSystemId = input.aiSystemId ?? input.agent?.aiSystemId ?? null;
    const scopeKey = scopeKeyFor(agentId, aiSystemId);
    const config = input.agent?.config ?? null;
    const uses = dedupeToolUses(input.toolUses);
    const verdicts = config ? evaluateToolUses(uses, config) : uses.map((use) => ({ use, allowed: true }));
    const now = new Date();

    if (verdicts.length > 0) {
      await prisma.agentToolCall.createMany({
        data: verdicts.map(({ use, allowed }) => ({
          agentId,
          aiSystemId,
          provider: input.provider,
          model: input.model,
          kind: use.kind,
          serverName: use.serverName,
          toolName: use.toolName,
          approved: allowed,
          requestId: input.requestId ?? null,
          userEmail: input.userEmail,
          department: input.department,
        })),
      });
    }

    // Profiles: declared servers (toolName "*") + each observed tool.
    type ProfileKey = { serverKey: string; toolName: string; kind: string; serverName: string | null; serverHost: string | null; approved: boolean };
    const wanted = new Map<string, ProfileKey>();
    for (const server of input.declaredServers) {
      const key = `${server.name}|*`;
      wanted.set(key, {
        serverKey: server.name,
        toolName: "*",
        kind: "mcp_server",
        serverName: server.name,
        serverHost: server.host,
        approved: config ? isServerAllowed(server, config.serverAllowlist) : true,
      });
    }
    for (const { use, allowed } of verdicts) {
      const serverKey = use.serverName ?? "-";
      const key = `${serverKey}|${use.toolName}`;
      wanted.set(key, {
        serverKey,
        toolName: use.toolName,
        kind: use.kind,
        serverName: use.serverName,
        serverHost: input.declaredServers.find((s) => s.name === use.serverName)?.host ?? null,
        approved: allowed,
      });
    }
    if (wanted.size === 0) return;

    const existing = await prisma.agentToolProfile.findMany({
      where: {
        scopeKey,
        OR: Array.from(wanted.values()).map((p) => ({ serverKey: p.serverKey, toolName: p.toolName })),
      },
      select: { id: true, serverKey: true, toolName: true },
    });
    const existingByKey = new Map(existing.map((p) => [`${p.serverKey}|${p.toolName}`, p.id]));

    const firstSeen: ProfileKey[] = [];
    for (const [key, profile] of wanted) {
      const id = existingByKey.get(key);
      if (id) {
        await prisma.agentToolProfile.update({
          where: { id },
          data: { lastSeenAt: now, callCount: { increment: 1 }, approved: profile.approved, kind: profile.kind, serverHost: profile.serverHost ?? undefined },
        });
      } else {
        await prisma.agentToolProfile.upsert({
          where: { scopeKey_serverKey_toolName: { scopeKey, serverKey: profile.serverKey, toolName: profile.toolName } },
          update: { lastSeenAt: now, callCount: { increment: 1 }, approved: profile.approved },
          create: {
            scopeKey,
            agentId,
            aiSystemId,
            serverKey: profile.serverKey,
            serverName: profile.serverName,
            serverHost: profile.serverHost,
            toolName: profile.toolName,
            kind: profile.kind,
            approved: profile.approved,
            callCount: 1,
            firstSeenAt: now,
            lastSeenAt: now,
          },
        });
        firstSeen.push(profile);
      }
    }

    // Alerts only make sense when the traffic is attributed to something.
    if (!agentId && !aiSystemId) return;
    const subject = input.agent ? `agent "${input.agent.name}"` : `system ${aiSystemId}`;

    const unapproved = verdicts.filter((v) => !v.allowed);
    if (unapproved.length > 0) {
      const labels = unapproved.map((v) => toolLabel(v.use));
      const mode = input.agent?.config.enforcement === "enforce" ? "enforce" : "monitor";
      await upsertAlert({
        title: `Unapproved MCP tool invoked by ${input.agent?.name ?? aiSystemId}`,
        description: `${subject} invoked ${labels.join(", ")} via ${input.provider}/${input.model}, which is outside its MCP allowlist (${mode} mode). Approve the tool on the agent page or tighten the request's allowed_tools.`,
        severity: "HIGH",
        aiSystemId,
      });
    }

    const newTools = firstSeen.filter((p) => p.kind !== "mcp_server" && p.approved);
    const newServers = firstSeen.filter((p) => p.kind === "mcp_server" && p.approved);
    if (newTools.length > 0 || newServers.length > 0) {
      const parts: string[] = [];
      if (newServers.length) parts.push(`servers: ${newServers.map((p) => p.serverKey).join(", ")}`);
      if (newTools.length) parts.push(`tools: ${newTools.map((p) => toolLabel({ serverName: p.serverName, toolName: p.toolName })).join(", ")}`);
      await upsertAlert({
        title: `New MCP tool activity for ${input.agent?.name ?? aiSystemId}`,
        description: `First time ${subject} was observed using ${parts.join("; ")} (${input.provider}/${input.model}). Review on the agent page and add to the allowlist if expected.`,
        severity: "MEDIUM",
        aiSystemId,
      });
    }
  } catch (err) {
    console.error("recordToolActivity failed:", err);
  }
}
