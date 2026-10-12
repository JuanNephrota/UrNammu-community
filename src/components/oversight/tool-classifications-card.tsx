"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, Tags, Trash2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { HelpHint } from "@/components/help/help-hint";
import { formatDateTime } from "@/lib/utils";

export type ToolClassificationRow = {
  id: string;
  server: string;
  tool: string;
  access: string;
  system: string | null;
  notes: string | null;
  createdAt: Date | string;
  createdBy: { name: string | null; email: string } | null;
};

const ACCESS_VARIANT: Record<string, "success" | "warning" | "critical"> = {
  read: "success",
  write: "warning",
  admin: "critical",
};

const SELECT =
  "flex h-9 w-full rounded-lg border border-[var(--border-default)] bg-[var(--bg-elevated)] px-3 py-1 text-sm text-[var(--text-primary)] appearance-none";

/**
 * Org-wide tool classification rules (Oversight → MCP Activity). Both proxies
 * read them to decide whether a tool call fits an agent's access level and
 * connected systems. See src/lib/agent-scope.ts.
 */
export function ToolClassificationsCard({ rules, canEdit }: { rules: ToolClassificationRow[]; canEdit: boolean }) {
  const router = useRouter();
  const [server, setServer] = useState("*");
  const [tool, setTool] = useState("");
  const [access, setAccess] = useState("read");
  const [system, setSystem] = useState("");
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function add() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/tool-classifications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ server: server.trim() || "*", tool: tool.trim(), access, system: system.trim() || undefined }),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload.error ?? `Failed (${res.status})`);
      }
      setTool("");
      setSystem("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    setRemoving(id);
    setError(null);
    try {
      const res = await fetch(`/api/tool-classifications/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setRemoving(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center justify-between gap-2">
          <span className="flex items-center gap-2">
            <Tags className="h-4 w-4 text-[var(--accent)]" />
            Tool classifications
            <HelpHint hint="tool_classifications" />
          </span>
          <Badge variant="outline">{rules.length} rule{rules.length === 1 ? "" : "s"}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-[var(--text-muted)]">
          What each tool does (read / write / admin) and which system it reaches. Both proxies compare this with every
          agent&apos;s access level and connected systems; tools without a rule are classified by name, and unknown names
          count as write. Patterns: <code className="rounded bg-[var(--bg-elevated)] px-1 py-0.5 text-[var(--accent)]">*</code> any
          server, <code className="rounded bg-[var(--bg-elevated)] px-1 py-0.5 text-[var(--accent)]">-</code> tools with no server,
          globs allowed; the most specific rule wins.
        </p>

        {rules.length === 0 ? (
          <p className="rounded-lg border border-dashed border-[var(--border-subtle)] p-4 text-xs text-[var(--text-muted)]">
            No rules yet. Every tool is classified from its name. Add rules here or classify observed tools on an agent&apos;s MCP card.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-[var(--border-subtle)]">
            <table className="w-full text-sm">
              <thead className="bg-[var(--bg-base)] text-left text-[10px] uppercase tracking-wider text-[var(--text-faint)]">
                <tr>
                  <th className="px-3 py-2">Server / tool</th>
                  <th className="px-3 py-2">Access</th>
                  <th className="px-3 py-2">System</th>
                  <th className="px-3 py-2">Set by</th>
                  {canEdit && <th className="px-3 py-2" />}
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border-subtle)]">
                {rules.map((r) => (
                  <tr key={r.id}>
                    <td className="px-3 py-2 font-mono text-xs text-[var(--text-primary)]">
                      {r.server}/{r.tool}
                    </td>
                    <td className="px-3 py-2">
                      <Badge variant={ACCESS_VARIANT[r.access] ?? "default"}>{r.access}</Badge>
                    </td>
                    <td className="px-3 py-2 text-xs text-[var(--text-muted)]">{r.system ?? "—"}</td>
                    <td className="px-3 py-2 text-[11px] text-[var(--text-muted)]">
                      {r.createdBy?.name ?? r.createdBy?.email ?? "—"} · {formatDateTime(r.createdAt)}
                    </td>
                    {canEdit && (
                      <td className="px-3 py-2 text-right">
                        <Button size="sm" variant="ghost" onClick={() => remove(r.id)} disabled={removing === r.id} aria-label={`Remove ${r.server}/${r.tool}`}>
                          {removing === r.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                        </Button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {canEdit && (
          <div className="space-y-3 rounded-lg border border-[var(--border-subtle)] p-3">
            <div className="grid gap-3 md:grid-cols-4">
              <div className="space-y-1">
                <Label htmlFor="cls-server">Server</Label>
                <Input id="cls-server" value={server} onChange={(e) => setServer(e.target.value)} placeholder="*, jira or -" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="cls-tool">Tool</Label>
                <Input id="cls-tool" value={tool} onChange={(e) => setTool(e.target.value)} placeholder="create_issue or run_*" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="cls-access">Access</Label>
                <select id="cls-access" value={access} onChange={(e) => setAccess(e.target.value)} className={SELECT}>
                  <option value="read">read</option>
                  <option value="write">write</option>
                  <option value="admin">admin</option>
                </select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="cls-system">System (optional)</Label>
                <Input id="cls-system" value={system} onChange={(e) => setSystem(e.target.value)} placeholder="Jira" />
              </div>
            </div>
            {error && <p className="text-xs text-[var(--critical)]">{error}</p>}
            <Button size="sm" onClick={add} disabled={saving || !tool.trim()}>
              {saving ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Plus className="mr-1 h-3.5 w-3.5" />}
              Add rule
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
