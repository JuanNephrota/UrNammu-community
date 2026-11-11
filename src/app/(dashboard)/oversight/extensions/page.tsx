import Link from "next/link";
import { PageHeader } from "@/components/layout/page-header";
import { StatCard } from "@/components/dashboard/stat-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ExtensionsBackfillButton } from "@/components/oversight/extensions-backfill-button";
import { getSession } from "@/lib/auth-guard";
import {
  EXTENSION_CLIENT_LABELS,
  EXTENSION_CLIENTS,
  EXTENSION_KIND_LABELS,
  EXTENSION_KINDS,
  extensionEnabledViaLabel,
  extensionSourceLabel,
  isThirdPartyPlugin,
  loadAssistantExtensionInventory,
  type ExtensionClient,
  type ExtensionInventoryRow,
  type ExtensionKind,
} from "@/lib/assistant-extensions";
import { formatDateTime } from "@/lib/utils";

export const dynamic = "force-dynamic";

function kindBadgeVariant(kind: ExtensionKind): "info" | "high" | "medium" | "low" | "outline" {
  switch (kind) {
    case "mcp_server":
      return "high";
    case "hook":
      return "medium";
    case "plugin":
      return "info";
    case "skill":
      return "low";
    default:
      return "outline";
  }
}

function describe(row: ExtensionInventoryRow): string[] {
  const bits: string[] = [];
  const d = row.detail;
  if (row.kind === "plugin") {
    if (row.marketplace) bits.push(row.marketplace);
    if (row.version) bits.push(`v${row.version}`);
    if (d.hasMcp === true) bits.push("bundles MCP");
    if (d.hasHooks === true) bits.push("bundles hooks");
    if (typeof d.skillPaths === "number" && d.skillPaths > 0) bits.push(`${d.skillPaths} skill dir${d.skillPaths === 1 ? "" : "s"}`);
  } else if (row.kind === "mcp_server") {
    if (row.transport) bits.push(row.transport);
    if (row.pluginName) bits.push(`via ${row.pluginName}`);
    if (Array.isArray(d.tools) && d.tools.length) bits.push(`${d.tools.length} tool${d.tools.length === 1 ? "" : "s"} used`);
    if (typeof d.lastErrorCode === "string") bits.push(d.lastErrorCode);
  } else if (row.kind === "skill") {
    if (row.pluginName) bits.push(`from ${row.pluginName}`);
    if (typeof d.lastTrigger === "string") bits.push(d.lastTrigger);
    if (d.workflow === true) bits.push("workflow");
  } else if (row.kind === "hook") {
    if (typeof d.matcher === "string") bits.push(`matches ${d.matcher}`);
    if (row.pluginName) bits.push(`from ${row.pluginName}`);
  } else if (row.kind === "agent") {
    if (d.builtIn === true) bits.push("built in");
    if (row.pluginName) bits.push(`from ${row.pluginName}`);
  }
  return bits;
}

export default async function ExtensionsPage({
  searchParams,
}: {
  searchParams: Promise<{ client?: string; kind?: string; q?: string; redacted?: string }>;
}) {
  const params = await searchParams;
  const client = EXTENSION_CLIENTS.includes(params.client as ExtensionClient) ? (params.client as ExtensionClient) : null;
  const kind = EXTENSION_KINDS.includes(params.kind as ExtensionKind) ? (params.kind as ExtensionKind) : null;
  const q = params.q?.trim() || null;
  const redactedOnly = params.redacted === "1";

  const [{ summary, rows }, session] = await Promise.all([
    loadAssistantExtensionInventory({ client, kind, q, redactedOnly }),
    getSession(),
  ]);
  const isAdmin = session?.user.role === "ADMIN";
  const empty = summary.rows === 0;
  const filtered = Boolean(client || kind || q || redactedOnly);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Skills & Plugins"
        description="What each person's coding assistant has loaded — plugins, MCP servers, skills, hooks and subagents — as reported by Claude Code and Cursor telemetry. Names and provenance only; no arguments, prompts or paths."
      >
        {isAdmin && <ExtensionsBackfillButton hasRows={!empty} />}
      </PageHeader>

      {empty ? (
        <Card>
          <CardHeader>
            <CardTitle>Nothing inventoried yet</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-[var(--text-secondary)]">
            <p>
              Claude Code announces its plugins, hooks, MCP servers, skills and subagents through the same OTel
              stream that feeds the{" "}
              <Link href="/oversight/claude-code" className="text-[var(--accent)] hover:underline">
                Claude Code
              </Link>{" "}
              page, and Cursor names the MCP server on each tool call. Rows appear here as those events arrive.
            </p>
            <p>
              Already collecting telemetry? Use <strong>Rebuild from history</strong> to walk the stored events
              once. To see real names rather than <em>third-party</em> and <em>custom_skill</em> placeholders,
              set <code className="text-[var(--text-primary)]">OTEL_LOG_TOOL_DETAILS=1</code> in Claude Code&rsquo;s
              managed settings — the collector strips the tool arguments that flag also unlocks, so only names
              reach this database.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              title="People covered"
              value={summary.people}
              description={`${summary.byClient.claude_code} Claude Code · ${summary.byClient.cursor} Cursor rows${summary.untagged ? ` · ${summary.untagged} untagged` : ""}`}
              iconName="Users"
            />
            <StatCard
              title="MCP servers"
              value={summary.byKind.mcp_server}
              description={
                summary.failingServers > 0
                  ? `${summary.failingServers} last failed to connect`
                  : "person × server combinations"
              }
              iconName="Plug"
              variant={summary.failingServers > 0 ? "warning" : "default"}
            />
            <StatCard
              title="Third-party plugins"
              value={summary.thirdPartyPlugins}
              description={`of ${summary.byKind.plugin} plugin rows · outside Anthropic's catalog`}
              iconName="Puzzle"
              variant={summary.thirdPartyPlugins > 0 ? "warning" : "default"}
            />
            <StatCard
              title="Hooks from repos"
              value={summary.hooksFromProjects}
              description={`of ${summary.byKind.hook} hook rows · defined in project or local settings`}
              iconName="AlertTriangle"
              variant={summary.hooksFromProjects > 0 ? "danger" : "default"}
            />
          </div>

          {summary.redacted > 0 && (
            <Card className="border-[var(--warning-border)]">
              <CardHeader>
                <CardTitle>{summary.redacted} rows carry placeholder names</CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-[var(--text-secondary)]">
                Claude Code reports third-party plugins as <em>third-party</em>, user skills as{" "}
                <em>custom_skill</em>, custom agents as <em>custom</em>, and omits MCP server names unless{" "}
                <code className="text-[var(--text-primary)]">OTEL_LOG_TOOL_DETAILS=1</code> is set in managed
                settings. Each placeholder row still counts one real thing (plugins keep a stable id hash), but
                you cannot tell which. The collector already strips the arguments that flag unlocks, so turning
                it on adds names and nothing else.{" "}
                <Link href="?redacted=1" className="text-[var(--accent)] hover:underline">
                  Show only placeholder rows
                </Link>
                .
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle>Inventory</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <form method="get" className="flex flex-wrap items-end gap-3 text-sm">
                <label className="flex flex-col gap-1 text-xs text-[var(--text-muted)]">
                  Client
                  <select
                    name="client"
                    defaultValue={client ?? ""}
                    className="h-8 rounded-md border border-[var(--border-default)] bg-[var(--bg-surface)] px-2 text-sm text-[var(--text-primary)]"
                  >
                    <option value="">All</option>
                    {EXTENSION_CLIENTS.map((c) => (
                      <option key={c} value={c}>
                        {EXTENSION_CLIENT_LABELS[c]}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1 text-xs text-[var(--text-muted)]">
                  Kind
                  <select
                    name="kind"
                    defaultValue={kind ?? ""}
                    className="h-8 rounded-md border border-[var(--border-default)] bg-[var(--bg-surface)] px-2 text-sm text-[var(--text-primary)]"
                  >
                    <option value="">All</option>
                    {EXTENSION_KINDS.map((k) => (
                      <option key={k} value={k}>
                        {EXTENSION_KIND_LABELS[k]} ({summary.byKind[k]})
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1 text-xs text-[var(--text-muted)]">
                  Person, name, plugin or marketplace
                  <input
                    name="q"
                    defaultValue={q ?? ""}
                    placeholder="Search…"
                    className="h-8 w-64 rounded-md border border-[var(--border-default)] bg-[var(--bg-surface)] px-2 text-sm text-[var(--text-primary)]"
                  />
                </label>
                <label className="flex items-center gap-2 pb-1.5 text-xs text-[var(--text-muted)]">
                  <input type="checkbox" name="redacted" value="1" defaultChecked={redactedOnly} />
                  Placeholder names only
                </label>
                <button
                  type="submit"
                  className="h-8 rounded-md border border-[var(--border-default)] px-3 text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
                >
                  Filter
                </button>
                {filtered && (
                  <Link href="/oversight/extensions" className="pb-1.5 text-xs text-[var(--accent)] hover:underline">
                    Clear
                  </Link>
                )}
              </form>

              <div className="overflow-x-auto rounded-md border border-[var(--border-subtle)]">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[var(--border-subtle)] text-left text-[var(--text-muted)]">
                      <th className="px-4 py-2 font-medium">Person</th>
                      <th className="px-4 py-2 font-medium">Client</th>
                      <th className="px-4 py-2 font-medium">Kind</th>
                      <th className="px-4 py-2 font-medium">Name</th>
                      <th className="px-4 py-2 font-medium">Provenance</th>
                      <th className="px-4 py-2 font-medium">Status</th>
                      <th className="px-4 py-2 font-medium">Sessions</th>
                      <th className="px-4 py-2 font-medium">Last seen</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.length === 0 && (
                      <tr>
                        <td colSpan={8} className="px-4 py-6 text-center text-[var(--text-muted)]">
                          No rows match these filters.
                        </td>
                      </tr>
                    )}
                    {rows.map((row) => {
                      const bits = describe(row);
                      const thirdParty = isThirdPartyPlugin(row);
                      const enabledVia = extensionEnabledViaLabel(row.enabledVia);
                      return (
                        <tr key={row.id} className="border-b border-[var(--border-subtle)] last:border-0">
                          <td className="px-4 py-2 text-[var(--text-primary)]">
                            {row.userEmail || <span className="text-[var(--text-muted)]">untagged</span>}
                          </td>
                          <td className="px-4 py-2 text-[var(--text-secondary)]">
                            {EXTENSION_CLIENT_LABELS[row.client]}
                            {row.lastAppVersion && (
                              <div className="text-xs text-[var(--text-muted)]">{row.lastAppVersion}</div>
                            )}
                          </td>
                          <td className="px-4 py-2">
                            <Badge variant={kindBadgeVariant(row.kind)}>{EXTENSION_KIND_LABELS[row.kind]}</Badge>
                          </td>
                          <td className="px-4 py-2">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className={row.redacted ? "italic text-[var(--text-muted)]" : "text-[var(--text-primary)]"}>
                                {row.name}
                              </span>
                              {row.redacted && <Badge variant="outline">placeholder</Badge>}
                              {thirdParty && <Badge variant="warning">third-party</Badge>}
                            </div>
                            {bits.length > 0 && (
                              <div className="text-xs text-[var(--text-muted)]">{bits.join(" · ")}</div>
                            )}
                          </td>
                          <td className="px-4 py-2 text-[var(--text-secondary)]">
                            {extensionSourceLabel(row.source)}
                            {enabledVia && <div className="text-xs text-[var(--text-muted)]">{enabledVia}</div>}
                          </td>
                          <td className="px-4 py-2">
                            {row.kind === "mcp_server" ? (
                              <Badge
                                variant={
                                  row.lastStatus === "failed"
                                    ? "critical"
                                    : row.lastStatus === "connected"
                                      ? "success"
                                      : "outline"
                                }
                              >
                                {row.lastStatus ?? "seen"}
                              </Badge>
                            ) : (
                              <span className="text-[var(--text-muted)]">—</span>
                            )}
                            {row.failures > 0 && (
                              <div className="text-xs text-[var(--text-muted)]">
                                {row.failures} failure{row.failures === 1 ? "" : "s"}
                              </div>
                            )}
                          </td>
                          <td className="px-4 py-2 text-[var(--text-secondary)]">
                            {row.sessions.toLocaleString()}
                            <div className="text-xs text-[var(--text-muted)]">
                              {row.observations.toLocaleString()} event{row.observations === 1 ? "" : "s"}
                            </div>
                          </td>
                          <td className="px-4 py-2 text-[var(--text-muted)]">
                            {formatDateTime(row.lastSeenAt)}
                            <div className="text-xs">first {formatDateTime(row.firstSeenAt)}</div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {rows.length >= 500 && (
                <p className="text-xs text-[var(--text-muted)]">
                  Showing the 500 most recently seen rows. Narrow the filters, or pull the full set from{" "}
                  <code className="text-[var(--text-primary)]">/api/assistant-extensions?limit=2000</code>.
                </p>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
