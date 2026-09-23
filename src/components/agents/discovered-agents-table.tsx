"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, Radar } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge, statusBadgeVariant } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";

export type DiscoveredAgentRow = {
  id: string;
  source: string;
  sourceLabel: string;
  name: string;
  description: string | null;
  platform: string | null;
  framework: string | null;
  status: string;
  confidence: string | null;
  score: number | null;
  signals: { key: string; label: string; weight: number }[];
  tools: string[];
  mcpServers: string[];
  models: string[];
  userEmails: string[];
  requestCount: number;
  lastSeenAt: string | null;
  linkedAgent: { id: string; name: string } | null;
};

// Confidence that this is an agent, not risk — so not the risk palette.
const CONFIDENCE_VARIANT: Record<string, "info" | "default" | "outline"> = {
  high: "info",
  medium: "default",
  low: "outline",
};

const STATUS_FILTERS = ["OPEN", "DISCOVERED", "UNDER_REVIEW", "REGISTERED", "APPROVED", "BLOCKED", "ALL"] as const;
type StatusFilter = (typeof STATUS_FILTERS)[number];

function matchesFilter(status: string, filter: StatusFilter) {
  if (filter === "ALL") return true;
  if (filter === "OPEN") return status === "DISCOVERED" || status === "UNDER_REVIEW";
  return status === filter;
}

function Chips({ items, max = 4 }: { items: string[]; max?: number }) {
  if (items.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1">
      {items.slice(0, max).map((item) => (
        <span
          key={item}
          className="max-w-[16rem] truncate rounded bg-[var(--bg-elevated)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--text-secondary)]"
          title={item}
        >
          {item}
        </span>
      ))}
      {items.length > max && <span className="text-[10px] text-[var(--text-faint)]">+{items.length - max} more</span>}
    </div>
  );
}

export function DiscoveredAgentsTable({ rows, canEdit }: { rows: DiscoveredAgentRow[]; canEdit: boolean }) {
  const router = useRouter();
  const [filter, setFilter] = useState<StatusFilter>("OPEN");
  const [source, setSource] = useState<string>("all");
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  const sources = Array.from(new Map(rows.map((r) => [r.source, r.sourceLabel])).entries());
  const visible = rows.filter((r) => matchesFilter(r.status, filter) && (source === "all" || r.source === source));

  async function call(key: string, url: string, init: RequestInit, success: (body: Record<string, unknown>) => string) {
    setBusy(key);
    setMessage(null);
    try {
      const res = await fetch(url, { headers: { "Content-Type": "application/json" }, ...init });
      const body = await res.json().catch(() => ({}));
      if (!res.ok && res.status !== 207) throw new Error(body.error ?? `Failed (${res.status})`);
      setMessage({ tone: body.ok === false ? "error" : "ok", text: body.ok === false ? String(body.error ?? "Failed") : success(body) });
      router.refresh();
    } catch (err) {
      setMessage({ tone: "error", text: err instanceof Error ? err.message : "Failed" });
    } finally {
      setBusy(null);
    }
  }

  const setStatus = (row: DiscoveredAgentRow, status: string) =>
    call(`${row.id}:${status}`, `/api/discovered-agents/${row.id}`, { method: "PUT", body: JSON.stringify({ status }) }, () =>
      `${row.name} marked ${status.replace("_", " ").toLowerCase()}.`
    );

  const register = (row: DiscoveredAgentRow) =>
    call(`${row.id}:register`, `/api/discovered-agents/${row.id}/register`, { method: "POST", body: "{}" }, () =>
      `${row.name} added to the registry as a draft agent.`
    );

  const detect = () =>
    call("detect", "/api/discovered-agents/detect", { method: "POST" }, (body) =>
      `Detection scanned ${body.callers ?? 0} caller(s): ${body.created ?? 0} new, ${body.updated ?? 0} updated.`
    );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={`rounded-md px-2.5 py-1 text-xs transition-colors ${
                filter === f
                  ? "bg-[var(--accent-dim)] text-[var(--accent)]"
                  : "text-[var(--text-muted)] hover:bg-[var(--bg-elevated)]"
              }`}
            >
              {f === "OPEN" ? "Needs review" : f === "ALL" ? "All" : f.replace("_", " ").toLowerCase()}
            </button>
          ))}
        </div>
        {sources.length > 1 && (
          <select
            value={source}
            onChange={(e) => setSource(e.target.value)}
            aria-label="Filter by source"
            className="h-8 rounded-lg border border-[var(--border-default)] bg-[var(--bg-elevated)] px-2 text-xs text-[var(--text-primary)]"
          >
            <option value="all">All sources</option>
            {sources.map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
        )}
        {canEdit && (
          <Button size="sm" variant="outline" className="ml-auto" onClick={detect} disabled={busy !== null}>
            {busy === "detect" ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <Radar className="mr-2 h-3.5 w-3.5" />}
            Run proxy detection
          </Button>
        )}
      </div>

      {message && (
        <p className={`text-xs ${message.tone === "ok" ? "text-[var(--success)]" : "text-[var(--critical)]"}`}>{message.text}</p>
      )}

      {visible.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <Radar className="mb-4 h-12 w-12 text-[var(--text-faint)]" />
            <p className="text-[var(--text-muted)]">
              {rows.length === 0 ? "No agents discovered yet." : "Nothing matches this filter."}
            </p>
            {rows.length === 0 && (
              <p className="mt-1 max-w-md text-xs text-[var(--text-faint)]">
                Agents appear here from proxy traffic detection, agent-platform imports and endpoint MCP scans.
              </p>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {visible.map((row) => {
            const open = row.status === "DISCOVERED" || row.status === "UNDER_REVIEW";
            return (
              <Card key={row.id}>
                <CardContent className="space-y-3 p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="font-semibold text-[var(--text-primary)]">{row.name}</h3>
                      <p className="mt-0.5 text-xs text-[var(--text-muted)]">
                        {row.sourceLabel}
                        {row.platform && row.platform !== row.sourceLabel ? ` · ${row.platform}` : ""}
                        {row.userEmails.length > 0 ? ` · ${row.userEmails.slice(0, 2).join(", ")}` : ""}
                        {row.lastSeenAt ? ` · last seen ${row.lastSeenAt}` : ""}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      <Badge variant={statusBadgeVariant(row.status)}>{row.status.replace("_", " ")}</Badge>
                      {row.confidence && (
                        <Badge variant={CONFIDENCE_VARIANT[row.confidence] ?? "default"}>
                          {row.confidence}
                          {row.score != null ? ` · ${row.score}` : ""}
                        </Badge>
                      )}
                    </div>
                  </div>

                  {row.description && <p className="line-clamp-2 text-sm text-[var(--text-secondary)]">{row.description}</p>}

                  {row.signals.length > 0 && (
                    <ul className="space-y-0.5 text-xs text-[var(--text-muted)]">
                      {row.signals.map((s) => (
                        <li key={s.key}>
                          <span className="text-[var(--text-faint)]">+{s.weight}</span> {s.label}
                        </li>
                      ))}
                    </ul>
                  )}

                  <div className="grid gap-2 text-xs sm:grid-cols-3">
                    {row.mcpServers.length > 0 && (
                      <div className="space-y-1">
                        <p className="text-[var(--text-faint)]">MCP servers</p>
                        <Chips items={row.mcpServers} />
                      </div>
                    )}
                    {row.tools.length > 0 && (
                      <div className="space-y-1">
                        <p className="text-[var(--text-faint)]">Tools</p>
                        <Chips items={row.tools} />
                      </div>
                    )}
                    {(row.models.length > 0 || row.framework) && (
                      <div className="space-y-1">
                        <p className="text-[var(--text-faint)]">{row.framework ? `Framework: ${row.framework}` : "Models"}</p>
                        <Chips items={row.models} max={3} />
                      </div>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-2 border-t border-[var(--border-subtle)] pt-3">
                    {row.linkedAgent ? (
                      <Link href={`/agents/${row.linkedAgent.id}`} className="text-xs text-[var(--accent)] hover:underline">
                        Registered as {row.linkedAgent.name} →
                      </Link>
                    ) : (
                      canEdit && (
                        <Button size="sm" onClick={() => register(row)} disabled={busy !== null}>
                          {busy === `${row.id}:register` && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
                          Register agent
                        </Button>
                      )
                    )}
                    {canEdit && row.status === "DISCOVERED" && (
                      <Button size="sm" variant="outline" onClick={() => setStatus(row, "UNDER_REVIEW")} disabled={busy !== null}>
                        Start review
                      </Button>
                    )}
                    {canEdit && open && !row.linkedAgent && (
                      <Button size="sm" variant="outline" onClick={() => setStatus(row, "APPROVED")} disabled={busy !== null}>
                        Approve without registering
                      </Button>
                    )}
                    {canEdit && row.status !== "BLOCKED" && (
                      <Button size="sm" variant="ghost" className="text-[var(--critical)]" onClick={() => setStatus(row, "BLOCKED")} disabled={busy !== null}>
                        Mark blocked
                      </Button>
                    )}
                    {canEdit && !open && row.status !== "REGISTERED" && (
                      <Button size="sm" variant="ghost" onClick={() => setStatus(row, "UNDER_REVIEW")} disabled={busy !== null}>
                        Reopen
                      </Button>
                    )}
                    {row.source === "proxy_traffic" && row.requestCount > 0 && (
                      <span className="ml-auto text-[10px] text-[var(--text-faint)]">{row.requestCount.toLocaleString()} requests (7d)</span>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
