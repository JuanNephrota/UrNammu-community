import Link from "next/link";
import { Plug, ShieldCheck, ShieldAlert, ShieldX, Radar, Target } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { HelpHint } from "@/components/help/help-hint";
import { ApproveToolButton } from "@/components/agents/approve-tool-button";
import { ClassifyToolControl } from "@/components/agents/classify-tool-control";
import { formatDateTime } from "@/lib/utils";
import { scopeVerdictFor, type AgentScopeConfig } from "@/lib/agent-scope";

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

export type ScopeDenialRow = {
  id: string;
  createdAt: Date | string;
  provider: string;
  model: string | null;
  mode: string;
  matches: Array<{ trigger: string; tool: string; detail: string }>;
};

const ACCESS_CLASS: Record<string, string> = {
  read: "bg-[var(--success-dim)] text-[var(--success-strong)]",
  write: "bg-[var(--warning-dim)] text-[var(--warning-strong)]",
  admin: "bg-[var(--critical-dim)] text-[var(--critical-strong)]",
};

const SOURCE_LABEL: Record<string, string> = { rule: "rule", heuristic: "by name", default: "unclassified" };

export function McpGovernanceCard({
  agent,
  profiles,
  stats,
  scope,
  canClassify = false,
  recentScopeDenials = [],
}: {
  agent: {
    id: string;
    name: string;
    mcpServerAllowlist: string[];
    mcpToolAllowlist: string[];
    mcpEnforcement: string;
    scopeEnforcement: string;
    accessLevel: string;
    connectedSystems: string[];
    capabilities: string[];
    aiSystem: { id: string; name: string } | null;
    /** Servers allowed via the org catalog (not in the agent's own list). */
    inheritedServers?: string[];
  };
  profiles: ToolProfileRow[];
  stats: { calls30d: number; unapproved30d: number; lastCallAt: Date | string | null };
  /** Effective charter scope (access level, connected systems, classification rules). */
  scope: AgentScopeConfig;
  canClassify?: boolean;
  recentScopeDenials?: ScopeDenialRow[];
}) {
  const enforce = agent.mcpEnforcement === "enforce";
  const scopeEnforce = agent.scopeEnforcement === "enforce";
  const servers = profiles.filter((p) => p.kind === "mcp_server");
  const tools = profiles.filter((p) => p.kind !== "mcp_server");
  const unapprovedProfiles = tools.filter((p) => !p.approved);
  const inherited = agent.inheritedServers ?? [];
  const configured = agent.mcpServerAllowlist.length > 0 || agent.mcpToolAllowlist.length > 0 || inherited.length > 0;
  const verdicts = new Map(
    tools.map((p) => [p.id, scopeVerdictFor(scope, { serverName: p.serverName, toolName: p.toolName })])
  );
  const outOfScope = tools.filter((p) => (verdicts.get(p.id)?.violations.length ?? 0) > 0);
  const unclassified = tools.filter((p) => verdicts.get(p.id)?.classification.source === "default");

  const blastRadius = [
    { label: "Access level", value: `${agent.accessLevel} · ${scopeEnforce ? "enforced" : "monitored"}` },
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
            <Badge variant={enforce ? "critical" : "info"} title="MCP allowlist enforcement">
              Allowlist: {enforce ? "Enforce" : "Monitor"}
            </Badge>
            <Badge variant={scopeEnforce ? "critical" : "info"} title="Charter scope enforcement">
              Scope: {scopeEnforce ? "Enforce" : "Monitor"}
            </Badge>
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
            {agent.mcpServerAllowlist.length === 0 && inherited.length === 0 ? (
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
                {inherited.map((s) => (
                  <span
                    key={`catalog-${s}`}
                    title="Inherited from the org-approved MCP catalog"
                    className="rounded-full border border-dashed border-[var(--accent-border)] bg-[var(--accent-faint)] px-2.5 py-0.5 font-mono text-[11px] text-[var(--accent)]"
                  >
                    {s} · catalog
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
                    <th className="px-3 py-2">Access</th>
                    <th className="px-3 py-2">Scope</th>
                    <th className="px-3 py-2 text-right">Calls</th>
                    <th className="px-3 py-2">First seen</th>
                    <th className="px-3 py-2">Last seen</th>
                    <th className="px-3 py-2">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border-subtle)]">
                  {[...servers, ...tools].map((p) => {
                    const verdict = p.kind === "mcp_server" ? null : verdicts.get(p.id) ?? null;
                    return (
                    <tr key={p.id} className={!p.approved || (verdict?.violations.length ?? 0) > 0 ? "bg-[var(--critical-dim)]/40" : undefined}>
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
                      <td className="px-3 py-2">
                        {verdict ? (
                          <span className="inline-flex items-center gap-1.5">
                            <span
                              className={`rounded-full px-2 py-0.5 font-mono text-[11px] ${ACCESS_CLASS[verdict.classification.access] ?? ""}`}
                              title={
                                verdict.classification.source === "rule"
                                  ? `Org-wide rule ${verdict.classification.rule?.server}/${verdict.classification.rule?.tool}`
                                  : verdict.classification.source === "heuristic"
                                    ? "Classified from the tool name"
                                    : "Name not recognised; treated as write until classified"
                              }
                            >
                              {verdict.classification.access}
                            </span>
                            <span className="text-[10px] text-[var(--text-faint)]">
                              {SOURCE_LABEL[verdict.classification.source]}
                              {verdict.classification.system ? ` · ${verdict.classification.system}` : ""}
                            </span>
                            {canClassify && (
                              <ClassifyToolControl
                                serverKey={p.serverName ?? "-"}
                                toolName={p.toolName}
                                current={{
                                  access: verdict.classification.access,
                                  system: verdict.classification.system,
                                  source: verdict.classification.source,
                                }}
                              />
                            )}
                          </span>
                        ) : (
                          <span className="text-xs text-[var(--text-faint)]">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {verdict ? (
                          verdict.violations.length === 0 ? (
                            <span className="inline-flex items-center gap-1 text-xs text-[var(--success)]">
                              <Target className="h-3.5 w-3.5" /> In scope
                            </span>
                          ) : (
                            <span
                              className="inline-flex items-center gap-1 text-xs text-[var(--critical)]"
                              title={verdict.violations.map((v) => v.detail).join("; ")}
                            >
                              <ShieldX className="h-3.5 w-3.5" /> Out of scope
                            </span>
                          )
                        ) : (
                          <span className="text-xs text-[var(--text-faint)]">—</span>
                        )}
                      </td>
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
                    );
                  })}
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
          {outOfScope.length > 0 && (
            <p className="mt-2 text-xs text-[var(--critical)]">
              {outOfScope.length} observed tool{outOfScope.length === 1 ? " is" : "s are"} outside the charter scope (access level{" "}
              <span className="font-mono">{agent.accessLevel}</span>
              {agent.connectedSystems.length > 0 ? `, ${agent.connectedSystems.length} connected system${agent.connectedSystems.length === 1 ? "" : "s"}` : ""}).
              {scopeEnforce
                ? " In enforce mode the proxies withhold responses that call them; reclassify the tool or widen the charter if the call is legitimate."
                : " In monitor mode these calls are forwarded and alerted; switch scope enforcement to Enforce to withhold them."}
            </p>
          )}
          {unclassified.length > 0 && (
            <p className="mt-2 text-xs text-[var(--text-muted)]">
              {unclassified.length} tool{unclassified.length === 1 ? "" : "s"} could not be classified from the name and count as write
              {canClassify ? " — use the pencil to classify them for every agent." : "."}
            </p>
          )}
        </div>

        {/* Charter scope */}
        <div>
          <p className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-faint)]">
            <Target className="h-3 w-3" /> Charter scope
            <HelpHint hint="scope_enforcement" />
          </p>
          <p className="text-xs text-[var(--text-muted)]">
            Access level <span className="font-mono text-[var(--text-primary)]">{agent.accessLevel}</span>
            {agent.accessLevel === "restricted"
              ? " — only read tools on this agent's own tool allowlist."
              : agent.accessLevel === "read-only"
                ? " — read tools only."
                : agent.accessLevel === "read-write"
                  ? " — read and write tools; no admin tools."
                  : " — any tool."}{" "}
            {agent.connectedSystems.length > 0 ? (
              <>
                Connected systems:{" "}
                {agent.connectedSystems.map((sys) => (
                  <span key={sys} className="mr-1 rounded-full bg-[var(--bg-elevated)] px-2 py-0.5 font-mono text-[11px] text-[var(--text-primary)]">
                    {sys}
                  </span>
                ))}
                — tools classified to any other system are out of scope.
              </>
            ) : (
              "No connected systems documented, so system membership is not enforced."
            )}{" "}
            {scope.rules.length} org-wide classification rule{scope.rules.length === 1 ? "" : "s"} apply.
          </p>
          {recentScopeDenials.length > 0 && (
            <ul className="mt-2 space-y-1">
              {recentScopeDenials.map((d) => (
                <li key={d.id} className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-base)] px-3 py-2 text-xs">
                  <span className={d.mode === "enforced" ? "text-[var(--critical)]" : "text-[var(--warning)]"}>
                    {d.mode === "enforced" ? "Withheld" : "Observed"}
                  </span>
                  <span className="text-[var(--text-faint)]"> · {formatDateTime(d.createdAt)} · {d.provider}{d.model && d.model !== d.provider ? `/${d.model}` : ""}</span>
                  <span className="ml-2 text-[var(--text-primary)]">
                    {d.matches.map((m) => `${m.tool} (${m.detail})`).join("; ") || "out-of-scope call"}
                  </span>
                </li>
              ))}
            </ul>
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
