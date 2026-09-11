/**
 * MCP tool activity recording for the Azure Functions proxy.
 *
 * PORT of the main app's `src/lib/mcp-tool-activity.ts` — the ai-proxy is a
 * separate project with its own Prisma client. Keep the semantics in sync:
 * one AgentToolCall per distinct tool invoked in a response, a first/last-seen
 * AgentToolProfile per (scope, server, tool), and alerts for unapproved and
 * never-seen-before tools.
 */

import { prisma } from "./db";
import type { LoadedAgent } from "./agent-loader";
import {
  dedupeToolUses,
  evaluateToolUses,
  isServerAllowed,
  scopeKeyFor,
  toolLabel,
  type DeclaredMcpServer,
  type ObservedToolUse,
} from "./mcp-tool-governance";

export const MCP_ALERT_SOURCE = "mcp_tool_governance";
export const MCP_SERVER_DENIAL_RULE = "mcp_server_not_allowed";

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

export async function recordToolActivity(input: {
  agent: LoadedAgent | null;
  aiSystemId: string | null;
  provider: string;
  model: string;
  requestId?: string | null;
  userEmail: string | null;
  department: string | null;
  declaredServers: DeclaredMcpServer[];
  toolUses: ObservedToolUse[];
}): Promise<void> {
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

    type ProfileKey = {
      serverKey: string;
      toolName: string;
      kind: string;
      serverName: string | null;
      serverHost: string | null;
      approved: boolean;
    };
    const wanted = new Map<string, ProfileKey>();
    for (const server of input.declaredServers) {
      wanted.set(`${server.name}|*`, {
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
      wanted.set(`${serverKey}|${use.toolName}`, {
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
          data: {
            lastSeenAt: now,
            callCount: { increment: 1 },
            approved: profile.approved,
            kind: profile.kind,
            serverHost: profile.serverHost ?? undefined,
          },
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
      if (newTools.length) {
        parts.push(`tools: ${newTools.map((p) => toolLabel({ serverName: p.serverName, toolName: p.toolName })).join(", ")}`);
      }
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
