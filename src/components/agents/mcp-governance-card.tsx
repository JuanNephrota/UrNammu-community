import Link from "next/link";
import { Plug, ShieldCheck, ShieldAlert, Radar } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { HelpHint } from "@/components/help/help-hint";
import { ApproveToolButton } from "@/components/agents/approve-tool-button";
import { formatDateTime } from "@/lib/utils";

export type ToolProfileRow = {
  id: string;
  serverKey: string;
  serverName: string | null;
  serverHost: string | null;
  toolName: string;
  kind: string;
  approved: boolean;
  callCount: number;
  firstSeenAt: Date | string;
  lastSeenAt: Date | string;
};

export function McpGovernanceCard({
  agent,
  profiles,
  stats,
}: {
  agent: {
    id: string;
    name: string;
    mcpServerAllowlist: string[];
    mcpToolAllowlist: string[];
    mcpEnforcement: string;
    accessLevel: string;
    connectedSystems: string[];
    capabilities: string[];
    aiSystem: { id: string; name: string } | null;
  };
  profiles: ToolProfileRow[];
  stats: { calls30d: number; unapproved30d: number; lastCallAt: Date | string | null };
}) {
  const enforce = agent.mcpEnforcement === "enforce";
  const servers = profiles.filter((p) => p.kind === "mcp_server");
  const tools = profiles.filter((p) => p.kind !== "mcp_server");
  const unapprovedProfiles = tools.filter((p) => !p.approved);
  const configured = agent.mcpServerAllowlist.length > 0 || agent.mcpToolAllowlist.length > 0;

  const blastRadius = [
    { label: "Access level", value: agent.accessLevel },
    { label: "Parent system", value: agent.aiSystem?.name ?? "—" },
    { label: "Connected systems", value: String(agent.connectedSystems.length) },
    { label: "Capabilities", value: String(agent.capabilities.length) },
    { label: "MCP servers seen", value: String(servers.length) },
    { label: "Tools seen", value: String(tools.length) },
  ];

  return (
    <Card className="lg:col-span-2">
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center justify-between gap-2">
          <span className="flex items-center gap-2">
            <Plug className="h-4 w-4 text-[var(--accent)]" />
            MCP Tool Governance
            <HelpHint hint="mcp_governance" />
          </span>
          <span className="flex items-center gap-2">
            <Badge variant={enforce ? "critical" : "info"}>{enforce ? "Enforce" : "Monitor"}</Badge>
            {!configured && <Badge variant="outline">No allowlist</Badge>}
            <Link href={`/agents/${agent.id}/edit`}>
              <Button size="sm" variant="outline">
                Edit allowlist
              </Button>
            </Link>
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Blast radius strip */}
        <div>
          <p className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-faint)]">
            <Radar className="h-3 w-3" /> Blast radius
          </p>
          <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
            {blastRadius.map((item) => (
              <div key={item.label} className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-base)] px-3 py-2">
                <p className="text-[10px] uppercase tracking-wider text-[var(--text-faint)]">{item.label}</p>
                <p className="truncate text-sm font-semibold text-[var(--text-primary)]" title={item.value}>
                  {item.value}
                </p>
              </div>
            ))}
          </div>
          <p className="mt-2 text-xs text-[var(--text-muted)]">
            {stats.calls30d} tool call{stats.calls30d === 1 ? "" : "s"} in the last 30 days
            {stats.unapproved30d > 0 ? (
              <span className="text-[var(--critical)]"> · {stats.unapproved30d} outside the allowlist</span>
            ) : null}
            {stats.lastCallAt ? ` · last ${formatDateTime(stats.lastCallAt)}` : ""}
          </p>
        </div>

        {/* Allowlist */}
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-faint)]">
              Allowed MCP servers
            </p>
            {agent.mcpServerAllowlist.length === 0 ? (
              <p className="text-xs text-[var(--text-muted)]">
                Not configured — every declared server is accepted and recorded.
              </p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {agent.mcpServerAllowlist.map((s) => (
                  <span key={s} className="rounded-full bg-[var(--success-dim)] px-2.5 py-0.5 font-mono text-[11px] text-[var(--success-strong)]">
                    {s}
                  </span>
                ))}
              </div>
            )}
          </div>
          <div>
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-faint)]">
              Allowed MCP tools
            </p>
            {agent.mcpToolAllowlist.length === 0 ? (
              <p className="text-xs text-[var(--text-muted)]">
                Not configured — any tool on an allowed server is accepted.
              </p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {agent.mcpToolAllowlist.map((t) => (
                  <span key={t} className="rounded-full bg-[var(--success-dim)] px-2.5 py-0.5 font-mono text-[11px] text-[var(--success-strong)]">
                    {t}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Observed activity */}
        <div>
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-faint)]">
            Observed servers and tools
          </p>
          {profiles.length === 0 ? (
            <div className="rounded-lg border border-dashed border-[var(--border-subtle)] p-4 text-xs text-[var(--text-muted)]">
              No tool activity attributed to this agent yet. Send the proxy header{" "}
              <code className="rounded bg-[var(--bg-elevated)] px-1.5 py-0.5 text-[var(--accent)]">
                x-agent-id: {agent.id}
              </code>{" "}
              on the agent&apos;s model calls and every MCP server it declares and every tool the model invokes
              will appear here.
            </div>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-[var(--border-subtle)]">
              <table className="w-full text-sm">
                <thead className="bg-[var(--bg-base)] text-left text-[10px] uppercase tracking-wider text-[var(--text-faint)]">
                  <tr>
                    <th className="px-3 py-2">Server / tool</th>
                    <th className="px-3 py-2">Kind</th>
                    <th className="px-3 py-2 text-right">Calls</th>
                    <th className="px-3 py-2">First seen</th>
                    <th className="px-3 py-2">Last seen</th>
                    <th className="px-3 py-2">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border-subtle)]">
                  {[...servers, ...tools].map((p) => (
                    <tr key={p.id} className={!p.approved ? "bg-[var(--critical-dim)]/40" : undefined}>
                      <td className="px-3 py-2">
                        <span className="font-mono text-xs text-[var(--text-primary)]">
                          {p.kind === "mcp_server"
                            ? p.serverKey
                            : p.serverName
                              ? `${p.serverName}/${p.toolName}`
                              : p.toolName}
                        </span>
                        {p.serverHost && p.kind === "mcp_server" && (
                          <span className="ml-2 text-[11px] text-[var(--text-faint)]">{p.serverHost}</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-xs text-[var(--text-muted)]">{KIND_LABELS[p.kind] ?? p.kind}</td>
                      <td className="px-3 py-2 text-right font-mono text-xs">{p.callCount}</td>
                      <td className="px-3 py-2 text-xs text-[var(--text-muted)]">{formatDateTime(p.firstSeenAt)}</td>
                      <td className="px-3 py-2 text-xs text-[var(--text-muted)]">{formatDateTime(p.lastSeenAt)}</td>
                      <td className="px-3 py-2">
                        {p.approved ? (
                          <span className="inline-flex items-center gap-1 text-xs text-[var(--success)]">
                            <ShieldCheck className="h-3.5 w-3.5" /> Allowed
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-2">
                            <span className="inline-flex items-center gap-1 text-xs text-[var(--critical)]">
                              <ShieldAlert className="h-3.5 w-3.5" /> Unapproved
                            </span>
                            <ApproveToolButton
                              agentId={agent.id}
                              serverName={p.kind === "mcp_server" ? p.serverKey : p.serverName}
                              toolName={p.kind === "mcp_server" ? null : p.toolName}
                            />
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {unapprovedProfiles.length > 0 && (
            <p className="mt-2 text-xs text-[var(--critical)]">
              {unapprovedProfiles.length} tool{unapprovedProfiles.length === 1 ? "" : "s"} invoked outside the allowlist.
              {enforce
                ? " In enforce mode the provider is told to hide unlisted tools, so these calls indicate a gap in allowed_tools narrowing or a server without specific tool entries."
                : " Approve them here or switch the agent to enforce mode to have the proxy narrow allowed_tools."}
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

const KIND_LABELS: Record<string, string> = {
  mcp_server: "MCP server",
  mcp_tool_use: "MCP tool",
  server_tool_use: "Provider tool",
  tool_use: "Client tool",
};
