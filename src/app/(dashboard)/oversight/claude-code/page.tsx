import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { PageHeader } from "@/components/layout/page-header";
import { StatCard } from "@/components/dashboard/stat-card";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface CoreMetrics {
  num_sessions?: number;
  lines_of_code?: { added?: number; removed?: number };
  commits_by_claude_code?: number;
  pull_requests_by_claude_code?: number;
}

interface ToolActions {
  [tool: string]: { accepted?: number; rejected?: number };
}

interface ModelBreakdownEntry {
  model: string;
  tokens: {
    input?: number;
    output?: number;
    cache_read?: number;
    cache_creation?: number;
  };
  estimated_cost?: { amount?: number; currency?: string };
}

interface BucketMetadata {
  bucket_type?: "summary" | "model";
  core_metrics?: CoreMetrics;
  tool_actions?: ToolActions;
  terminal_type?: string;
  estimated_cost_cents?: number;
  model_breakdown?: ModelBreakdownEntry[];
}

function getSevenDaysAgo() {
  return new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
}

export default async function ClaudeCodePage() {
  const sevenDaysAgo = getSevenDaysAgo();

  const [usageBuckets, latestSyncRun, latestFailedRun] = await Promise.all([
    prisma.usageBucket.findMany({
      where: {
        provider: "claude_code",
        bucketStart: { gte: sevenDaysAgo },
      },
      orderBy: { bucketStart: "desc" },
    }),
    prisma.providerSyncRun.findFirst({
      where: {
        provider: "claude_code",
        syncType: "telemetry",
        status: "SUCCEEDED",
      },
      orderBy: { completedAt: "desc" },
      select: { completedAt: true, metadata: true },
    }),
    prisma.providerSyncRun.findFirst({
      where: {
        provider: "claude_code",
        syncType: "telemetry",
        status: "FAILED",
      },
      orderBy: { completedAt: "desc" },
      select: { completedAt: true, errorMessage: true },
    }),
  ]);

  // Aggregate stats
  let totalSessions = 0;
  let totalLinesAdded = 0;
  let totalLinesRemoved = 0;
  let totalCommits = 0;
  let totalPRs = 0;
  let totalToolAccepted = 0;
  let totalToolRejected = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalCacheTokens = 0;

  // Per-user aggregation
  const userMap = new Map<string, {
    email: string;
    sessions: number;
    linesAdded: number;
    linesRemoved: number;
    commits: number;
    prs: number;
    inputTokens: number;
    outputTokens: number;
    cacheTokens: number;
    toolAccepted: number;
    toolRejected: number;
    cost: number;
  }>();

  let totalCost = 0;

  for (const bucket of usageBuckets) {
    const userId = bucket.actorExternalId ?? "unknown";
    const meta = (bucket.metadata as Prisma.JsonObject | null) as BucketMetadata | null;

    const cm = meta?.core_metrics;
    const ta = meta?.tool_actions;

    const sessions = cm?.num_sessions ?? 0;
    const linesAdded = cm?.lines_of_code?.added ?? 0;
    const linesRemoved = cm?.lines_of_code?.removed ?? 0;
    const commits = cm?.commits_by_claude_code ?? 0;
    const prs = cm?.pull_requests_by_claude_code ?? 0;
    const costCents = meta?.estimated_cost_cents ?? 0;
    const costDollars = costCents / 100;

    // Extract token totals from model_breakdown metadata (the UsageBucket
    // columns are intentionally left at 0 to avoid double-counting with the
    // regular Anthropic usage sync — tokens live in metadata only here).
    let bucketInput = 0;
    let bucketOutput = 0;
    let bucketCache = 0;
    for (const mb of meta?.model_breakdown ?? []) {
      bucketInput += mb.tokens?.input ?? 0;
      bucketOutput += mb.tokens?.output ?? 0;
      bucketCache += (mb.tokens?.cache_read ?? 0) + (mb.tokens?.cache_creation ?? 0);
    }

    let toolAccepted = 0;
    let toolRejected = 0;
    if (ta) {
      for (const action of Object.values(ta)) {
        toolAccepted += action?.accepted ?? 0;
        toolRejected += action?.rejected ?? 0;
      }
    }

    totalSessions += sessions;
    totalLinesAdded += linesAdded;
    totalLinesRemoved += linesRemoved;
    totalCommits += commits;
    totalPRs += prs;
    totalToolAccepted += toolAccepted;
    totalToolRejected += toolRejected;
    totalInputTokens += bucketInput;
    totalOutputTokens += bucketOutput;
    totalCacheTokens += bucketCache;
    totalCost += costDollars;

    const existing = userMap.get(userId) ?? {
      email: userId,
      sessions: 0,
      linesAdded: 0,
      linesRemoved: 0,
      commits: 0,
      prs: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheTokens: 0,
      toolAccepted: 0,
      toolRejected: 0,
      cost: 0,
    };

    existing.sessions += sessions;
    existing.linesAdded += linesAdded;
    existing.linesRemoved += linesRemoved;
    existing.commits += commits;
    existing.prs += prs;
    existing.inputTokens += bucketInput;
    existing.outputTokens += bucketOutput;
    existing.cacheTokens += bucketCache;
    existing.toolAccepted += toolAccepted;
    existing.toolRejected += toolRejected;
    existing.cost += costDollars;
    userMap.set(userId, existing);
  }
  const users = Array.from(userMap.values()).sort((a, b) => b.sessions - a.sessions);
  const toolAcceptRate = totalToolAccepted + totalToolRejected > 0
    ? ((totalToolAccepted / (totalToolAccepted + totalToolRejected)) * 100).toFixed(1)
    : "—";

  return (
    <div className="space-y-6">
      <PageHeader
        title="Claude Code Analytics"
        description="Per-user developer productivity and usage metrics from Claude Code"
      />

      {latestSyncRun?.completedAt && (() => {
        const meta = latestSyncRun.metadata as Record<string, unknown> | null;
        return (
          <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4 space-y-1">
            <p className="text-xs text-[var(--text-faint)]">
              Last sync: {latestSyncRun.completedAt.toLocaleString()}
            </p>
            {meta && (
              <p className="text-xs text-[var(--text-muted)]">
                API returned {String(meta.entriesProcessed ?? 0)} entries from {String(meta.uniqueUsers ?? 0)} users
                {" · "}
                {String(meta.daysSucceeded ?? "?")} of {String(meta.daysRequested ?? "?")} days fetched
                {Number(meta.daysFailed) > 0 && (
                  <span className="text-[var(--warning)]"> ({String(meta.daysFailed)} days failed)</span>
                )}
              </p>
            )}
            {Array.isArray(meta?.fetchErrors) && (meta.fetchErrors as string[]).length > 0 ? (
              <details className="text-xs text-[var(--critical)]">
                <summary className="cursor-pointer">API errors ({(meta.fetchErrors as string[]).length})</summary>
                <ul className="mt-1 ml-4 list-disc space-y-0.5">
                  {(meta.fetchErrors as string[]).map((err, i) => (
                    <li key={i}>{err}</li>
                  ))}
                </ul>
              </details>
            ) : null}
          </div>
        );
      })()}
      {latestFailedRun?.errorMessage && (!latestSyncRun?.completedAt || latestFailedRun.completedAt! > latestSyncRun.completedAt) && (
        <div className="rounded-lg border border-[var(--critical)]/20 bg-[var(--critical)]/5 p-4">
          <p className="text-sm font-medium text-[var(--critical)]">Claude Code sync failed</p>
          <p className="text-xs text-[var(--critical)] mt-1">{latestFailedRun.errorMessage}</p>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <StatCard title="Sessions" value={totalSessions} iconName="Terminal" />
        <StatCard title="Lines Added" value={totalLinesAdded.toLocaleString()} iconName="Plus" variant="success" />
        <StatCard title="Commits" value={totalCommits} iconName="GitCommitHorizontal" />
        <StatCard title="Pull Requests" value={totalPRs} iconName="GitPullRequest" variant="info" />
        <StatCard title="Est. Cost" value={`$${totalCost.toFixed(2)}`} iconName="DollarSign" variant="warning" />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardContent className="pt-6">
            <p className="text-xs font-semibold uppercase tracking-wider text-[var(--text-faint)]">Token Volume</p>
            <p className="text-2xl font-bold tabular-nums mt-1" style={{ fontFamily: "var(--font-display)" }}>
              {((totalInputTokens + totalOutputTokens) / 1000).toFixed(0)}k
            </p>
            <p className="mt-1 text-xs text-[var(--text-muted)]">
              {(totalInputTokens / 1000).toFixed(0)}k in / {(totalOutputTokens / 1000).toFixed(0)}k out
              {totalCacheTokens > 0 && (
                <span className="text-[var(--text-faint)]"> + {(totalCacheTokens / 1000).toFixed(0)}k cached</span>
              )}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-xs font-semibold uppercase tracking-wider text-[var(--text-faint)]">Lines Removed</p>
            <p className="text-2xl font-bold tabular-nums mt-1" style={{ fontFamily: "var(--font-display)" }}>{totalLinesRemoved.toLocaleString()}</p>
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

      <Card>
        <CardHeader>
          <CardTitle>Users (Last 7 Days)</CardTitle>
        </CardHeader>
        <CardContent>
          {users.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)] py-8 text-center">
              No Claude Code analytics data yet. Trigger a sync from the Oversight page.
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
                          <span className="text-[var(--success)]">+{u.linesAdded.toLocaleString()}</span>
                          {" / "}
                          <span className="text-[var(--critical)]">-{u.linesRemoved.toLocaleString()}</span>
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
    </div>
  );
}
