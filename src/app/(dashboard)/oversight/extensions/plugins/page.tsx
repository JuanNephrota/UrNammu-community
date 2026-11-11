import Link from "next/link";
import { PageHeader } from "@/components/layout/page-header";
import { StatCard } from "@/components/dashboard/stat-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PluginContentFetchButton } from "@/components/oversight/plugin-content-actions";
import { getSession } from "@/lib/auth-guard";
import {
  listInventoriedPlugins,
  listPluginContent,
  loadMarketplaceRepos,
  PLUGIN_STATUS_LABELS,
} from "@/lib/plugin-content";
import { formatDateTime } from "@/lib/utils";

export const dynamic = "force-dynamic";

const MANAGE_ROLES = ["ADMIN", "COMPLIANCE_OFFICER"];

export default async function PluginContentListPage() {
  const [rows, inventoried, repos, session] = await Promise.all([
    listPluginContent(),
    listInventoriedPlugins(),
    loadMarketplaceRepos(),
    getSession(),
  ]);
  const canManage = Boolean(session && MANAGE_ROLES.includes(session.user.role));

  const fetchedKeys = new Set(rows.map((r) => `${r.marketplace}\0${r.plugin}`));
  const notYetFetched = inventoried.filter((p) => !fetchedKeys.has(`${p.marketplace}\0${p.plugin}`));
  const unknownMarketplaces = [...new Set(inventoried.map((p) => p.marketplace).filter((m) => !repos[m]))];
  const needsReview = rows.filter((r) => r.needsReview).length;
  const failed = rows.filter((r) => r.status !== "fetched").length;
  const withHooks = rows.filter((r) => r.hookCount > 0).length;
  const withMcp = rows.filter((r) => r.mcpServerCount > 0).length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Plugin content"
        description="What each marketplace plugin seen on the fleet actually ships — its manifest, every skill, its hook and MCP server definitions, commands and agents — fetched from the marketplace's GitHub source at the pinned commit, so it can be read and signed off without touching a laptop."
      >
        <Link href="/oversight/extensions" className="text-sm text-[var(--accent)] hover:underline">
          &larr; Skills &amp; Plugins
        </Link>
        {canManage && <PluginContentFetchButton />}
      </PageHeader>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          title="Plugins fetched"
          value={rows.filter((r) => r.status === "fetched").length}
          description={`${inventoried.length} named plugin${inventoried.length === 1 ? "" : "s"} in the inventory · ${notYetFetched.length} not fetched yet`}
          iconName="Puzzle"
        />
        <StatCard
          title="Awaiting review"
          value={needsReview}
          description="fetched content nobody has signed off, or changed since"
          iconName="Eye"
          variant={needsReview > 0 ? "warning" : "default"}
        />
        <StatCard
          title="Ship hooks"
          value={withHooks}
          description={`${withMcp} ship MCP servers · both run on the developer's machine`}
          iconName="AlertTriangle"
          variant={withHooks > 0 ? "warning" : "default"}
        />
        <StatCard
          title="Could not fetch"
          value={failed}
          description="unsupported source, missing, or GitHub error"
          iconName="ShieldAlert"
          variant={failed > 0 ? "danger" : "default"}
        />
      </div>

      {unknownMarketplaces.length > 0 && (
        <Card className="border-[var(--warning-border)]">
          <CardHeader>
            <CardTitle>Marketplaces without a known repository</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-[var(--text-secondary)]">
            Plugins from {unknownMarketplaces.map((m) => <code key={m} className="mx-0.5 text-[var(--text-primary)]">{m}</code>)} cannot be
            fetched until the marketplace is mapped to a GitHub repository. Set the{" "}
            <code className="text-[var(--text-primary)]">extension_marketplaces</code> setting to a JSON object such as{" "}
            <code className="text-[var(--text-primary)]">{`{"${unknownMarketplaces[0]}": "owner/repo"}`}</code> (Settings API or the{" "}
            <code className="text-[var(--text-primary)]">EXTENSION_MARKETPLACES</code> environment variable). Private repositories also need{" "}
            <code className="text-[var(--text-primary)]">extension_marketplace_github_token</code>.
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Plugins</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {rows.length === 0 ? (
            <div className="px-4 py-8 text-sm text-[var(--text-secondary)]">
              Nothing fetched yet.{" "}
              {inventoried.length > 0
                ? `The inventory names ${inventoried.length} plugin${inventoried.length === 1 ? "" : "s"}; use Fetch plugin content to read them from their marketplaces.`
                : "Plugins appear here once the inventory has seen them by name (placeholder rows cannot be fetched)."}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--border-subtle)] text-left text-[var(--text-muted)]">
                    <th className="px-4 py-2 font-medium">Plugin</th>
                    <th className="px-4 py-2 font-medium">Source</th>
                    <th className="px-4 py-2 font-medium">Ships</th>
                    <th className="px-4 py-2 font-medium">Status</th>
                    <th className="px-4 py-2 font-medium">Review</th>
                    <th className="px-4 py-2 font-medium">Fetched</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} className="border-b border-[var(--border-subtle)] last:border-0">
                      <td className="px-4 py-2">
                        <Link href={`/oversight/extensions/plugins/${r.id}`} className="text-[var(--accent)] hover:underline">
                          {r.plugin}
                        </Link>
                        <div className="text-xs text-[var(--text-muted)]">
                          {r.marketplace}
                          {r.version ? ` · v${r.version}` : ""}
                        </div>
                      </td>
                      <td className="px-4 py-2 text-[var(--text-secondary)]">
                        {r.repo ? (
                          <a
                            href={`https://github.com/${r.repo}${r.commitSha ? `/tree/${r.commitSha}` : ""}`}
                            target="_blank"
                            rel="noreferrer"
                            className="hover:underline"
                          >
                            {r.repo}
                          </a>
                        ) : (
                          "—"
                        )}
                        {r.commitSha && <div className="font-mono text-xs text-[var(--text-muted)]">{r.commitSha.slice(0, 10)}</div>}
                      </td>
                      <td className="px-4 py-2">
                        <div className="flex flex-wrap gap-1">
                          {r.skillCount > 0 && <Badge variant="low">{r.skillCount} skill{r.skillCount === 1 ? "" : "s"}</Badge>}
                          {r.hookCount > 0 && <Badge variant="medium">{r.hookCount} hook{r.hookCount === 1 ? "" : "s"}</Badge>}
                          {r.mcpServerCount > 0 && <Badge variant="high">{r.mcpServerCount} MCP</Badge>}
                          {r.commandCount > 0 && <Badge variant="outline">{r.commandCount} cmd</Badge>}
                          {r.agentCount > 0 && <Badge variant="outline">{r.agentCount} agent{r.agentCount === 1 ? "" : "s"}</Badge>}
                          {r.status === "fetched" && !r.skillCount && !r.hookCount && !r.mcpServerCount && !r.commandCount && !r.agentCount && (
                            <span className="text-xs text-[var(--text-muted)]">nothing recognised</span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-2">
                        <Badge variant={r.status === "fetched" ? "success" : r.status === "error" ? "critical" : "warning"}>
                          {PLUGIN_STATUS_LABELS[r.status]}
                        </Badge>
                        {r.statusReason && (
                          <div className="max-w-xs truncate text-xs text-[var(--text-muted)]" title={r.statusReason}>
                            {r.statusReason}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-2">
                        {r.status !== "fetched" ? (
                          <span className="text-[var(--text-muted)]">—</span>
                        ) : r.needsReview ? (
                          <Badge variant="warning">{r.reviewedAt ? "changed since review" : "unreviewed"}</Badge>
                        ) : (
                          <Badge variant="success">reviewed</Badge>
                        )}
                        {r.reviewedAt && (
                          <div className="text-xs text-[var(--text-muted)]">
                            {r.reviewedBy} · {formatDateTime(r.reviewedAt)}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-2 text-[var(--text-muted)]">
                        {formatDateTime(r.fetchedAt)}
                        {r.changedAt && <div className="text-xs">changed {formatDateTime(r.changedAt)}</div>}
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
