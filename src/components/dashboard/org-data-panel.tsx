"use client";

import { useState } from "react";
import { RefreshCw, Loader2, Bot, KeyRound, Users, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

type OrgData = {
  anthropic: {
    org?: { name?: string; id?: string } | null;
    keys?: { data?: { id: string; name: string; status: string; created_at: string }[] } | null;
    members?: { data?: { email: string; name: string; role: string }[] } | null;
    usageByModel?: { data?: { starting_at: string; ending_at: string; results: { model: string; uncached_input_tokens: number; output_tokens: number; cache_read_input_tokens?: number }[] }[] } | null;
    error?: string;
  } | null;
  openai: {
    usageByModel?: { data?: { results?: { model?: string; input_tokens?: number; output_tokens?: number }[] }[] } | null;
    costs?: { data?: { results?: { amount?: { value?: number } }[] }[] } | null;
    assistants?: { data?: { id: string; name: string; model: string; created_at: number }[] } | null;
    error?: string;
  } | null;
  gemini: {
    totalCost?: number;
    rowCount?: number;
    topSkus?: { label: string; cost: number; usageAmount: number }[];
    topProjects?: { label: string; cost: number; usageAmount: number }[];
    error?: string;
  } | null;
  syncRuns?: {
    id: string;
    provider: string;
    status: string;
    startedAt: string;
    completedAt: string | null;
    recordsProcessed: number;
    errorMessage: string | null;
  }[];
};

export function OrgDataPanel() {
  const [data, setData] = useState<OrgData | null>(null);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<string | null>(null);

  async function handleFetch() {
    setLoading(true);
    try {
      const res = await fetch("/api/admin-sync");
      if (res.ok) setData(await res.json());
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }

  async function handleSync() {
    setSyncing(true);
    setSyncResult(null);
    try {
      const res = await fetch("/api/admin-sync", { method: "POST" });
      const text = await res.text();
      let result: Record<string, unknown>;
      try {
        result = JSON.parse(text);
      } catch {
        setSyncResult(`Sync failed (HTTP ${res.status}): ${text.slice(0, 200)}`);
        return;
      }

      if (res.ok) {
        const parts: string[] = [];
        if ((result.anthropicUsageSynced as number) > 0) parts.push(`${result.anthropicUsageSynced} Anthropic usage records`);
        if ((result.openaiUsageSynced as number) > 0) parts.push(`${result.openaiUsageSynced} OpenAI usage records`);
        if ((result.geminiUsageSynced as number) > 0) parts.push(`${result.geminiUsageSynced} Gemini usage records`);
        if ((result.claudeCodeUsageSynced as number) > 0) parts.push(`${result.claudeCodeUsageSynced} Claude Code usage records`);
        if ((result.anthropicCostBucketsSynced as number) > 0) parts.push(`${result.anthropicCostBucketsSynced} Anthropic cost buckets`);
        if ((result.openaiCostBucketsSynced as number) > 0) parts.push(`${result.openaiCostBucketsSynced} OpenAI cost buckets`);
        if ((result.geminiCostBucketsSynced as number) > 0) parts.push(`${result.geminiCostBucketsSynced} Gemini cost buckets`);
        if ((result.claudeCodeCostsSynced as number) > 0) parts.push(`${result.claudeCodeCostsSynced} Claude Code cost buckets`);
        if ((result.agentsCreated as number) > 0) parts.push(`${result.agentsCreated} new agents`);
        if ((result.agentsUpdated as number) > 0) parts.push(`${result.agentsUpdated} agents updated`);
        if ((result.errors as string[])?.length > 0) parts.push(`Errors: ${(result.errors as string[]).join("; ")}`);
        setSyncResult(parts.length > 0 ? `Synced: ${parts.join(", ")}. Refresh the page to update stats.` : "No new data to sync.");
      } else {
        setSyncResult(`Sync failed (HTTP ${res.status}): ${result.error ?? JSON.stringify(result)}`);
      }
    } catch (err) {
      setSyncResult(`Sync failed: ${err instanceof Error ? err.message : "Network error"}`);
    } finally {
      setSyncing(false);
    }
  }

  const hasAnyProvider = data?.anthropic || data?.openai || data?.gemini;

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>Organization Data</CardTitle>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={handleFetch} disabled={loading}>
            {loading ? <Loader2 className="mr-1.5 h-3 w-3 animate-spin" /> : <RefreshCw className="mr-1.5 h-3 w-3" />}
            {loading ? "Loading..." : "Fetch Org Data"}
          </Button>
          <Button size="sm" onClick={handleSync} disabled={syncing}>
            {syncing ? <Loader2 className="mr-1.5 h-3 w-3 animate-spin" /> : <TrendingUp className="mr-1.5 h-3 w-3" />}
            {syncing ? "Syncing..." : "Sync Usage & Agents"}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {syncResult && (
          <p className={`text-xs font-medium mb-4 ${syncResult.includes("failed") ? "text-[var(--critical)]" : "text-[var(--success)]"}`}>
            {syncResult}
          </p>
        )}

        {!data && !loading && (
          <p className="text-sm text-[var(--text-muted)] text-center py-6">
            Click &quot;Fetch Org Data&quot; to pull usage data from Anthropic, OpenAI, and Google Gemini oversight sources.
            <br />
            <span className="text-xs text-[var(--text-faint)]">Configure provider credentials in Settings &gt; Provider Admin APIs first.</span>
          </p>
        )}

        {hasAnyProvider && (
          <div className="grid gap-4 lg:grid-cols-2">
            {/* Anthropic */}
            {data?.anthropic && !data.anthropic.error && (
              <div className="space-y-3 rounded-lg border border-[var(--border-subtle)] p-4">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-semibold text-[var(--accent)]">Anthropic</h4>
                  {data.anthropic.org?.name && (
                    <Badge variant="info">{data.anthropic.org.name as string}</Badge>
                  )}
                </div>

                {/* API Keys */}
                {data.anthropic.keys?.data && (
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-faint)] mb-1.5 flex items-center gap-1">
                      <KeyRound className="h-3 w-3" /> API Keys ({data.anthropic.keys.data.length})
                    </p>
                    <div className="space-y-1">
                      {(data.anthropic.keys.data as { name: string; status: string }[]).slice(0, 5).map((key, i) => (
                        <div key={i} className="flex items-center justify-between text-xs">
                          <span className="text-[var(--text-secondary)]">{key.name || "Unnamed"}</span>
                          <Badge variant={key.status === "active" ? "success" : "default"}>{key.status}</Badge>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Members */}
                {data.anthropic.members?.data && (
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-faint)] mb-1.5 flex items-center gap-1">
                      <Users className="h-3 w-3" /> Members ({(data.anthropic.members.data as unknown[]).length})
                    </p>
                    <div className="space-y-1">
                      {(data.anthropic.members.data as { name: string; email: string; role: string }[]).slice(0, 5).map((m, i) => (
                        <div key={i} className="flex items-center justify-between text-xs">
                          <span className="text-[var(--text-secondary)]">{m.name || m.email}</span>
                          <Badge variant="outline">{m.role}</Badge>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Usage by model */}
                {data.anthropic.usageByModel?.data && (
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-faint)] mb-1.5 flex items-center gap-1">
                      <TrendingUp className="h-3 w-3" /> Usage (30 days)
                    </p>
                    <div className="space-y-1">
                      {(() => {
                        // Flatten nested buckets and aggregate by model
                        const byModel = new Map<string, number>();
                        for (const bucket of data.anthropic!.usageByModel!.data!) {
                          for (const r of bucket.results) {
                            const model = r.model ?? "unknown";
                            const tokens = (r.uncached_input_tokens ?? 0) + (r.output_tokens ?? 0) + (r.cache_read_input_tokens ?? 0);
                            byModel.set(model, (byModel.get(model) ?? 0) + tokens);
                          }
                        }
                        return Array.from(byModel.entries())
                          .sort(([, a], [, b]) => b - a)
                          .map(([model, tokens], i) => (
                            <div key={i} className="flex items-center justify-between text-xs">
                              <span className="text-[var(--text-secondary)] font-mono">{model}</span>
                              <span className="text-[var(--text-muted)] tabular-nums">
                                {(tokens / 1000).toFixed(0)}k tokens
                              </span>
                            </div>
                          ));
                      })()}
                    </div>
                  </div>
                )}
              </div>
            )}

            {data?.anthropic?.error && (
              <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-4">
                <h4 className="text-sm font-semibold text-[var(--critical)] mb-1">Anthropic</h4>
                <p className="text-xs text-[var(--critical)]">{data.anthropic.error}</p>
              </div>
            )}

            {/* OpenAI */}
            {data?.openai && !data.openai.error && (
              <div className="space-y-3 rounded-lg border border-[var(--border-subtle)] p-4">
                <h4 className="text-sm font-semibold text-[var(--success)]">OpenAI</h4>

                {/* Assistants */}
                {data.openai.assistants?.data && (data.openai.assistants.data as unknown[]).length > 0 && (
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-faint)] mb-1.5 flex items-center gap-1">
                      <Bot className="h-3 w-3" /> Assistants ({(data.openai.assistants.data as unknown[]).length})
                    </p>
                    <div className="space-y-1">
                      {(data.openai.assistants.data as { name: string; model: string }[]).slice(0, 8).map((a, i) => (
                        <div key={i} className="flex items-center justify-between text-xs">
                          <span className="text-[var(--text-secondary)]">{a.name || "Unnamed"}</span>
                          <span className="text-[var(--text-faint)] font-mono">{a.model}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Costs */}
                {data.openai.costs?.data && (
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-faint)] mb-1.5 flex items-center gap-1">
                      <TrendingUp className="h-3 w-3" /> Costs (30 days)
                    </p>
                    {(() => {
                      const buckets = (data.openai.costs!.data as { results?: { amount?: { value?: number } }[] }[]) ?? [];
                      const totalCost = buckets.reduce((sum, b) => {
                        const results = b.results ?? [];
                        return sum + results.reduce((s, r) => s + (r.amount?.value ?? 0), 0);
                      }, 0);
                      return (
                        <p className="text-lg font-bold tabular-nums text-[var(--text-primary)]" style={{ fontFamily: "var(--font-display)" }}>
                          ${(totalCost / 100).toFixed(2)}
                        </p>
                      );
                    })()}
                  </div>
                )}
              </div>
            )}

            {data?.openai?.error && (
              <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-4">
                <h4 className="text-sm font-semibold text-[var(--critical)] mb-1">OpenAI</h4>
                <p className="text-xs text-[var(--critical)]">{data.openai.error}</p>
              </div>
            )}

            {data?.gemini && !data.gemini.error && (
              <div className="space-y-3 rounded-lg border border-[var(--border-subtle)] p-4">
                <h4 className="text-sm font-semibold text-[var(--text-primary)]">Google Gemini</h4>

                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-faint)] mb-1.5 flex items-center gap-1">
                    <TrendingUp className="h-3 w-3" /> Costs (30 days)
                  </p>
                  <p className="text-lg font-bold tabular-nums text-[var(--text-primary)]" style={{ fontFamily: "var(--font-display)" }}>
                    ${(data.gemini.totalCost ?? 0).toFixed(2)}
                  </p>
                  <p className="text-xs text-[var(--text-muted)]">
                    {(data.gemini.rowCount ?? 0).toLocaleString()} Gemini / Vertex billing rows summarized
                  </p>
                </div>

                {(data.gemini.topSkus?.length ?? 0) > 0 && (
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-faint)] mb-1.5">
                      Top SKUs
                    </p>
                    <div className="space-y-1">
                      {data.gemini.topSkus?.slice(0, 5).map((sku, i) => (
                        <div key={i} className="flex items-center justify-between text-xs gap-3">
                          <span className="text-[var(--text-secondary)]">{sku.label}</span>
                          <span className="text-[var(--text-muted)] tabular-nums">${sku.cost.toFixed(2)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {(data.gemini.topProjects?.length ?? 0) > 0 && (
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-faint)] mb-1.5">
                      Top Projects
                    </p>
                    <div className="space-y-1">
                      {data.gemini.topProjects?.slice(0, 5).map((project, i) => (
                        <div key={i} className="flex items-center justify-between text-xs gap-3">
                          <span className="text-[var(--text-secondary)]">{project.label}</span>
                          <span className="text-[var(--text-muted)] tabular-nums">${project.cost.toFixed(2)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {data?.gemini?.error && (
              <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-4">
                <h4 className="text-sm font-semibold text-[var(--critical)] mb-1">Google Gemini</h4>
                <p className="text-xs text-[var(--critical)]">{data.gemini.error}</p>
              </div>
            )}
          </div>
        )}

        {data?.syncRuns && data.syncRuns.length > 0 && (
          <div className="mt-6">
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-faint)]">
              Recent Sync Runs
            </p>
            <div className="space-y-2">
              {data.syncRuns.slice(0, 6).map((run) => (
                <div key={run.id} className="flex items-center justify-between rounded-md border border-[var(--border-subtle)] p-3">
                  <div>
                    <p className="text-sm font-medium capitalize">{run.provider}</p>
                    <p className="text-xs text-[var(--text-muted)]">
                      Started {new Date(run.startedAt).toLocaleString()} · {run.recordsProcessed} records
                    </p>
                    {run.errorMessage && (
                      <p className="text-xs text-[var(--critical)]">{run.errorMessage}</p>
                    )}
                  </div>
                  <Badge variant={run.status === "SUCCEEDED" ? "success" : run.status === "FAILED" ? "critical" : "warning"}>
                    {run.status}
                  </Badge>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
