import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PluginContentFetchButton, PluginContentReviewButton } from "@/components/oversight/plugin-content-actions";
import { getSession } from "@/lib/auth-guard";
import {
  getPluginContent,
  PLUGIN_FILE_KIND_LABELS,
  PLUGIN_STATUS_LABELS,
  type PluginFileKind,
} from "@/lib/plugin-content";
import { formatDateTime } from "@/lib/utils";

export const dynamic = "force-dynamic";

const MANAGE_ROLES = ["ADMIN", "COMPLIANCE_OFFICER"];
const KIND_ORDER: PluginFileKind[] = ["manifest", "hook", "mcp", "skill", "agent", "command", "readme", "other"];

function kindVariant(kind: PluginFileKind): "high" | "medium" | "low" | "info" | "outline" {
  switch (kind) {
    case "mcp":
      return "high";
    case "hook":
      return "medium";
    case "skill":
      return "low";
    case "manifest":
      return "info";
    default:
      return "outline";
  }
}

export default async function PluginContentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [content, session] = await Promise.all([getPluginContent(id), getSession()]);
  if (!content) notFound();
  const canManage = Boolean(session && MANAGE_ROLES.includes(session.user.role));

  const manifest = content.manifest ?? {};
  const description = typeof manifest.description === "string" ? manifest.description : null;
  const author =
    manifest.author && typeof manifest.author === "object"
      ? String((manifest.author as Record<string, unknown>).name ?? "")
      : typeof manifest.author === "string"
        ? manifest.author
        : null;
  const homepage = typeof manifest.homepage === "string" ? manifest.homepage : null;
  const license = typeof manifest.license === "string" ? manifest.license : null;

  const groups = KIND_ORDER.map((kind) => ({ kind, files: content.files.filter((f) => f.kind === kind) })).filter((g) => g.files.length);
  const sourceUrl = content.repo
    ? `https://github.com/${content.repo}${content.commitSha ? `/tree/${content.commitSha}` : ""}${content.path ? `/${content.path}` : ""}`
    : null;

  return (
    <div className="space-y-6">
      <PageHeader
        title={content.plugin}
        description={description ?? `Plugin from the ${content.marketplace} marketplace.`}
      >
        <Link href="/oversight/extensions/plugins" className="text-sm text-[var(--accent)] hover:underline">
          &larr; Plugin content
        </Link>
        {canManage && (
          <PluginContentFetchButton
            plugins={[{ marketplace: content.marketplace, plugin: content.plugin }]}
            force
            label="Re-fetch"
          />
        )}
        {canManage && content.status === "fetched" && <PluginContentReviewButton id={content.id} needsReview={content.needsReview} />}
      </PageHeader>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Source</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm text-[var(--text-secondary)]">
            <div>
              <span className="text-[var(--text-muted)]">Marketplace</span> {content.marketplace}
            </div>
            <div>
              <span className="text-[var(--text-muted)]">Version</span> {content.version ?? "—"}
            </div>
            <div>
              <span className="text-[var(--text-muted)]">Repository</span>{" "}
              {sourceUrl ? (
                <a href={sourceUrl} target="_blank" rel="noreferrer" className="text-[var(--accent)] hover:underline">
                  {content.repo}
                  {content.path ? `/${content.path}` : ""}
                </a>
              ) : (
                "—"
              )}
            </div>
            <div>
              <span className="text-[var(--text-muted)]">Commit</span>{" "}
              <span className="font-mono text-xs">{content.commitSha ?? "—"}</span>
              {content.ref && content.ref !== content.commitSha && (
                <span className="text-xs text-[var(--text-muted)]"> (ref {content.ref})</span>
              )}
            </div>
            {author && (
              <div>
                <span className="text-[var(--text-muted)]">Author</span> {author}
              </div>
            )}
            {license && (
              <div>
                <span className="text-[var(--text-muted)]">License</span> {license}
              </div>
            )}
            {homepage && (
              <div>
                <span className="text-[var(--text-muted)]">Homepage</span>{" "}
                <a href={homepage} target="_blank" rel="noreferrer" className="text-[var(--accent)] hover:underline">
                  {homepage}
                </a>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Fetch</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-[var(--text-secondary)]">
            <Badge variant={content.status === "fetched" ? "success" : content.status === "error" ? "critical" : "warning"}>
              {PLUGIN_STATUS_LABELS[content.status]}
            </Badge>
            {content.statusReason && <p className="text-xs text-[var(--text-muted)]">{content.statusReason}</p>}
            <div>
              <span className="text-[var(--text-muted)]">Fetched</span> {formatDateTime(content.fetchedAt)}
            </div>
            {content.changedAt && (
              <div>
                <span className="text-[var(--text-muted)]">Content last changed</span> {formatDateTime(content.changedAt)}
              </div>
            )}
            <div className="flex flex-wrap gap-1 pt-1">
              <Badge variant="low">{content.skillCount} skill{content.skillCount === 1 ? "" : "s"}</Badge>
              <Badge variant={content.hookCount > 0 ? "medium" : "outline"}>{content.hookCount} hook{content.hookCount === 1 ? "" : "s"}</Badge>
              <Badge variant={content.mcpServerCount > 0 ? "high" : "outline"}>{content.mcpServerCount} MCP server{content.mcpServerCount === 1 ? "" : "s"}</Badge>
              <Badge variant="outline">{content.commandCount} command{content.commandCount === 1 ? "" : "s"}</Badge>
              <Badge variant="outline">{content.agentCount} agent{content.agentCount === 1 ? "" : "s"}</Badge>
            </div>
          </CardContent>
        </Card>

        <Card className={content.needsReview && content.status === "fetched" ? "border-[var(--warning-border)]" : undefined}>
          <CardHeader>
            <CardTitle>Review</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-[var(--text-secondary)]">
            {content.status !== "fetched" ? (
              <p className="text-[var(--text-muted)]">Nothing to review until the content is fetched.</p>
            ) : content.needsReview ? (
              <p>
                {content.reviewedAt
                  ? "The content has changed since it was last reviewed. Read the files below, then mark them reviewed."
                  : "Nobody has signed off this plugin's content yet. Hooks and MCP servers run on the developer's machine; skills and agents shape what Claude does."}
              </p>
            ) : (
              <p>Current content is signed off.</p>
            )}
            {content.reviewedAt && (
              <div className="text-xs text-[var(--text-muted)]">
                Last reviewed by {content.reviewedBy} on {formatDateTime(content.reviewedAt)}
                {content.reviewNote && <div className="mt-1 italic">&ldquo;{content.reviewNote}&rdquo;</div>}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {groups.length === 0 && content.status === "fetched" && (
        <Card>
          <CardContent className="py-6 text-sm text-[var(--text-secondary)]">
            The fetch found no manifest, skills, hooks, MCP servers, commands or agents under the plugin&rsquo;s path.
          </CardContent>
        </Card>
      )}

      {groups.map((group) => (
        <Card key={group.kind}>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Badge variant={kindVariant(group.kind)}>{PLUGIN_FILE_KIND_LABELS[group.kind]}</Badge>
              <span className="text-sm font-normal text-[var(--text-muted)]">
                {group.files.length} file{group.files.length === 1 ? "" : "s"}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {group.files.map((file) => (
              <details key={file.id} open={group.kind === "hook" || group.kind === "mcp" || group.files.length === 1} className="group">
                <summary className="flex cursor-pointer flex-wrap items-center gap-2 text-sm">
                  <span className="text-[var(--text-primary)]">{file.name ?? file.path}</span>
                  {file.name && <span className="font-mono text-xs text-[var(--text-muted)]">{file.path}</span>}
                  <span className="text-xs text-[var(--text-muted)]">{(file.size / 1024).toFixed(1)} KB</span>
                  {file.truncated && <Badge variant="warning">truncated</Badge>}
                  {file.text === null && <Badge variant="outline">binary or unreadable</Badge>}
                </summary>
                {file.text !== null && (
                  <pre className="mt-2 max-h-[32rem] overflow-auto whitespace-pre-wrap rounded-md border border-[var(--border-subtle)] bg-[var(--bg-deep)] p-3 font-mono text-xs leading-relaxed text-[var(--text-secondary)]">
                    {file.text}
                  </pre>
                )}
              </details>
            ))}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
