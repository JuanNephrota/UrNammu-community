import Link from "next/link";
import { Hand, History } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { StatCard } from "@/components/dashboard/stat-card";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ReviewDecisionControls } from "@/components/oversight/review-decision-controls";
import { getSession } from "@/lib/auth-guard";
import { canRunWorkflows } from "@/lib/workflow";
import { listHumanReviews, parseCalls, type HumanReviewRow } from "@/lib/human-review-queue";
import { formatDateTime } from "@/lib/utils";

export const dynamic = "force-dynamic";

const STATUS_VARIANT: Record<string, "critical" | "success" | "warning" | "outline" | "info"> = {
  PENDING: "critical",
  APPROVED: "success",
  REJECTED: "warning",
  EXPIRED: "outline",
  CONSUMED: "info",
};

function CallList({ row }: { row: HumanReviewRow }) {
  const calls = parseCalls(row.calls);
  return (
    <ul className="space-y-2">
      {calls.map((c, i) => (
        <li key={i} className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-base)] p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-mono text-xs text-[var(--text-primary)]">{c.tool}</span>
            <span className="text-[11px] text-[var(--text-muted)]">
              {c.detail} · trigger “{c.trigger}”
            </span>
          </div>
          <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-all rounded bg-[var(--bg-elevated)] p-2 font-mono text-[11px] text-[var(--text-secondary)]">
            {c.input}
          </pre>
        </li>
      ))}
    </ul>
  );
}

export default async function HumanReviewPage({
  searchParams,
}: {
  searchParams: Promise<{ agentId?: string; request?: string }>;
}) {
  const [{ agentId, request }, session] = await Promise.all([searchParams, getSession()]);
  const canDecide = canRunWorkflows(session?.user.role);
  const [pending, decided] = await Promise.all([
    listHumanReviews({ status: ["PENDING"], agentId, take: 100 }),
    listHumanReviews({ status: ["APPROVED", "CONSUMED", "REJECTED", "EXPIRED"], agentId, take: 50 }),
  ]);
  const activeWaivers = decided.filter((r) => r.status === "APPROVED").length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Human Review"
        description="Tool calls that an agent's review triggers withheld at the proxy. Approve to let the call through when the agent re-runs it; reject to keep it blocked."
      >
        {agentId && (
          <Link href="/oversight/human-review">
            <Badge variant="info">Clear agent filter</Badge>
          </Link>
        )}
      </PageHeader>

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard title="Pending" value={pending.length} iconName="Hand" variant={pending.length > 0 ? "danger" : "success"} />
        <StatCard title="Active waivers" value={activeWaivers} iconName="ShieldCheck" variant="default" />
        <StatCard title="Decided (recent)" value={decided.length} iconName="History" variant="default" />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Hand className="h-4 w-4 text-[var(--critical)]" />
            Pending ({pending.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {pending.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)]">
              Nothing waiting. Calls appear here when an agent in <strong>Enforce</strong> human-review mode makes a tool
              call that matches one of its triggers.
            </p>
          ) : (
            <ul className="space-y-4">
              {pending.map((row) => (
                <li
                  key={row.id}
                  id={row.id}
                  className={`space-y-3 rounded-lg border p-4 ${
                    request === row.id ? "border-[var(--accent-border)] bg-[var(--accent-faint)]" : "border-[var(--border-subtle)]"
                  }`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <Link href={`/agents/${row.agent.id}#human-review`} className="font-medium text-[var(--text-primary)] hover:underline">
                        {row.agent.name}
                      </Link>
                      <p className="text-[11px] text-[var(--text-muted)]">
                        {row.provider}
                        {row.model ? ` / ${row.model}` : ""} · first {formatDateTime(row.firstSeenAt)} · last {formatDateTime(row.lastSeenAt)}
                        {row.occurrences > 1 ? ` · withheld ${row.occurrences}×` : ""}
                        {row.userEmail ? ` · ${row.userEmail}` : ""}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {row.triggers.map((t) => (
                        <Badge key={t} variant="warning">{t}</Badge>
                      ))}
                      <Badge variant="outline">{row.agent.autonomyLevel.replace(/_/g, " ")}</Badge>
                    </div>
                  </div>
                  <CallList row={row} />
                  {row.agent.escalationContact && (
                    <p className="text-[11px] text-[var(--text-faint)]">Escalation contact: {row.agent.escalationContact}</p>
                  )}
                  {canDecide ? (
                    <ReviewDecisionControls requestId={row.id} triggerLabel={row.triggers[0] ?? "this trigger"} />
                  ) : (
                    <p className="text-xs text-[var(--text-muted)]">Admins and compliance officers can decide.</p>
                  )}
                  <p className="text-[11px] text-[var(--text-faint)]">
                    Request id <code>{row.id}</code> — the agent received it in the 403 and must re-run the call after approval.
                  </p>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <History className="h-4 w-4 text-[var(--accent)]" />
            Decided
          </CardTitle>
        </CardHeader>
        <CardContent>
          {decided.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)]">No decisions yet.</p>
          ) : (
            <ul className="divide-y divide-[var(--border-subtle)]">
              {decided.map((row) => {
                const calls = parseCalls(row.calls);
                return (
                  <li key={row.id} className="flex flex-wrap items-start justify-between gap-3 py-3 text-sm">
                    <div className="min-w-0">
                      <p>
                        <Link href={`/agents/${row.agent.id}#human-review`} className="font-medium hover:underline">
                          {row.agent.name}
                        </Link>{" "}
                        <span className="font-mono text-xs text-[var(--text-muted)]">{calls.map((c) => c.tool).join(", ")}</span>
                      </p>
                      <p className="text-[11px] text-[var(--text-muted)]">
                        {row.triggers.join(", ")}
                        {row.decidedBy ? ` · ${row.decidedBy.name ?? row.decidedBy.email}` : ""}
                        {row.decidedAt ? ` · ${formatDateTime(row.decidedAt)}` : ""}
                        {row.status === "APPROVED" || row.status === "CONSUMED"
                          ? ` · ${row.waiverScope === "trigger" ? "any matching call" : "exact call"}${
                              row.usesRemaining !== null ? `, ${row.usesRemaining} use${row.usesRemaining === 1 ? "" : "s"} left` : ""
                            }${row.expiresAt ? `, until ${formatDateTime(row.expiresAt)}` : ""}`
                          : ""}
                        {row.decisionNote ? ` · “${row.decisionNote}”` : ""}
                      </p>
                    </div>
                    <Badge variant={STATUS_VARIANT[row.status] ?? "outline"}>{row.status}</Badge>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
