import Link from "next/link";
import { PageHeader } from "@/components/layout/page-header";
import { StatCard } from "@/components/dashboard/stat-card";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatCompactNumber, formatDateTime } from "@/lib/utils";
import { loadCursorDashboard } from "@/lib/cursor-dashboard";
import { CursorUserFilter } from "@/components/oversight/cursor-user-filter";

function formatDuration(ms: number | null): string {
  if (ms == null) return "—";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60_000).toFixed(1)}m`;
}

export default async function CursorOversightPage({
  searchParams,
}: {
  searchParams: Promise<{ user?: string }>;
}) {
  const selectedUser = ((await searchParams).user ?? "").trim() || null;
  const data = await loadCursorDashboard(selectedUser);

  const hasData = data.summary.totalSpans > 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Cursor Analytics"
        description="Developer activity from Cursor, sourced from OTel spans via cursor-otel-hook. Last 7 days. Cursor's hook carries no token or cost data — these are activity metrics only."
      >
        <CursorUserFilter users={data.allUsers} initialUser={selectedUser ?? ""} />
      </PageHeader>

      {selectedUser && (
        <p className="text-xs text-[var(--text-muted)]">
          Showing activity for <span className="text-[var(--text-primary)]">{selectedUser}</span>.
          Spend (7d) is team-wide and not affected by the user filter.
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Live Spans (60m)"
          value={formatCompactNumber(data.live.spans)}
          description={
            data.live.latestReceivedAt
              ? `Last received ${formatDateTime(data.live.latestReceivedAt)}`
              : "No telemetry received yet"
          }
          iconName="Activity"
          variant={data.live.spans > 0 ? "success" : "default"}
        />
        <StatCard
          title="Active Sessions"
          value={data.summary.sessions}
          description={`${data.summary.users} active users · 7 days`}
          iconName="MousePointer2"
          variant="info"
        />
        <StatCard
          title="Tool Calls"
          value={formatCompactNumber(data.summary.toolCalls)}
          description={`${formatCompactNumber(data.summary.totalSpans)} total spans · 7 days`}
          iconName="Wrench"
          variant="default"
        />
        <StatCard
          title="Risk Flags"
          value={data.summary.flaggedSpans}
          description={
            data.summary.flaggedSpans > 0
              ? "Dangerous-prompt signals on Cursor prompts"
              : "No prompt-risk signals"
          }
          iconName="ShieldAlert"
          variant={data.summary.flaggedSpans > 0 ? "danger" : "success"}
          href="/alerts"
        />
        <StatCard
          title="Spend (7d)"
          value={data.summary.cost7d == null ? "—" : `$${data.summary.cost7d.toFixed(2)}`}
          description={
            data.summary.cost7d == null
              ? "Connect the Cursor Admin API for cost"
              : "On-demand spend · Admin API"
          }
          iconName="DollarSign"
          variant="info"
          href="/oversight/usage?provider=cursor"
        />
      </div>

      {!hasData && (
        <Card>
          <CardContent className="py-10 text-center text-sm text-[var(--text-muted)]">
            No Cursor telemetry yet. Once <code>cursor-otel-hook</code> is
            installed and pointed at the collector, spans land here within a
            minute. See <code>ops/cursor-hook/README.md</code> for setup.
          </CardContent>
        </Card>
      )}

      {hasData && (
        <>
          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader><CardTitle>Top Tools</CardTitle></CardHeader>
              <CardContent>
                {data.topTools.length === 0 ? (
                  <p className="text-sm text-[var(--text-muted)]">No tool spans yet.</p>
                ) : (
                  <div className="space-y-2">
                    {data.topTools.map((t) => (
                      <div
                        key={t.tool}
                        className="flex items-center justify-between rounded-md border border-[var(--border-subtle)] p-3"
                      >
                        <p className="text-sm font-medium">{t.tool}</p>
                        <p className="text-sm text-[var(--text-muted)]">
                          {t.count.toLocaleString("en-US")} calls
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle>Activity by Hook Event</CardTitle></CardHeader>
              <CardContent>
                {data.byHookEvent.length === 0 ? (
                  <p className="text-sm text-[var(--text-muted)]">No hook events yet.</p>
                ) : (
                  <div className="space-y-2">
                    {data.byHookEvent.map((h) => (
                      <div
                        key={h.hookEvent}
                        className="flex items-center justify-between rounded-md border border-[var(--border-subtle)] p-3"
                      >
                        <p className="text-sm font-mono">{h.hookEvent}</p>
                        <p className="text-sm text-[var(--text-muted)]">
                          {h.count.toLocaleString("en-US")}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader><CardTitle>Most Active Users</CardTitle></CardHeader>
              <CardContent>
                {data.topUsers.length === 0 ? (
                  <p className="text-sm text-[var(--text-muted)]">
                    No user attribution. Tag users via{" "}
                    <code>OTEL_RESOURCE_ATTRIBUTES</code> on the client.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {data.topUsers.map((u) => (
                      <Link
                        key={u.userEmail}
                        href={`/oversight/cursor?user=${encodeURIComponent(u.userEmail)}`}
                        className="flex items-center justify-between rounded-md border border-[var(--border-subtle)] p-3 transition-colors hover:border-[var(--accent)] hover:bg-[var(--bg-base)]"
                      >
                        <p className="text-sm font-medium">{u.userEmail}</p>
                        <p className="text-sm text-[var(--text-muted)]">
                          {u.count.toLocaleString("en-US")} spans
                        </p>
                      </Link>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle>Span Durations (7 days)</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="rounded-lg border border-[var(--border-subtle)] p-4">
                    <p className="text-xs uppercase tracking-wider text-[var(--text-faint)]">
                      Average
                    </p>
                    <p className="mt-2 text-2xl font-semibold">
                      {formatDuration(data.summary.avgDurationMs)}
                    </p>
                  </div>
                  <div className="rounded-lg border border-[var(--border-subtle)] p-4">
                    <p className="text-xs uppercase tracking-wider text-[var(--text-faint)]">
                      Slowest
                    </p>
                    <p className="mt-2 text-2xl font-semibold">
                      {formatDuration(data.summary.maxDurationMs)}
                    </p>
                  </div>
                </div>
                {data.riskFlags.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-xs uppercase tracking-wider text-[var(--text-faint)]">
                      Recent prompt-risk verdicts
                    </p>
                    {data.riskFlags.map((f) => (
                      <div
                        key={f.id}
                        className="flex items-center justify-between rounded-md border border-[var(--border-subtle)] p-3"
                      >
                        <div className="min-w-0">
                          <Badge variant={f.riskSeverity === "critical" ? "critical" : "warning"}>
                            {f.riskSeverity}
                          </Badge>
                          <span className="ml-2 text-xs text-[var(--text-muted)]">
                            {f.riskCategory ?? "prompt risk"}
                          </span>
                        </div>
                        <p className="text-xs text-[var(--text-faint)]">
                          {f.userEmail ?? "(unattributed)"} · {formatDateTime(f.timestamp)}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Lines Produced (7 days)</CardTitle>
            </CardHeader>
            <CardContent>
              {data.userLines.length === 0 ? (
                <p className="text-sm text-[var(--text-muted)]">
                  No line-count data yet. Lines of code are sourced from the
                  Cursor Admin API daily-usage sync (not the OTel hook) — connect
                  a team admin key in{" "}
                  <Link href="/settings/provider-admin" className="text-[var(--accent)] hover:underline">
                    Settings → Provider Admin APIs → Cursor
                  </Link>
                  .
                </p>
              ) : (
                <div className="space-y-2">
                  <div className="flex items-center justify-between border-b border-[var(--border-subtle)] pb-2 text-xs uppercase tracking-wider text-[var(--text-faint)]">
                    <span>User</span>
                    <span className="flex gap-6">
                      <span className="w-24 text-right">Accepted +</span>
                      <span className="w-24 text-right">Total +</span>
                      <span className="w-24 text-right">Total −</span>
                      <span className="w-16 text-right">Days</span>
                    </span>
                  </div>
                  {data.userLines.map((u) => (
                    <div
                      key={u.user}
                      className="flex items-center justify-between rounded-md border border-[var(--border-subtle)] p-3"
                    >
                      <p className="truncate text-sm font-medium">{u.user}</p>
                      <span className="flex gap-6 text-sm tabular-nums">
                        <span className="w-24 text-right font-semibold text-[var(--success)]">
                          {u.acceptedLinesAdded.toLocaleString("en-US")}
                        </span>
                        <span className="w-24 text-right text-[var(--text-muted)]">
                          {u.totalLinesAdded.toLocaleString("en-US")}
                        </span>
                        <span className="w-24 text-right text-[var(--text-muted)]">
                          {u.totalLinesDeleted.toLocaleString("en-US")}
                        </span>
                        <span className="w-16 text-right text-[var(--text-faint)]">
                          {u.activeDays}
                        </span>
                      </span>
                    </div>
                  ))}
                  <p className="pt-1 text-xs text-[var(--text-faint)]">
                    &ldquo;Accepted +&rdquo; = AI-suggested lines the user accepted (lines produced via Cursor).
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Recent Spans</CardTitle></CardHeader>
            <CardContent>
              <div className="space-y-2">
                {data.recentSpans.map((s) => (
                  <div
                    key={s.id}
                    className="flex items-center justify-between rounded-md border border-[var(--border-subtle)] p-3"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      {s.spanKind && (
                        <Badge variant="info" className="capitalize">{s.spanKind}</Badge>
                      )}
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">
                          {s.genAiToolName ?? s.spanName}
                          {s.hookEvent ? (
                            <span className="ml-2 font-mono text-xs text-[var(--text-faint)]">
                              {s.hookEvent}
                            </span>
                          ) : null}
                        </p>
                        <p className="text-xs text-[var(--text-muted)]">
                          {s.userEmail ?? "(unattributed)"}
                          {s.genAiModel ? ` · ${s.genAiModel}` : ""}
                          {` · ${formatDuration(s.durationMs)}`}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 text-right">
                      {s.riskSeverity && (
                        <Badge variant={s.riskSeverity === "critical" ? "critical" : "warning"}>
                          {s.riskSeverity}
                        </Badge>
                      )}
                      {s.success === false && <Badge variant="critical">error</Badge>}
                      <p className="text-xs text-[var(--text-faint)]">
                        {formatDateTime(s.timestamp)}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
