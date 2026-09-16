import Link from "next/link";
import { PageHeader } from "@/components/layout/page-header";
import { StatCard } from "@/components/dashboard/stat-card";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatCompactNumber, formatDate, formatDateTime } from "@/lib/utils";
import { loadCopilotDashboard, COPILOT_IDLE_SEAT_DAYS } from "@/lib/github-copilot-dashboard";
import { CursorUserFilter } from "@/components/oversight/cursor-user-filter";

function pct(value: number | null): string {
  if (value == null) return "—";
  return `${Math.round(value * 100)}%`;
}

function n(value: number | null | undefined): string {
  return value == null ? "—" : value.toLocaleString("en-US");
}

function BreakdownList({
  title,
  rows,
  keyLabel,
  empty,
}: {
  title: string;
  rows: { key: string; interactions: number; accepted: number; linesAccepted: number; acceptanceRate: number | null; users: number }[];
  keyLabel: string;
  empty: string;
}) {
  return (
    <Card>
      <CardHeader><CardTitle>{title}</CardTitle></CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-sm text-[var(--text-muted)]">{empty}</p>
        ) : (
          <div className="space-y-2">
            <div className="flex items-center justify-between border-b border-[var(--border-subtle)] pb-2 text-xs uppercase tracking-wider text-[var(--text-faint)]">
              <span>{keyLabel}</span>
              <span className="flex gap-4">
                <span className="w-20 text-right">Lines</span>
                <span className="w-16 text-right">Accept</span>
                <span className="w-14 text-right">Users</span>
              </span>
            </div>
            {rows.map((r) => (
              <div key={r.key} className="flex items-center justify-between rounded-md border border-[var(--border-subtle)] p-3">
                <p className="truncate text-sm font-mono">{r.key}</p>
                <span className="flex gap-4 text-sm tabular-nums">
                  <span className="w-20 text-right font-semibold text-[var(--success)]">{formatCompactNumber(r.linesAccepted)}</span>
                  <span className="w-16 text-right text-[var(--text-muted)]">{pct(r.acceptanceRate)}</span>
                  <span className="w-14 text-right text-[var(--text-faint)]">{r.users}</span>
                </span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default async function GitHubCopilotOversightPage({
  searchParams,
}: {
  searchParams: Promise<{ user?: string }>;
}) {
  const selectedUser = ((await searchParams).user ?? "").trim() || null;
  const data = await loadCopilotDashboard(selectedUser);
  const hasData = data.users.length > 0 || data.org != null;

  return (
    <div className="space-y-6">
      <PageHeader
        title="GitHub Copilot"
        description={`Per-developer Copilot activity and organization totals from the GitHub Copilot usage metrics reports. Last ${data.windowDays} days. Copilot is seat-licensed — there is no metered cost; reports land within two days.`}
      >
        <CursorUserFilter users={data.allUsers} initialUser={selectedUser ?? ""} />
      </PageHeader>

      {selectedUser && (
        <p className="text-xs text-[var(--text-muted)]">
          Showing activity for <span className="text-[var(--text-primary)]">{selectedUser}</span>. Organization totals, seats, and idle seats are not affected by the user filter.
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Active Developers"
          value={data.summary.activeUsers}
          description={
            data.summary.seats > 0
              ? `${data.summary.seats} seat${data.summary.seats === 1 ? "" : "s"} assigned · ${data.summary.daysWithData} day${data.summary.daysWithData === 1 ? "" : "s"} of data`
              : `${data.summary.daysWithData} day${data.summary.daysWithData === 1 ? "" : "s"} of data`
          }
          iconName="Users"
          variant={data.summary.activeUsers > 0 ? "success" : "default"}
        />
        <StatCard
          title="Lines Accepted"
          value={formatCompactNumber(data.summary.linesAccepted)}
          description={`${formatCompactNumber(data.summary.linesSuggested)} suggested · Copilot-produced lines that landed`}
          iconName="GitBranch"
          variant="info"
        />
        <StatCard
          title="Acceptance Rate"
          value={pct(data.summary.acceptanceRate)}
          description={`${formatCompactNumber(data.summary.codeAccepted)} of ${formatCompactNumber(data.summary.codeGenerated)} generations accepted`}
          iconName="Percent"
          variant="default"
        />
        <StatCard
          title="Interactions"
          value={formatCompactNumber(data.summary.interactions)}
          description={
            data.summary.tokens != null
              ? `${formatCompactNumber(data.summary.tokens)} CLI/app tokens${data.summary.creditsUsed != null ? ` · ${data.summary.creditsUsed} AI credits` : ""}`
              : "Explicit prompts sent to Copilot"
          }
          iconName="Activity"
          variant="default"
        />
      </div>

      {!hasData && (
        <Card>
          <CardContent className="py-10 text-center text-sm text-[var(--text-muted)]">
            {data.sync.lastRunError ? (
              <>
                The last GitHub Copilot sync failed: <span className="text-[var(--critical)]">{data.sync.lastRunError}</span>
              </>
            ) : (
              <>
                No Copilot usage data yet. Configure the GitHub token and organization / enterprise in{" "}
                <Link href="/settings/provider-admin" className="text-[var(--accent)] hover:underline">
                  Settings → Provider Admin APIs → GitHub Copilot
                </Link>
                , make sure the <em>Copilot usage metrics</em> policy is enabled in GitHub, and run a sync. Reports are published within two days of each UTC day.
              </>
            )}
          </CardContent>
        </Card>
      )}

      {hasData && (
        <>
          {data.org && (
            <div className="grid gap-6 lg:grid-cols-2">
              <Card>
                <CardHeader><CardTitle>Organization Adoption · {data.org.day}</CardTitle></CardHeader>
                <CardContent>
                  <div className="grid grid-cols-3 gap-4">
                    {[
                      { label: "Daily active", value: data.org.dailyActiveUsers },
                      { label: "Weekly active", value: data.org.weeklyActiveUsers },
                      { label: "Monthly active", value: data.org.monthlyActiveUsers },
                      { label: "Chat users (28d)", value: data.org.monthlyActiveChatUsers },
                      { label: "Agent users (28d)", value: data.org.monthlyActiveAgentUsers },
                      { label: "Seats", value: data.summary.seats },
                    ].map((s) => (
                      <div key={s.label} className="rounded-lg border border-[var(--border-subtle)] p-3">
                        <p className="text-[10px] uppercase tracking-wider text-[var(--text-faint)]">{s.label}</p>
                        <p className="mt-1 text-xl font-semibold tabular-nums">{n(s.value)}</p>
                      </div>
                    ))}
                  </div>
                  {data.adoptionPhases.length > 0 && (
                    <div className="mt-4 flex flex-wrap gap-2">
                      {data.adoptionPhases.map((p) => (
                        <Badge key={p.phase} variant="outline" className="text-[10px]">
                          {p.phase}: {p.users}
                        </Badge>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader><CardTitle>Pull Requests ({data.windowDays} days)</CardTitle></CardHeader>
                <CardContent>
                  {data.pullRequests28d ? (
                    <div className="grid grid-cols-3 gap-4">
                      {[
                        { label: "Created", value: data.pullRequests28d.created },
                        { label: "Created by Copilot", value: data.pullRequests28d.createdByCopilot },
                        { label: "Merged", value: data.pullRequests28d.merged },
                        { label: "Merged · Copilot-authored", value: data.pullRequests28d.mergedCreatedByCopilot },
                        { label: "Reviewed by Copilot", value: data.pullRequests28d.reviewedByCopilot },
                        { label: "Review suggestions applied", value: data.pullRequests28d.copilotAppliedSuggestions },
                      ].map((s) => (
                        <div key={s.label} className="rounded-lg border border-[var(--border-subtle)] p-3">
                          <p className="text-[10px] uppercase tracking-wider text-[var(--text-faint)]">{s.label}</p>
                          <p className="mt-1 text-xl font-semibold tabular-nums">{n(s.value)}</p>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-[var(--text-muted)]">No pull-request metrics in the synced organization report yet.</p>
                  )}
                  {data.org.pullRequests?.medianMinutesToMerge != null && (
                    <p className="mt-3 text-xs text-[var(--text-faint)]">
                      Latest day: median {Math.round(data.org.pullRequests.medianMinutesToMerge)} min to merge
                      {data.org.pullRequests.medianMinutesToMergeCopilotAuthored != null
                        ? ` · ${Math.round(data.org.pullRequests.medianMinutesToMergeCopilotAuthored)} min for Copilot-authored PRs`
                        : ""}
                      .
                    </p>
                  )}
                </CardContent>
              </Card>
            </div>
          )}

          <div className="grid gap-6 lg:grid-cols-2">
            <BreakdownList title="By Feature" rows={data.byFeature} keyLabel="Feature" empty="No per-feature breakdown yet." />
            <BreakdownList title="By IDE" rows={data.byIde} keyLabel="IDE" empty="No per-IDE breakdown yet." />
          </div>
          <div className="grid gap-6 lg:grid-cols-2">
            <BreakdownList title="By Model" rows={data.byModel} keyLabel="Model" empty="No per-model breakdown reported — GitHub only populates it for some features." />
            <BreakdownList title="By Language" rows={data.byLanguage} keyLabel="Language" empty="No per-language breakdown yet." />
          </div>

          {data.thirdPartyAgents.length > 0 && (
            <Card>
              <CardHeader><CardTitle>Third-Party Agents via Copilot</CardTitle></CardHeader>
              <CardContent>
                <p className="mb-3 text-xs text-[var(--text-muted)]">
                  Agent apps (for example Claude or Codex) used through Copilot. These are governed by the Copilot seat, not by a direct provider key — check they are registered AI systems.
                </p>
                <div className="space-y-2">
                  {data.thirdPartyAgents.map((a) => (
                    <div key={a.agent} className="flex items-center justify-between rounded-md border border-[var(--border-subtle)] p-3">
                      <p className="text-sm font-medium">{a.agent}</p>
                      <p className="text-sm text-[var(--text-muted)]">
                        {a.interactions.toLocaleString("en-US")} interactions · {a.users} user{a.users === 1 ? "" : "s"}
                      </p>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader><CardTitle>Developers ({data.windowDays} days)</CardTitle></CardHeader>
            <CardContent>
              {data.users.length === 0 ? (
                <p className="text-sm text-[var(--text-muted)]">No per-user rows in this window.</p>
              ) : (
                <div className="space-y-2">
                  <div className="flex items-center justify-between border-b border-[var(--border-subtle)] pb-2 text-xs uppercase tracking-wider text-[var(--text-faint)]">
                    <span>Developer</span>
                    <span className="flex gap-4">
                      <span className="w-20 text-right">Lines</span>
                      <span className="w-20 text-right">Prompts</span>
                      <span className="w-16 text-right">Accept</span>
                      <span className="w-12 text-right">Days</span>
                      <span className="w-24 text-right">Last active</span>
                    </span>
                  </div>
                  {data.users.map((u) => (
                    <Link
                      key={u.actor}
                      href={`/oversight/github-copilot?user=${encodeURIComponent(u.actor)}`}
                      className="flex items-center justify-between rounded-md border border-[var(--border-subtle)] p-3 transition-colors hover:border-[var(--accent)] hover:bg-[var(--bg-base)]"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{u.email ?? u.login}</p>
                        <p className="truncate text-xs text-[var(--text-muted)]">
                          @{u.login}
                          {u.ides.length > 0 ? ` · ${u.ides.join(", ")}` : ""}
                          {u.phase ? ` · ${u.phase}` : ""}
                        </p>
                      </div>
                      <span className="flex gap-4 text-sm tabular-nums">
                        <span className="w-20 text-right font-semibold text-[var(--success)]">{formatCompactNumber(u.linesAccepted)}</span>
                        <span className="w-20 text-right text-[var(--text-muted)]">{formatCompactNumber(u.interactions)}</span>
                        <span className="w-16 text-right text-[var(--text-muted)]">{pct(u.acceptanceRate)}</span>
                        <span className="w-12 text-right text-[var(--text-faint)]">{u.activeDays}</span>
                        <span className="w-24 text-right text-xs text-[var(--text-faint)]">{u.lastActiveDay ? formatDate(u.lastActiveDay) : "—"}</span>
                      </span>
                    </Link>
                  ))}
                  <p className="pt-1 text-xs text-[var(--text-faint)]">
                    Developers keyed by GitHub login (no seat email) appear as @login and are not merged into Usage by Person until an identity source maps them to an email.
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader><CardTitle>Idle Seats</CardTitle></CardHeader>
              <CardContent>
                {data.idleSeats.length === 0 ? (
                  <p className="text-sm text-[var(--text-muted)]">
                    Every assigned seat has Copilot activity in the last {COPILOT_IDLE_SEAT_DAYS} days.
                  </p>
                ) : (
                  <div className="space-y-2">
                    <p className="text-xs text-[var(--text-muted)]">
                      Seats with no activity for {COPILOT_IDLE_SEAT_DAYS}+ days (from the seats endpoint&apos;s <code>last_activity_at</code>). Candidates for reclaiming or for an access review.
                    </p>
                    {data.idleSeats.map((s) => (
                      <div key={s.actor} className="flex items-center justify-between rounded-md border border-[var(--border-subtle)] p-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">{s.email ?? `@${s.login}`}</p>
                          <p className="text-xs text-[var(--text-muted)]">
                            {s.planType ?? "seat"}{s.lastActivityEditor ? ` · ${s.lastActivityEditor}` : ""}
                          </p>
                        </div>
                        <Badge variant={s.lastActivityAt ? "warning" : "critical"}>
                          {s.lastActivityAt ? `last ${formatDate(s.lastActivityAt)}` : "never active"}
                        </Badge>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle>Daily Activity</CardTitle></CardHeader>
              <CardContent>
                {data.daily.length === 0 ? (
                  <p className="text-sm text-[var(--text-muted)]">No daily rows yet.</p>
                ) : (
                  <div className="space-y-1">
                    {data.daily.slice(-14).map((d) => (
                      <div key={d.day} className="flex items-center justify-between text-xs">
                        <span className="w-24 font-mono text-[var(--text-muted)]">{d.day}</span>
                        <span className="flex gap-4 tabular-nums">
                          <span className="w-16 text-right">{d.activeUsers} dev{d.activeUsers === 1 ? "" : "s"}</span>
                          <span className="w-20 text-right text-[var(--text-muted)]">{formatCompactNumber(d.interactions)} prompts</span>
                          <span className="w-20 text-right text-[var(--success)]">{formatCompactNumber(d.linesAccepted)} lines</span>
                        </span>
                      </div>
                    ))}
                  </div>
                )}
                <p className="mt-3 text-xs text-[var(--text-faint)]">
                  Sync: {data.sync.lastRunAt ? `${data.sync.lastRunStatus?.toLowerCase() ?? "ran"} ${formatDateTime(data.sync.lastRunAt)}` : "never run"}
                  {data.sync.watermark ? ` · watermark ${formatDate(data.sync.watermark)}` : ""}
                  {data.sync.pendingDays.length > 0 ? ` · ${data.sync.pendingDays.length} day${data.sync.pendingDays.length === 1 ? "" : "s"} not yet published by GitHub` : ""}
                </p>
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
