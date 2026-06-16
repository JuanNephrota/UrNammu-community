import Link from "next/link";
import { StatCard } from "@/components/dashboard/stat-card";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { eventDetail, surfaceLabel } from "@/lib/claude-code-events";
import { ClaudeCodeUserFilter } from "@/components/oversight/claude-code-user-filter";
import {
  getSevenDaysAgo,
  loadLiveTelemetry,
  loadCostAttribution,
  loadEventActivity,
  loadRecentEvents,
  loadOtelUsage,
  loadOtelUserList,
  hasAttributedData,
  UNATTRIBUTED,
  type DimCost,
} from "@/lib/claude-code-dashboard";

function CostBreakdownCard({
  title,
  rows,
  total,
}: {
  title: string;
  rows: DimCost[];
  total: number;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-xs text-[var(--text-muted)]">No data in window.</p>
        ) : (
          <div className="space-y-2.5">
            {rows.map((r) => {
              const pct = total > 0 ? (r.cost / total) * 100 : 0;
              return (
                <div key={r.dim}>
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="truncate text-[var(--text-primary)]" title={r.dim}>
                      {r.dim}
                    </span>
                    <span className="shrink-0 tabular-nums text-[var(--text-muted)]">
                      ${r.cost.toFixed(2)} · {pct.toFixed(0)}%
                    </span>
                  </div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-[var(--bg-deep)]">
                    <div
                      className="h-full rounded-full bg-[var(--accent)]"
                      style={{ width: `${pct.toFixed(1)}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * The full Claude Code analytics body (everything below the page header),
 * sourced from OTel. Reused by the main analytics page (surface = null) and
 * the Cowork dashboard (surface = "local-agent").
 */
export async function ClaudeCodeAnalyticsView({
  surface = null,
  userEmail = null,
  showUserFilter = true,
}: {
  surface?: string | null;
  userEmail?: string | null;
  showUserFilter?: boolean;
}) {
  const since = getSevenDaysAgo();
  const [live, attribution, activity, recentEvents, usage, userList] =
    await Promise.all([
      loadLiveTelemetry(userEmail, surface),
      loadCostAttribution(since, userEmail, surface),
      loadEventActivity(since, userEmail, surface),
      loadRecentEvents(since, userEmail, surface),
      loadOtelUsage(since, userEmail, surface),
      loadOtelUserList(since, surface),
    ]);

  const { users, totals } = usage;
  const toolAcceptRate =
    totals.toolAccepted + totals.toolRejected > 0
      ? ((totals.toolAccepted / (totals.toolAccepted + totals.toolRejected)) * 100).toFixed(1)
      : "—";

  const auditHref = surface
    ? `/oversight/claude-code/events?surface=${encodeURIComponent(surface)}`
    : "/oversight/claude-code/events";

  const decisionTotal = activity.decisionAccept + activity.decisionReject;
  const acceptRate =
    decisionTotal > 0
      ? ((activity.decisionAccept / decisionTotal) * 100).toFixed(0)
      : "—";

  return (
    <>
      {(showUserFilter || userEmail) && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] px-4 py-3">
          {showUserFilter ? (
            <ClaudeCodeUserFilter users={userList} initialUser={userEmail ?? ""} />
          ) : (
            <span />
          )}
          {userEmail && (
            <span className="text-xs text-[var(--text-muted)]">
              Showing data for{" "}
              <span className="font-medium text-[var(--text-primary)]">{userEmail}</span>
            </span>
          )}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <span
              className={`inline-block h-2 w-2 rounded-full ${
                live.dataPoints > 0 ? "bg-[var(--success)]" : "bg-[var(--text-faint)]"
              }`}
            />
            Live telemetry (last 60 minutes)
          </CardTitle>
        </CardHeader>
        <CardContent>
          {live.dataPoints === 0 ? (
            <p className="text-sm text-[var(--text-muted)]">
              No OTel data points received in the last hour for this view.
            </p>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-[var(--text-faint)]">Data points</p>
                <p className="text-2xl font-bold tabular-nums mt-1" style={{ fontFamily: "var(--font-display)" }}>
                  {live.dataPoints.toLocaleString("en-US")}
                </p>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-[var(--text-faint)]">Active sessions</p>
                <p className="text-2xl font-bold tabular-nums mt-1" style={{ fontFamily: "var(--font-display)" }}>
                  {live.activeSessions}
                </p>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-[var(--text-faint)]">Active users</p>
                <p className="text-2xl font-bold tabular-nums mt-1" style={{ fontFamily: "var(--font-display)" }}>
                  {live.activeUsers}
                </p>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-[var(--text-faint)]">Tokens</p>
                <p className="text-2xl font-bold tabular-nums mt-1" style={{ fontFamily: "var(--font-display)" }}>
                  {((live.inputTokens + live.outputTokens) / 1000).toFixed(0)}k
                </p>
                <p className="mt-1 text-xs text-[var(--text-muted)]">
                  {(live.inputTokens / 1000).toFixed(0)}k in / {(live.outputTokens / 1000).toFixed(0)}k out
                  {live.cacheTokens > 0 && (
                    <span className="text-[var(--text-faint)]"> +{(live.cacheTokens / 1000).toFixed(0)}k cached</span>
                  )}
                </p>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-[var(--text-faint)]">Est. cost</p>
                <p className="text-2xl font-bold tabular-nums mt-1" style={{ fontFamily: "var(--font-display)" }}>
                  ${live.totalCost.toFixed(2)}
                </p>
              </div>
            </div>
          )}
          {live.latestReceivedAt && (
            <p className="mt-4 text-xs text-[var(--text-faint)]">
              Last data point received {live.latestReceivedAt.toLocaleString("en-US")}
            </p>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <StatCard title="Sessions" value={totals.sessions} iconName="Terminal" />
        <StatCard title="Lines Added" value={totals.linesAdded.toLocaleString("en-US")} iconName="Plus" variant="success" />
        <StatCard title="Commits" value={totals.commits} iconName="GitCommitHorizontal" />
        <StatCard title="Pull Requests" value={totals.prs} iconName="GitPullRequest" variant="info" />
        <StatCard title="Est. Cost" value={`$${totals.cost.toFixed(2)}`} iconName="DollarSign" variant="warning" />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardContent className="pt-6">
            <p className="text-xs font-semibold uppercase tracking-wider text-[var(--text-faint)]">Token Volume</p>
            <p className="text-2xl font-bold tabular-nums mt-1" style={{ fontFamily: "var(--font-display)" }}>
              {((totals.inputTokens + totals.outputTokens) / 1000).toFixed(0)}k
            </p>
            <p className="mt-1 text-xs text-[var(--text-muted)]">
              {(totals.inputTokens / 1000).toFixed(0)}k in / {(totals.outputTokens / 1000).toFixed(0)}k out
              {totals.cacheTokens > 0 && (
                <span className="text-[var(--text-faint)]"> + {(totals.cacheTokens / 1000).toFixed(0)}k cached</span>
              )}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-xs font-semibold uppercase tracking-wider text-[var(--text-faint)]">Lines Removed</p>
            <p className="text-2xl font-bold tabular-nums mt-1" style={{ fontFamily: "var(--font-display)" }}>{totals.linesRemoved.toLocaleString("en-US")}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-xs font-semibold uppercase tracking-wider text-[var(--text-faint)]">Tool Accept Rate</p>
            <p className="text-2xl font-bold tabular-nums mt-1" style={{ fontFamily: "var(--font-display)" }}>{toolAcceptRate}%</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-xs font-semibold uppercase tracking-wider text-[var(--text-faint)]">Active Users</p>
            <p className="text-2xl font-bold tabular-nums mt-1" style={{ fontFamily: "var(--font-display)" }}>{users.length}</p>
          </CardContent>
        </Card>
      </div>

      <div className="space-y-4">
        <div className="flex items-baseline justify-between">
          <h2 className="text-lg font-semibold text-[var(--text-primary)]" style={{ fontFamily: "var(--font-display)" }}>
            Cost Attribution (Last 7 Days)
          </h2>
          <span className="text-sm tabular-nums text-[var(--text-muted)]">${attribution.totalCost.toFixed(2)} total</span>
        </div>

        {attribution.totalCost === 0 ? (
          <Card>
            <CardContent className="py-8 text-center text-sm text-[var(--text-muted)]">
              No live cost telemetry in the last 7 days for this view.
            </CardContent>
          </Card>
        ) : (
          <>
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">By Model</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr>
                        {["Model", "Cost", "Share", "Input", "Output", "Cache"].map((h) => (
                          <th key={h} className="px-3 py-2 text-left text-[10px] font-bold uppercase tracking-wider text-[var(--text-faint)]">
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {attribution.byModel.map((m) => {
                        const pct = attribution.totalCost > 0 ? (m.cost / attribution.totalCost) * 100 : 0;
                        return (
                          <tr key={m.model} className="border-t border-[var(--border-subtle)]">
                            <td className="px-3 py-2 font-medium text-[var(--text-primary)]">{m.model}</td>
                            <td className="px-3 py-2 tabular-nums font-medium">${m.cost.toFixed(2)}</td>
                            <td className="px-3 py-2 tabular-nums text-[var(--text-muted)]">{pct.toFixed(0)}%</td>
                            <td className="px-3 py-2 tabular-nums text-[var(--text-muted)]">{(m.input / 1000).toFixed(0)}k</td>
                            <td className="px-3 py-2 tabular-nums text-[var(--text-muted)]">{(m.output / 1000).toFixed(0)}k</td>
                            <td className="px-3 py-2 tabular-nums text-[var(--text-faint)]">{(m.cache / 1000).toFixed(0)}k</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {hasAttributedData(attribution.bySurface) && (
                <CostBreakdownCard
                  title="By Surface (CLI / Cowork / …)"
                  rows={attribution.bySurface.map((r) => ({
                    ...r,
                    dim: r.dim === UNATTRIBUTED ? UNATTRIBUTED : surfaceLabel(r.dim),
                  }))}
                  total={attribution.totalCost}
                />
              )}
              <CostBreakdownCard title="By Query Source" rows={attribution.byQuerySource} total={attribution.totalCost} />
              <CostBreakdownCard title="By Effort Level" rows={attribution.byEffort} total={attribution.totalCost} />
              {hasAttributedData(attribution.bySkill) && (
                <CostBreakdownCard title="By Skill" rows={attribution.bySkill} total={attribution.totalCost} />
              )}
              {hasAttributedData(attribution.byMcpServer) && (
                <CostBreakdownCard title="By MCP Server" rows={attribution.byMcpServer} total={attribution.totalCost} />
              )}
              {hasAttributedData(attribution.byAgent) && (
                <CostBreakdownCard title="By Subagent" rows={attribution.byAgent} total={attribution.totalCost} />
              )}
            </div>
          </>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Users (Last 7 Days)</CardTitle>
        </CardHeader>
        <CardContent>
          {users.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)] py-8 text-center">
              No Claude Code telemetry in the last 7 days for this view.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    {["User", "Sessions", "Lines +/-", "Commits", "PRs", "Accept Rate", "Tokens", "Est. Cost"].map((h) => (
                      <th key={h} className="px-3 py-3 text-left text-[10px] font-bold uppercase tracking-wider text-[var(--text-faint)]">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => {
                    const rate = u.toolAccepted + u.toolRejected > 0
                      ? ((u.toolAccepted / (u.toolAccepted + u.toolRejected)) * 100).toFixed(0)
                      : "—";
                    return (
                      <tr key={u.email} className="border-t border-[var(--border-subtle)]">
                        <td className="px-3 py-3 font-medium text-[var(--text-primary)]">{u.email}</td>
                        <td className="px-3 py-3 tabular-nums">{u.sessions}</td>
                        <td className="px-3 py-3 tabular-nums">
                          <span className="text-[var(--success)]">+{u.linesAdded.toLocaleString("en-US")}</span>
                          {" / "}
                          <span className="text-[var(--critical)]">-{u.linesRemoved.toLocaleString("en-US")}</span>
                        </td>
                        <td className="px-3 py-3 tabular-nums">{u.commits}</td>
                        <td className="px-3 py-3 tabular-nums">{u.prs}</td>
                        <td className="px-3 py-3">
                          <Badge variant={Number(rate) >= 80 ? "success" : Number(rate) >= 50 ? "warning" : "default"}>
                            {rate}%
                          </Badge>
                        </td>
                        <td className="px-3 py-3 tabular-nums text-[var(--text-muted)]">
                          {((u.inputTokens + u.outputTokens) / 1000).toFixed(0)}k
                          {u.cacheTokens > 0 && (
                            <span className="text-[var(--text-faint)]"> +{(u.cacheTokens / 1000).toFixed(0)}k</span>
                          )}
                        </td>
                        <td className="px-3 py-3 tabular-nums font-medium">${u.cost.toFixed(2)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="space-y-4">
        <div className="flex items-baseline justify-between">
          <h2 className="text-lg font-semibold text-[var(--text-primary)]" style={{ fontFamily: "var(--font-display)" }}>
            Activity &amp; Audit (Last 7 Days)
          </h2>
          <span className="text-sm tabular-nums text-[var(--text-muted)]">
            {activity.totalEvents.toLocaleString("en-US")} events
          </span>
        </div>

        {activity.totalEvents === 0 ? (
          <Card>
            <CardContent className="py-8 text-center text-sm text-[var(--text-muted)]">
              No event telemetry for this view yet. Metadata-only (tool names,
              permission decisions, durations, API errors) — no prompt or code
              content is ever stored.
            </CardContent>
          </Card>
        ) : (
          <>
            <div className="flex flex-wrap gap-2">
              {activity.byType.map((t) => (
                <Badge key={t.name} variant="default">
                  {t.name} · {t.count.toLocaleString("en-US")}
                </Badge>
              ))}
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">Permission Decisions</CardTitle>
                </CardHeader>
                <CardContent>
                  {decisionTotal === 0 ? (
                    <p className="text-xs text-[var(--text-muted)]">No tool-permission decisions recorded.</p>
                  ) : (
                    <>
                      <div className="flex items-end gap-6">
                        <div>
                          <p className="text-2xl font-bold tabular-nums" style={{ fontFamily: "var(--font-display)" }}>{acceptRate}%</p>
                          <p className="text-xs text-[var(--text-faint)]">accept rate</p>
                        </div>
                        <div className="text-xs text-[var(--text-muted)]">
                          <span className="text-[var(--success)]">{activity.decisionAccept.toLocaleString("en-US")} accepted</span>
                          {" · "}
                          <span className="text-[var(--critical)]">{activity.decisionReject.toLocaleString("en-US")} rejected</span>
                        </div>
                      </div>
                      {activity.topRejectedTools.length > 0 && (
                        <div className="mt-4">
                          <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-[var(--text-faint)]">Most-rejected tools</p>
                          <ul className="space-y-1 text-xs">
                            {activity.topRejectedTools.map((r) => (
                              <li key={r.tool} className="flex justify-between">
                                <span className="text-[var(--text-primary)]">{r.tool}</span>
                                <span className="tabular-nums text-[var(--text-muted)]">{r.count}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">API Errors</CardTitle>
                </CardHeader>
                <CardContent>
                  {activity.apiErrors.length === 0 ? (
                    <p className="text-xs text-[var(--text-muted)]">No API errors recorded. 🎉</p>
                  ) : (
                    <ul className="space-y-1 text-xs">
                      {activity.apiErrors.map((e) => (
                        <li key={e.label} className="flex justify-between gap-2">
                          <span className="truncate text-[var(--text-primary)]" title={e.label}>{e.label}</span>
                          <span className="shrink-0 tabular-nums text-[var(--warning)]">{e.count}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </CardContent>
              </Card>
            </div>

            {activity.toolUsage.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">Tool Usage</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr>
                          {["Tool", "Calls", "Success Rate", "Avg Duration"].map((h) => (
                            <th key={h} className="px-3 py-2 text-left text-[10px] font-bold uppercase tracking-wider text-[var(--text-faint)]">
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {activity.toolUsage.map((t) => (
                          <tr key={t.tool} className="border-t border-[var(--border-subtle)]">
                            <td className="px-3 py-2 font-medium text-[var(--text-primary)]">{t.tool}</td>
                            <td className="px-3 py-2 tabular-nums">{t.calls.toLocaleString("en-US")}</td>
                            <td className="px-3 py-2 tabular-nums text-[var(--text-muted)]">
                              {t.successRate == null ? "—" : `${t.successRate.toFixed(0)}%`}
                            </td>
                            <td className="px-3 py-2 tabular-nums text-[var(--text-muted)]">
                              {t.avgMs == null ? "—" : t.avgMs >= 1000 ? `${(t.avgMs / 1000).toFixed(1)}s` : `${t.avgMs.toFixed(0)}ms`}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            )}

            {recentEvents.length > 0 && (
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-sm">
                      Recent Events
                      <span className="ml-2 font-normal text-[var(--text-faint)]">
                        latest {recentEvents.length}
                        {activity.totalEvents > recentEvents.length
                          ? ` of ${activity.totalEvents.toLocaleString("en-US")}`
                          : ""}
                      </span>
                    </CardTitle>
                    <Link href={auditHref} className="text-xs font-medium text-[var(--accent)] hover:underline">
                      Full audit log →
                    </Link>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="max-h-[28rem] overflow-auto">
                    <table className="w-full text-sm">
                      <thead className="sticky top-0 bg-[var(--bg-surface)]">
                        <tr>
                          {["Time", "Event", "Risk", "Source", "User", "Detail", "Session"].map((h) => (
                            <th key={h} className="px-3 py-2 text-left text-[10px] font-bold uppercase tracking-wider text-[var(--text-faint)]">
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {recentEvents.map((e) => (
                          <tr key={e.id} className="border-t border-[var(--border-subtle)]">
                            <td className="whitespace-nowrap px-3 py-2 tabular-nums text-[var(--text-muted)]">
                              {e.timestamp.toLocaleString("en-US")}
                            </td>
                            <td className="px-3 py-2">
                              <Badge
                                variant={
                                  e.eventName === "api_error" || e.decision === "reject" || e.success === false
                                    ? "warning"
                                    : "default"
                                }
                              >
                                {e.eventName}
                              </Badge>
                            </td>
                            <td className="px-3 py-2">
                              {e.riskSeverity ? (
                                <Badge variant={e.riskSeverity === "critical" ? "critical" : "warning"} title={e.riskCategory ?? undefined}>
                                  {e.riskSeverity}
                                </Badge>
                              ) : (
                                <span className="text-[var(--text-faint)]">—</span>
                              )}
                            </td>
                            <td className="whitespace-nowrap px-3 py-2 text-[var(--text-muted)]">
                              {e.entrypoint === "local-agent" ? (
                                <Badge variant="info">Cowork</Badge>
                              ) : (
                                surfaceLabel(e.entrypoint)
                              )}
                            </td>
                            <td className="whitespace-nowrap px-3 py-2 text-[var(--text-muted)]">{e.userEmail ?? "—"}</td>
                            <td className="px-3 py-2 text-[var(--text-primary)]">{eventDetail(e) || "—"}</td>
                            <td className="px-3 py-2 font-mono text-[11px] text-[var(--text-faint)]">
                              {e.sessionId ? e.sessionId.slice(0, 8) : "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            )}
          </>
        )}
      </div>
    </>
  );
}
