import { Activity } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { HelpHint } from "@/components/help/help-hint";
import { RecomputeBaselineButton } from "@/components/agents/recompute-baseline-button";
import { formatDateTime } from "@/lib/utils";
import { MIN_BASELINE_ACTIVE_DAYS, type AgentBaselineStats, type DriftFinding } from "@/lib/agent-baseline";

const fmtHour = (h: number) => `${String(h).padStart(2, "0")}:00`;

/**
 * What "normal" looks like for this agent over the trailing window, and
 * whether the last 24 hours departed from it.
 */
export function AgentBaselineCard({
  agentId,
  baseline,
  canOperate,
}: {
  agentId: string;
  baseline: {
    stats: AgentBaselineStats;
    activeDays: number;
    computedAt: Date | string;
    lastEvaluatedAt: Date | string | null;
    findings: DriftFinding[];
  } | null;
  canOperate: boolean;
}) {
  const stats = baseline?.stats ?? null;
  const mature = (baseline?.activeDays ?? 0) >= MIN_BASELINE_ACTIVE_DAYS;
  const findings = baseline?.findings ?? [];

  return (
    <Card id="baseline" className="scroll-mt-6">
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center justify-between gap-2">
          <span className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-[var(--accent)]" />
            Behaviour Baseline
            <HelpHint hint="agent_baseline" />
          </span>
          <span className="flex items-center gap-2">
            {baseline ? (
              <Badge variant={!mature ? "outline" : findings.length ? "critical" : "success"}>
                {!mature
                  ? `Learning · ${baseline.activeDays}/${MIN_BASELINE_ACTIVE_DAYS} active days`
                  : findings.length
                    ? `${findings.length} drift finding${findings.length === 1 ? "" : "s"}`
                    : "Within baseline"}
              </Badge>
            ) : (
              <Badge variant="outline">No baseline yet</Badge>
            )}
            {canOperate && <RecomputeBaselineButton agentId={agentId} />}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {!stats ? (
          <p className="text-[var(--text-muted)]">
            Computed daily from the agent&apos;s attributed proxy traffic (requests, tool calls, models, callers, hours).
            Nothing attributed yet, or the daily job has not run since this agent appeared. Recompute to build it now.
          </p>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {[
                ["Requests / day", `${stats.requestsPerDay.mean.toFixed(1)}`, `max ${stats.requestsPerDay.max}`],
                ["Tool calls / day", `${stats.toolCallsPerDay.mean.toFixed(1)}`, `max ${stats.toolCallsPerDay.max}`],
                ["Denial rate", `${Math.round(stats.denialRate * 100)}%`, `review ${Math.round(stats.reviewRate * 100)}%`],
                [
                  "Active hours (UTC)",
                  stats.activeHours.length === 0
                    ? "—"
                    : stats.activeHours.length >= 20
                      ? "around the clock"
                      : `${fmtHour(stats.activeHours[0])}–${fmtHour(stats.activeHours[stats.activeHours.length - 1])}`,
                  `${stats.activeHours.length} hour${stats.activeHours.length === 1 ? "" : "s"} seen`,
                ],
              ].map(([label, value, sub]) => (
                <div key={label} className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-base)] p-3">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-faint)]">{label}</p>
                  <p className="mt-1 text-lg font-semibold text-[var(--text-primary)]">{value}</p>
                  <p className="text-[11px] text-[var(--text-muted)]">{sub}</p>
                </div>
              ))}
            </div>
            <div className="grid gap-3 md:grid-cols-3 text-xs">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-faint)]">Models</p>
                <p className="mt-1 text-[var(--text-secondary)]">{stats.models.join(", ") || "—"}</p>
              </div>
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-faint)]">Callers</p>
                <p className="mt-1 text-[var(--text-secondary)]">
                  {stats.users.length === 0 ? "—" : `${stats.users.length} identit${stats.users.length === 1 ? "y" : "ies"}`}
                </p>
              </div>
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-faint)]">Tools</p>
                <p className="mt-1 font-mono text-[var(--text-secondary)]">{stats.tools.slice(0, 8).join(", ") || "—"}{stats.tools.length > 8 ? " …" : ""}</p>
              </div>
            </div>
            <div className="space-y-2">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-faint)]">
                Last 24 hours vs baseline
              </p>
              {!mature ? (
                <p className="text-[var(--text-muted)]">
                  Drift is only reported once the baseline has {MIN_BASELINE_ACTIVE_DAYS} active days; until then the
                  agent is still learning what normal looks like.
                </p>
              ) : findings.length === 0 ? (
                <p className="text-[var(--success-strong)]">No departure from the baseline.</p>
              ) : (
                <ul className="space-y-2">
                  {findings.map((f, i) => (
                    <li key={i} className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-base)] p-3">
                      <div className="flex items-center gap-2">
                        <Badge variant={f.severity === "HIGH" ? "critical" : "warning"}>{f.severity}</Badge>
                        <span className="font-medium text-[var(--text-primary)]">{f.title}</span>
                      </div>
                      <p className="mt-1 text-[var(--text-secondary)]">{f.detail}</p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <p className="text-[11px] text-[var(--text-faint)]">
              {stats.windowDays}-day window · {baseline!.activeDays} active days · computed {formatDateTime(baseline!.computedAt)}
              {baseline!.lastEvaluatedAt ? ` · evaluated ${formatDateTime(baseline!.lastEvaluatedAt)}` : ""}
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
