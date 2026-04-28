"use client";

import { useEffect, useState, useTransition } from "react";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Loader2,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

type LatestResponse = {
  configured: boolean;
  functionAppName: string | null;
  resourceGroup: string | null;
  region: string | null;
  latestSnapshot: {
    id: string;
    capturedAt: string;
    windowStart: string;
    windowEnd: string;
    invocationCount: number | null;
    http2xxCount: number | null;
    http4xxCount: number | null;
    http5xxCount: number | null;
    avgResponseTimeMs: number | null;
    syncError: string | null;
  } | null;
  recentSnapshots: Array<{
    capturedAt: string;
    invocationCount: number | null;
    http5xxCount: number | null;
    avgResponseTimeMs: number | null;
    syncError: string | null;
  }>;
  live: {
    windowStart: string;
    windowEnd: string;
    usageCount: number;
    flaggedCount: number;
    denialCount: number;
    latestUsageLogAt: string | null;
  };
  recentLogs: Array<{
    id: string;
    createdAt: string;
    provider: string;
    model: string | null;
    aiSystemId: string | null;
    department: string | null;
    totalTokens: number;
    cost: number;
    flagged: boolean;
    flagCategory: string | null;
    flagReason: string | null;
    user: { name: string | null; email: string | null } | null;
  }>;
};

const LIVE_POLL_MS = 15_000;

function formatAge(iso: string | null | undefined): string {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 0) return "now";
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function heartbeatTone(latestUsageAt: string | null): "ok" | "warn" | "stale" {
  if (!latestUsageAt) return "stale";
  const ageS = (Date.now() - new Date(latestUsageAt).getTime()) / 1000;
  if (ageS < 300) return "ok";
  if (ageS < 3600) return "warn";
  return "stale";
}

function LiveTile({
  label,
  value,
  tone = "default",
  sublabel,
}: {
  label: string;
  value: string | number;
  tone?: "default" | "ok" | "warn" | "critical" | "stale";
  sublabel?: string;
}) {
  const color =
    tone === "ok"
      ? "var(--success)"
      : tone === "warn"
        ? "var(--warning)"
        : tone === "critical"
          ? "var(--critical)"
          : tone === "stale"
            ? "var(--text-muted)"
            : "var(--text-primary)";
  return (
    <div
      className="rounded-lg border p-3"
      style={{
        borderColor: "var(--border-subtle)",
        backgroundColor: "var(--bg-base)",
      }}
    >
      <p className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">
        {label}
      </p>
      <p className="mt-1 text-2xl font-semibold" style={{ color }}>
        {value}
      </p>
      {sublabel ? (
        <p className="mt-0.5 text-[11px] text-[var(--text-faint)]">{sublabel}</p>
      ) : null}
    </div>
  );
}

interface Props {
  initial: LatestResponse;
}

export function ProxyHealthBoard({ initial }: Props) {
  const [data, setData] = useState<LatestResponse>(initial);
  const [now, setNow] = useState<number>(Date.now());
  const [lastPolled, setLastPolled] = useState<number>(Date.now());
  const [pollError, setPollError] = useState<string | null>(null);
  const [syncPending, startSync] = useTransition();
  const [syncError, setSyncError] = useState<string | null>(null);

  useEffect(() => {
    const poll = async () => {
      try {
        const res = await fetch("/api/proxy-health/latest", { cache: "no-store" });
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        const next = (await res.json()) as LatestResponse;
        setData(next);
        setPollError(null);
      } catch (err) {
        setPollError(err instanceof Error ? err.message : "poll failed");
      } finally {
        setLastPolled(Date.now());
      }
    };
    const interval = setInterval(poll, LIVE_POLL_MS);
    return () => clearInterval(interval);
  }, []);

  // Separate ticker so age strings refresh every second without re-fetching.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  async function handleSync() {
    startSync(async () => {
      setSyncError(null);
      try {
        const res = await fetch("/api/proxy-health/sync", { method: "POST" });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error ?? `HTTP ${res.status}`);
        }
        // Immediately refresh the board from /latest so the new snapshot shows.
        const latest = await fetch("/api/proxy-health/latest", { cache: "no-store" });
        if (latest.ok) setData((await latest.json()) as LatestResponse);
      } catch (err) {
        setSyncError(err instanceof Error ? err.message : "sync failed");
      }
    });
  }

  // Re-bind to `now` so this derivation re-runs on the 1-second ticker.
  const heartbeat = heartbeatTone(data.live.latestUsageLogAt ?? null);
  const heartbeatLabel = formatAge(data.live.latestUsageLogAt ?? null);
  // Silence unused `now` linter — we want the re-render but don't format it here.
  void now;

  if (!data.configured) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-[var(--warning)]" />
            Azure Monitor not configured
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p>
            Set <code>azure_subscription_id</code>, <code>azure_resource_group</code>, and{" "}
            <code>azure_function_app_name</code> in Settings → General to enable proxy-health sync.
          </p>
          <p className="text-[var(--text-muted)]">
            DB-side counters below are always live and require no Azure configuration.
          </p>
        </CardContent>
      </Card>
    );
  }

  const snap = data.latestSnapshot;
  const totalRequests =
    (snap?.http2xxCount ?? 0) + (snap?.http4xxCount ?? 0) + (snap?.http5xxCount ?? 0);
  const errorRate =
    totalRequests > 0 && snap
      ? ((snap.http5xxCount ?? 0) / totalRequests) * 100
      : null;

  return (
    <div className="space-y-6">
      {/* Heartbeat strip — live DB-sourced */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Activity className="h-4 w-4 text-[var(--accent)]" />
            Live heartbeat (last 15 minutes)
          </CardTitle>
          <div className="flex items-center gap-3 text-xs text-[var(--text-muted)]">
            <span>Polled {formatAge(new Date(lastPolled).toISOString())}</span>
            {pollError ? (
              <Badge
                variant="outline"
                className="text-[var(--critical)] border-[var(--critical)]/30"
              >
                Poll error: {pollError}
              </Badge>
            ) : null}
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <LiveTile
              label="Proxy Writes"
              value={data.live.usageCount}
              sublabel={`heartbeat ${heartbeatLabel}`}
              tone={heartbeat === "ok" ? "ok" : heartbeat === "warn" ? "warn" : "stale"}
            />
            <LiveTile
              label="Flagged"
              value={data.live.flaggedCount}
              tone={data.live.flaggedCount > 0 ? "warn" : "default"}
            />
            <LiveTile
              label="Policy Denials"
              value={data.live.denialCount}
              tone={data.live.denialCount > 0 ? "critical" : "default"}
            />
            <LiveTile
              label="Heartbeat Age"
              value={heartbeatLabel}
              tone={heartbeat === "ok" ? "ok" : heartbeat === "warn" ? "warn" : "stale"}
              sublabel={
                heartbeat === "ok"
                  ? "proxy writing normally"
                  : heartbeat === "warn"
                    ? "no writes in ≥ 5 min"
                    : "no writes in ≥ 1 hr"
              }
            />
          </div>
        </CardContent>
      </Card>

      {/* Azure Monitor strip — snapshot + sync */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <div>
            <CardTitle className="text-sm">Azure Monitor metrics</CardTitle>
            <p className="text-xs text-[var(--text-muted)]">
              {data.functionAppName}
              {data.resourceGroup ? ` · ${data.resourceGroup}` : ""}
              {data.region ? ` · ${data.region}` : ""}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-[var(--text-muted)]">
              {snap
                ? `Last sync ${formatAge(snap.capturedAt)}`
                : "Never synced"}
            </span>
            <Button size="sm" onClick={handleSync} disabled={syncPending}>
              {syncPending ? (
                <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="mr-1 h-3.5 w-3.5" />
              )}
              {syncPending ? "Syncing..." : "Sync now"}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {snap?.syncError ? (
            <div
              className="rounded-md border p-3 text-sm"
              style={{
                borderColor: "var(--critical)",
                backgroundColor: "color-mix(in srgb, var(--critical) 6%, var(--bg-base))",
              }}
            >
              <p className="font-medium text-[var(--critical)]">Last sync failed</p>
              <p className="mt-1 text-xs text-[var(--text-muted)] font-mono break-words">
                {snap.syncError}
              </p>
            </div>
          ) : null}
          {syncError ? (
            <div
              className="rounded-md border p-3 text-xs"
              style={{
                borderColor: "var(--critical)",
                backgroundColor: "color-mix(in srgb, var(--critical) 6%, var(--bg-base))",
              }}
            >
              <span className="font-medium text-[var(--critical)]">Sync request error: </span>
              <span className="font-mono text-[var(--text-muted)]">{syncError}</span>
            </div>
          ) : null}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <LiveTile
              label="Invocations"
              value={snap?.invocationCount ?? "—"}
            />
            <LiveTile
              label="2xx"
              value={snap?.http2xxCount ?? "—"}
              tone="ok"
            />
            <LiveTile
              label="4xx"
              value={snap?.http4xxCount ?? "—"}
              tone={(snap?.http4xxCount ?? 0) > 0 ? "warn" : "default"}
            />
            <LiveTile
              label="5xx"
              value={snap?.http5xxCount ?? "—"}
              tone={(snap?.http5xxCount ?? 0) > 0 ? "critical" : "default"}
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <LiveTile
              label="Error Rate"
              value={errorRate == null ? "—" : `${errorRate.toFixed(2)}%`}
              tone={errorRate != null && errorRate > 1 ? "warn" : "ok"}
            />
            <LiveTile
              label="Avg Response"
              value={
                snap?.avgResponseTimeMs != null
                  ? `${snap.avgResponseTimeMs.toFixed(0)} ms`
                  : "—"
              }
            />
            <LiveTile
              label="Window"
              value={snap ? "15 min" : "—"}
              sublabel={
                snap
                  ? `${new Date(snap.windowStart).toLocaleTimeString()} → ${new Date(
                      snap.windowEnd
                    ).toLocaleTimeString()}`
                  : undefined
              }
            />
          </div>
        </CardContent>
      </Card>

      {/* Tail of last 10 proxy writes */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Recent proxy writes ({data.recentLogs.length})</CardTitle>
          <p className="text-xs text-[var(--text-muted)]">
            The ten most-recent rows the proxy has written to <code>APIUsageLog</code>. Live-updates on the 15s poll.
          </p>
        </CardHeader>
        <CardContent>
          {data.recentLogs.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)]">No proxy writes yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-[var(--border-subtle)] text-left text-[var(--text-muted)]">
                    <th className="py-1.5 pr-4">Time</th>
                    <th className="py-1.5 pr-4">Provider · Model</th>
                    <th className="py-1.5 pr-4">User</th>
                    <th className="py-1.5 pr-4">Dept</th>
                    <th className="py-1.5 pr-4 text-right">Tokens</th>
                    <th className="py-1.5 pr-4 text-right">Cost</th>
                    <th className="py-1.5 pr-4">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {data.recentLogs.map((log) => (
                    <tr
                      key={log.id}
                      className="border-b border-[var(--border-subtle)]"
                    >
                      <td className="py-1.5 pr-4 text-[var(--text-muted)] whitespace-nowrap">
                        {formatAge(log.createdAt)}
                      </td>
                      <td className="py-1.5 pr-4">
                        <span className="text-[var(--text-muted)]">{log.provider}</span>
                        {log.model ? (
                          <>
                            {" · "}
                            <span>{log.model}</span>
                          </>
                        ) : null}
                      </td>
                      <td
                        className="py-1.5 pr-4 max-w-[180px] truncate"
                        title={log.user?.email ?? ""}
                      >
                        {log.user?.name ?? log.user?.email ?? "—"}
                      </td>
                      <td className="py-1.5 pr-4 text-[var(--text-muted)]">
                        {log.department ?? "—"}
                      </td>
                      <td className="py-1.5 pr-4 text-right tabular-nums">
                        {log.totalTokens.toLocaleString()}
                      </td>
                      <td className="py-1.5 pr-4 text-right tabular-nums">
                        ${log.cost.toFixed(4)}
                      </td>
                      <td className="py-1.5 pr-4">
                        {log.flagged ? (
                          <Badge
                            variant="outline"
                            className={
                              log.flagCategory === "prompt_risk"
                                ? "text-[var(--critical)] border-[var(--critical)]/30"
                                : "text-[var(--warning)] border-[var(--warning)]/30"
                            }
                            title={log.flagReason ?? undefined}
                          >
                            {log.flagCategory === "prompt_risk"
                              ? "Blocked"
                              : log.flagCategory === "upstream_error"
                                ? "Upstream error"
                                : log.flagCategory === "proxy_error"
                                  ? "Proxy error"
                                  : "Flagged"}
                          </Badge>
                        ) : (
                          <Badge
                            variant="outline"
                            className="text-[var(--success)] border-[var(--success)]/30"
                          >
                            OK
                          </Badge>
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

      {/* Recent sync history */}
      {data.recentSnapshots.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Last hour of syncs ({data.recentSnapshots.length})</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-[var(--border-subtle)] text-left text-[var(--text-muted)]">
                    <th className="py-1.5 pr-4">At</th>
                    <th className="py-1.5 pr-4">Invocations</th>
                    <th className="py-1.5 pr-4">5xx</th>
                    <th className="py-1.5 pr-4">Avg ms</th>
                    <th className="py-1.5 pr-4">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {data.recentSnapshots
                    .slice()
                    .reverse()
                    .map((s) => (
                      <tr
                        key={s.capturedAt}
                        className="border-b border-[var(--border-subtle)]"
                      >
                        <td className="py-1.5 pr-4 text-[var(--text-muted)]">
                          {formatAge(s.capturedAt)}
                        </td>
                        <td className="py-1.5 pr-4">{s.invocationCount ?? "—"}</td>
                        <td className="py-1.5 pr-4">
                          {s.http5xxCount ?? "—"}
                        </td>
                        <td className="py-1.5 pr-4">
                          {s.avgResponseTimeMs != null
                            ? s.avgResponseTimeMs.toFixed(0)
                            : "—"}
                        </td>
                        <td className="py-1.5 pr-4">
                          {s.syncError ? (
                            <Badge
                              variant="outline"
                              className="text-[var(--critical)] border-[var(--critical)]/30"
                            >
                              Failed
                            </Badge>
                          ) : (
                            <Badge
                              variant="outline"
                              className="text-[var(--success)] border-[var(--success)]/30"
                            >
                              <CheckCircle2 className="mr-1 h-3 w-3" />
                              OK
                            </Badge>
                          )}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
