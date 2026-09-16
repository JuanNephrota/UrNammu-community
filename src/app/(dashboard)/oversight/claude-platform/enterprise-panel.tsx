import Link from "next/link";
import { StatCard } from "@/components/dashboard/stat-card";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCompactNumber, formatDateTime } from "@/lib/utils";
import type { ClaudeEnterpriseDashboard } from "@/lib/claude-enterprise-dashboard";

const usd = (v: number) => v.toLocaleString("en-US", { style: "currency", currency: "USD" });

function Bar({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? Math.max(2, Math.round((value / max) * 100)) : 0;
  return (
    <div className="h-1.5 w-full rounded-full bg-[var(--bg-base)]">
      <div className="h-1.5 rounded-full bg-[var(--accent)]" style={{ width: `${pct}%` }} />
    </div>
  );
}

export function ClaudeEnterprisePanel({ data }: { data: ClaudeEnterpriseDashboard }) {
  const { latest, sync } = data;
  const maxDau = Math.max(1, ...data.dailyActive.map((d) => d.dau));
  const recentDaily = data.dailyActive.slice(-14);

  return (
    <div className="space-y-6">
      {!data.configured.analytics && !data.configured.compliance && (
        <Card>
          <CardContent className="py-10 text-center text-sm text-[var(--text-muted)]">
            Neither the Claude Enterprise Analytics API nor the Anthropic Compliance API is connected. Add the keys under{" "}
            <Link href="/integrations" className="text-[var(--accent)] hover:underline">
              Integrations → Provider Telemetry
            </Link>{" "}
            (an Analytics API key with <code className="text-xs">read:analytics</code>; a Compliance Access Key with{" "}
            <code className="text-xs">read:compliance_activities</code> and <code className="text-xs">read:compliance_user_data</code>).
          </CardContent>
        </Card>
      )}

      {(data.configured.analytics || data.configured.compliance) && !data.hasData && (
        <Card>
          <CardContent className="py-10 text-center text-sm text-[var(--text-muted)]">
            Connected, but nothing has been synced yet. The <code className="text-xs">claude_enterprise</code> and{" "}
            <code className="text-xs">anthropic_compliance</code> syncs run hourly once due; trigger one from{" "}
            <Link href="/settings/provider-admin" className="text-[var(--accent)] hover:underline">
              Settings → Provider Admin APIs
            </Link>
            . Analytics data lags about a day.
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-6">
        <StatCard
          title="Daily Active"
          value={latest?.dau ?? "—"}
          description={latest ? `As of ${latest.date}` : "No summary synced yet"}
          iconName="Users"
          variant="info"
        />
        <StatCard title="Weekly Active" value={latest?.wau ?? "—"} description="Rolling 7 days" iconName="Activity" />
        <StatCard title="Monthly Active" value={latest?.mau ?? "—"} description="Rolling 30 days" iconName="Activity" />
        <StatCard
          title="Seats"
          value={latest?.seats ?? "—"}
          description={
            latest?.pendingInvites != null
              ? `${latest.pendingInvites} pending invite${latest.pendingInvites === 1 ? "" : "s"}`
              : latest?.seats != null && latest?.mau != null && latest.seats > 0
                ? `${Math.round((latest.mau / latest.seats) * 100)}% active this month`
                : "Licensed seats"
          }
          iconName="FileCheck"
          variant="info"
        />
        <StatCard
          title="Enterprise Cost"
          value={usd(data.totalCost)}
          description={`${data.peopleWithActivity} people · last ${data.windowDays} days`}
          iconName="DollarSign"
          variant="success"
        />
        <StatCard
          title="Compliance Alerts"
          value={data.compliance.openAlerts}
          description={`${formatCompactNumber(data.compliance.activities)} feed activities in ${data.windowDays} days`}
          iconName="ShieldAlert"
          variant={data.compliance.openAlerts > 0 ? "warning" : "default"}
          href="/alerts?source=anthropic_compliance"
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Daily Active Users (last 14 days)</CardTitle>
          </CardHeader>
          <CardContent>
            {recentDaily.length === 0 ? (
              <p className="text-sm text-[var(--text-muted)]">No summary rows yet — populated by the Analytics summaries endpoint.</p>
            ) : (
              <div className="space-y-2">
                {recentDaily.map((d) => (
                  <div key={d.date} className="grid grid-cols-[88px_1fr_120px] items-center gap-3 text-sm">
                    <span className="text-xs text-[var(--text-muted)] tabular-nums">{d.date}</span>
                    <Bar value={d.dau} max={maxDau} />
                    <span className="text-right text-xs tabular-nums text-[var(--text-secondary)]">
                      {d.dau} DAU{d.wau != null ? ` · ${d.wau} WAU` : ""}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Active Users by Product</CardTitle>
          </CardHeader>
          <CardContent>
            {data.products.every((p) => p.activeUsers === 0) ? (
              <p className="text-sm text-[var(--text-muted)]">No per-user activity yet — populated by the Analytics users endpoint.</p>
            ) : (
              <div className="space-y-2">
                <div className="flex items-center justify-between border-b border-[var(--border-subtle)] pb-2 text-xs uppercase tracking-wider text-[var(--text-faint)]">
                  <span>Product</span>
                  <span className="flex gap-6">
                    <span className="w-20 text-right">30d users</span>
                    <span className="w-20 text-right">7d users</span>
                    <span className="w-24 text-right">Messages</span>
                    <span className="w-20 text-right">Cost</span>
                  </span>
                </div>
                {data.products.map((p) => (
                  <div key={p.product} className="flex items-center justify-between rounded-md border border-[var(--border-subtle)] p-3">
                    <p className="text-sm font-medium">{p.label}</p>
                    <span className="flex gap-6 text-sm tabular-nums">
                      <span className="w-20 text-right font-semibold">{p.activeUsers}</span>
                      <span className="w-20 text-right text-[var(--text-muted)]">{p.activeUsersRecent}</span>
                      <span className="w-24 text-right text-[var(--text-muted)]">{p.requests > 0 ? formatCompactNumber(p.requests) : "—"}</span>
                      <span className="w-20 text-right text-[var(--text-muted)]">{p.cost > 0 ? usd(p.cost) : "—"}</span>
                    </span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Top People by Enterprise Cost</CardTitle>
          </CardHeader>
          <CardContent>
            {data.topUsers.length === 0 ? (
              <p className="text-sm text-[var(--text-muted)]">No per-user rows yet.</p>
            ) : (
              <div className="space-y-2">
                {data.topUsers.map((u) => (
                  <div key={u.actorExternalId} className="flex items-center justify-between rounded-md border border-[var(--border-subtle)] p-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{u.actorName ?? u.actorExternalId}</p>
                      <p className="truncate text-xs text-[var(--text-muted)]">
                        {u.actorName ? `${u.actorExternalId} · ` : ""}
                        {u.activeDays} active day{u.activeDays === 1 ? "" : "s"} · {u.products.map((p) => p.replace(/_/g, " ")).join(", ")}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-semibold tabular-nums">{u.cost > 0 ? usd(u.cost) : "—"}</p>
                      {u.requests > 0 && <p className="text-xs text-[var(--text-muted)]">{formatCompactNumber(u.requests)} messages</p>}
                    </div>
                  </div>
                ))}
              </div>
            )}
            <p className="mt-3 text-xs text-[var(--text-faint)]">
              Per-person detail across every surface lives in{" "}
              <Link href="/oversight/people" className="text-[var(--accent)] hover:underline">
                Usage by Person
              </Link>
              .
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Claude App Sessions (Compliance API)</CardTitle>
          </CardHeader>
          <CardContent>
            {data.sessions.length === 0 ? (
              <p className="text-sm text-[var(--text-muted)]">
                No session metadata in the window. Sessions need a Compliance Access Key with{" "}
                <code className="text-xs">read:compliance_user_data</code>; metadata only, never transcripts.
              </p>
            ) : (
              <div className="space-y-2">
                {data.sessions.map((s) => (
                  <div key={s.productSurface} className="flex items-center justify-between rounded-md border border-[var(--border-subtle)] p-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium capitalize">{s.productSurface.replace(/_/g, " ")}</p>
                      <p className="text-xs text-[var(--text-muted)]">
                        {s.users} {s.users === 1 ? "person" : "people"}
                        {s.lastActivityAt ? ` · last ${formatDateTime(s.lastActivityAt)}` : ""}
                      </p>
                    </div>
                    <p className="text-sm font-semibold tabular-nums">{s.sessions} sessions</p>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Activity Feed (last {data.windowDays} days)</CardTitle>
          </CardHeader>
          <CardContent>
            {data.compliance.byType.length === 0 ? (
              <p className="text-sm text-[var(--text-muted)]">
                No compliance activities ingested yet. The feed has no history before it was enabled in the Anthropic Console.
              </p>
            ) : (
              <div className="space-y-2">
                {data.compliance.byType.map((row) => (
                  <div key={row.type} className="flex items-center justify-between rounded-md border border-[var(--border-subtle)] p-3">
                    <code className="text-xs">{row.type}</code>
                    <span className="text-sm font-semibold tabular-nums">{row.count.toLocaleString("en-US")}</span>
                  </div>
                ))}
                {data.compliance.latestActivityAt && (
                  <p className="pt-1 text-xs text-[var(--text-faint)]">Newest activity {formatDateTime(data.compliance.latestActivityAt)}.</p>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Sync Health</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {[
              { label: "Claude Enterprise analytics", health: sync.analytics, configured: data.configured.analytics },
              { label: "Anthropic Compliance feed", health: sync.compliance, configured: data.configured.compliance },
            ].map((row) => (
              <div key={row.label} className="flex items-center justify-between rounded-md border border-[var(--border-subtle)] p-3">
                <div>
                  <p className="text-sm font-medium">{row.label}</p>
                  <p className="text-xs text-[var(--text-muted)]">
                    {!row.configured
                      ? "Not configured"
                      : !row.health
                        ? "No sync has run yet"
                        : row.health.lastSuccessAt
                          ? `Last success ${formatDateTime(row.health.lastSuccessAt)}${row.health.historyFrom ? ` · history from ${row.health.historyFrom.toISOString().slice(0, 10)}` : ""}`
                          : "No successful sync yet"}
                  </p>
                  {row.health?.errorMessage && (
                    <p className="mt-1 text-xs text-[var(--critical)]">{row.health.errorMessage}</p>
                  )}
                </div>
                <Badge variant={!row.configured ? "outline" : row.health?.fresh ? "success" : "warning"}>
                  {!row.configured ? "Off" : row.health?.fresh ? "Fresh" : "Stale"}
                </Badge>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
