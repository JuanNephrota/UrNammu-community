import Link from "next/link";
import { Plug, ShieldAlert, ShieldCheck } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/layout/page-header";
import { StatCard } from "@/components/dashboard/stat-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDateTime } from "@/lib/utils";

export const dynamic = "force-dynamic";

const KIND_LABELS: Record<string, string> = {
  mcp_server: "MCP server",
  mcp_tool_use: "MCP tool",
  server_tool_use: "Provider tool",
  tool_use: "Client tool",
};

function daysAgo(days: number) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

export default async function McpActivityPage() {
  const since7d = daysAgo(7);

  const [calls7d, unapproved7d, distinctTools, recentCalls, profiles, agents] = await Promise.all([
    prisma.agentToolCall.count({ where: { createdAt: { gte: since7d } } }),
    prisma.agentToolCall.count({ where: { createdAt: { gte: since7d }, approved: false } }),
    prisma.agentToolCall.groupBy({
      by: ["serverName", "toolName"],
      where: { createdAt: { gte: since7d } },
    }),
    prisma.agentToolCall.findMany({
      orderBy: { createdAt: "desc" },
      take: 100,
      include: { agent: { select: { id: true, name: true } } },
    }),
    prisma.agentToolProfile.findMany({
      where: { kind: { not: "mcp_server" } },
      orderBy: [{ approved: "asc" }, { lastSeenAt: "desc" }],
      take: 200,
      include: { agent: { select: { id: true, name: true } } },
    }),
    prisma.aIAgent.findMany({
      select: {
        id: true,
        name: true,
        mcpEnforcement: true,
        mcpServerAllowlist: true,
        mcpToolAllowlist: true,
        _count: { select: { toolCalls: { where: { createdAt: { gte: since7d } } } } },
      },
      orderBy: { name: "asc" },
    }),
  ]);

  const systemIds = Array.from(
    new Set([...recentCalls, ...profiles].map((r) => r.aiSystemId).filter((id): id is string => !!id))
  );
  const systems = systemIds.length
    ? await prisma.aISystem.findMany({ where: { id: { in: systemIds } }, select: { id: true, name: true } })
    : [];
  const systemName = new Map(systems.map((s) => [s.id, s.name]));

  const activeAgents = agents.filter((a) => a._count.toolCalls > 0);
  const unapprovedProfiles = profiles.filter((p) => !p.approved);

  return (
    <div className="space-y-6">
      <PageHeader
        title="MCP Tool Activity"
        description="Every MCP server agents declare and every tool the model invokes through the proxy, evaluated against each agent's allowlist. Attribute traffic with the x-agent-id header."
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard title="Tool calls (7d)" value={calls7d} iconName="Wrench" variant="default" />
        <StatCard
          title="Outside allowlist (7d)"
          value={unapproved7d}
          iconName="AlertTriangle"
          variant={unapproved7d > 0 ? "danger" : "success"}
        />
        <StatCard title="Distinct tools (7d)" value={distinctTools.length} iconName="Activity" variant="default" />
        <StatCard title="Agents active (7d)" value={activeAgents.length} iconName="Bot" variant="default" />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShieldAlert className="h-4 w-4 text-[var(--critical)]" />
              Needs a decision ({unapprovedProfiles.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            {unapprovedProfiles.length === 0 ? (
              <p className="text-sm text-[var(--text-muted)]">
                No tools invoked outside an allowlist. Tools from agents without an allowlist are recorded as allowed.
              </p>
            ) : (
              <div className="space-y-2">
                {unapprovedProfiles.slice(0, 20).map((p) => (
                  <Link
                    key={p.id}
                    href={p.agent ? `/agents/${p.agent.id}` : p.aiSystemId ? `/registry/${p.aiSystemId}` : "#"}
                    className="flex items-center justify-between rounded-md border border-[var(--critical-border)] bg-[var(--critical-dim)]/40 p-3 hover:brightness-110"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-mono text-xs text-[var(--text-primary)]">
                        {p.serverName ? `${p.serverName}/${p.toolName}` : p.toolName}
                      </p>
                      <p className="text-[11px] text-[var(--text-muted)]">
                        {p.agent?.name ?? (p.aiSystemId ? systemName.get(p.aiSystemId) : "Unattributed")} · {p.callCount} call
                        {p.callCount === 1 ? "" : "s"} · last {formatDateTime(p.lastSeenAt)}
                      </p>
                    </div>
                    <Badge variant="critical">Unapproved</Badge>
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Plug className="h-4 w-4 text-[var(--accent)]" />
              Agents
            </CardTitle>
          </CardHeader>
          <CardContent>
            {agents.length === 0 ? (
              <p className="text-sm text-[var(--text-muted)]">No agents registered.</p>
            ) : (
              <div className="space-y-2">
                {agents.map((a) => {
                  const configured = a.mcpServerAllowlist.length > 0 || a.mcpToolAllowlist.length > 0;
                  return (
                    <Link
                      key={a.id}
                      href={`/agents/${a.id}`}
                      className="flex items-center justify-between rounded-md border border-[var(--border-subtle)] p-3 hover:bg-[var(--bg-hover)]"
                    >
                      <div>
                        <p className="text-sm font-medium">{a.name}</p>
                        <p className="text-[11px] text-[var(--text-muted)]">
                          {a._count.toolCalls} call{a._count.toolCalls === 1 ? "" : "s"} (7d) ·{" "}
                          {configured
                            ? `${a.mcpServerAllowlist.length} server${a.mcpServerAllowlist.length === 1 ? "" : "s"}, ${a.mcpToolAllowlist.length} tool rule${a.mcpToolAllowlist.length === 1 ? "" : "s"}`
                            : "no allowlist"}
                        </p>
                      </div>
                      <Badge variant={a.mcpEnforcement === "enforce" ? "critical" : "info"}>
                        {a.mcpEnforcement === "enforce" ? "Enforce" : "Monitor"}
                      </Badge>
                    </Link>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recent tool calls</CardTitle>
        </CardHeader>
        <CardContent>
          {recentCalls.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)]">
              Nothing recorded yet. Tool calls appear once agent traffic flows through the proxy with the
              x-agent-id (or x-ai-system-id) header.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-[var(--border-subtle)]">
              <table className="w-full text-sm">
                <thead className="bg-[var(--bg-base)] text-left text-[10px] uppercase tracking-wider text-[var(--text-faint)]">
                  <tr>
                    <th className="px-3 py-2">Time</th>
                    <th className="px-3 py-2">Agent / system</th>
                    <th className="px-3 py-2">Tool</th>
                    <th className="px-3 py-2">Kind</th>
                    <th className="px-3 py-2">Model</th>
                    <th className="px-3 py-2">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border-subtle)]">
                  {recentCalls.map((c) => (
                    <tr key={c.id} className={!c.approved ? "bg-[var(--critical-dim)]/40" : undefined}>
                      <td className="whitespace-nowrap px-3 py-2 text-xs text-[var(--text-muted)]">{formatDateTime(c.createdAt)}</td>
                      <td className="px-3 py-2 text-xs">
                        {c.agent ? (
                          <Link href={`/agents/${c.agent.id}`} className="text-[var(--accent)] hover:underline">
                            {c.agent.name}
                          </Link>
                        ) : c.aiSystemId ? (
                          <Link href={`/registry/${c.aiSystemId}`} className="text-[var(--accent)] hover:underline">
                            {systemName.get(c.aiSystemId) ?? c.aiSystemId}
                          </Link>
                        ) : (
                          <span className="text-[var(--text-faint)]">Unattributed</span>
                        )}
                      </td>
                      <td className="px-3 py-2 font-mono text-xs">{c.serverName ? `${c.serverName}/${c.toolName}` : c.toolName}</td>
                      <td className="px-3 py-2 text-xs text-[var(--text-muted)]">{KIND_LABELS[c.kind] ?? c.kind}</td>
                      <td className="px-3 py-2 text-xs text-[var(--text-muted)]">
                        {c.provider}
                        {c.model ? ` · ${c.model}` : ""}
                      </td>
                      <td className="px-3 py-2">
                        {c.approved ? (
                          <span className="inline-flex items-center gap-1 text-xs text-[var(--success)]">
                            <ShieldCheck className="h-3.5 w-3.5" /> Allowed
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-xs text-[var(--critical)]">
                            <ShieldAlert className="h-3.5 w-3.5" /> Unapproved
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
