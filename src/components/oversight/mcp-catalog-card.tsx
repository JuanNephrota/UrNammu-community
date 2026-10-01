"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { BookCheck, Loader2, Plus, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { HelpHint } from "@/components/help/help-hint";
import { formatDateTime } from "@/lib/utils";

export type McpCatalogRow = {
  id: string;
  server: string;
  tools: string[];
  label: string | null;
  notes: string | null;
  createdAt: Date | string;
  approvedBy: { name: string | null; email: string } | null;
};

/**
 * The org-wide approved MCP catalog. Agents that inherit it get every server
 * here on their allowlist; tool lists narrow only agents that keep their own
 * tool allowlist.
 */
export function McpCatalogCard({
  entries,
  inheritingAgents,
  canEdit,
}: {
  entries: McpCatalogRow[];
  inheritingAgents: number;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [server, setServer] = useState("");
  const [tools, setTools] = useState("");
  const [label, setLabel] = useState("");
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function add() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/mcp-catalog", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          server: server.trim(),
          tools: tools.split(",").map((t) => t.trim()).filter(Boolean),
          label: label.trim() || undefined,
        }),
      });
      const payload = await res.json().catch(() => null);
      if (!res.ok) throw new Error(payload?.error ?? "Failed to add to the catalog.");
      setServer("");
      setTools("");
      setLabel("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add to the catalog.");
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    setRemoving(id);
    setError(null);
    try {
      const res = await fetch(`/api/mcp-catalog/${id}`, { method: "DELETE" });
      const payload = await res.json().catch(() => null);
      if (!res.ok) throw new Error(payload?.error ?? "Failed to withdraw.");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to withdraw.");
    } finally {
      setRemoving(null);
    }
  }

  return (
    <Card id="catalog" className="scroll-mt-6">
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center justify-between gap-2">
          <span className="flex items-center gap-2">
            <BookCheck className="h-4 w-4 text-[var(--accent)]" />
            Approved MCP catalog
            <HelpHint hint="mcp_catalog" />
          </span>
          <Badge variant="outline">
            {entries.length} server{entries.length === 1 ? "" : "s"} · {inheritingAgents} agent{inheritingAgents === 1 ? "" : "s"} inheriting
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-[var(--text-secondary)]">
          Servers approved once, for every agent that inherits the catalog. Same grammar as the per-agent allowlists:
          a server name, host, URL or wildcard such as <code className="text-xs">*.internal.example.com</code>. Tool
          lists narrow only agents that keep their own tool allowlist.
        </p>

        {entries.length === 0 ? (
          <p className="text-sm text-[var(--text-muted)]">Nothing approved org-wide yet.</p>
        ) : (
          <ul className="space-y-2">
            {entries.map((e) => (
              <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-base)] p-3">
                <div className="min-w-0">
                  <p className="font-mono text-xs text-[var(--text-primary)]">
                    {e.server}
                    {e.tools.length > 0 && <span className="text-[var(--text-muted)]"> / {e.tools.join(", ")}</span>}
                  </p>
                  <p className="text-[11px] text-[var(--text-muted)]">
                    {e.label ? `${e.label} · ` : ""}
                    {e.tools.length === 0 ? "every tool" : `${e.tools.length} tool${e.tools.length === 1 ? "" : "s"}`} · approved by{" "}
                    {e.approvedBy?.name ?? e.approvedBy?.email ?? "—"} · {formatDateTime(e.createdAt)}
                  </p>
                </div>
                {canEdit && (
                  <Button size="sm" variant="ghost" onClick={() => remove(e.id)} disabled={removing === e.id} aria-label={`Withdraw ${e.server}`}>
                    {removing === e.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}

        {canEdit && (
          <div className="space-y-3 rounded-lg border border-[var(--border-subtle)] p-3">
            <div className="grid gap-3 md:grid-cols-3">
              <div className="space-y-1">
                <Label htmlFor="catalog-server">Server</Label>
                <Input id="catalog-server" value={server} onChange={(e) => setServer(e.target.value)} placeholder="jira, mcp.example.com or *.internal.example.com" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="catalog-tools">Tools (optional, comma-separated)</Label>
                <Input id="catalog-tools" value={tools} onChange={(e) => setTools(e.target.value)} placeholder="search_issues, get_issue" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="catalog-label">Label (optional)</Label>
                <Input id="catalog-label" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Atlassian Jira (official)" />
              </div>
            </div>
            {error && <p className="text-xs text-[var(--critical)]">{error}</p>}
            <Button size="sm" onClick={add} disabled={saving || !server.trim()}>
              {saving ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Plus className="mr-1 h-3.5 w-3.5" />}
              Approve for all inheriting agents
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
