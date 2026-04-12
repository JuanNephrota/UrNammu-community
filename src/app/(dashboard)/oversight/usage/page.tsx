import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDate, formatDateTime } from "@/lib/utils";

export default async function UsageLogsPage() {
  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  const [usageBuckets, costBuckets, recentLogs, syncRuns] = await Promise.all([
    prisma.usageBucket.findMany({
      where: { bucketStart: { gte: thirtyDaysAgo } },
      orderBy: [{ bucketStart: "desc" }, { provider: "asc" }],
      take: 300,
    }),
    prisma.costBucket.findMany({
      where: { bucketStart: { gte: thirtyDaysAgo } },
      orderBy: [{ bucketStart: "desc" }, { provider: "asc" }],
      take: 300,
    }),
    prisma.aPIUsageLog.findMany({
      take: 30,
      orderBy: { createdAt: "desc" },
      include: { user: { select: { name: true, email: true } } },
    }),
    prisma.providerSyncRun.findMany({
      where: { syncType: "telemetry" },
      orderBy: { startedAt: "desc" },
      take: 8,
    }),
  ]);

  const costMap = new Map(
    costBuckets.map((bucket) => [
      `${bucket.provider}:${bucket.bucketStart.toISOString()}:${bucket.dimensionKey}`,
      bucket.amount,
    ])
  );

  const modelSummary = new Map<
    string,
    { label: string; provider: string; tokens: number; cost: number; requests: number }
  >();
  const projectSummary = new Map<
    string,
    { label: string; tokens: number; cost: number; providers: Set<string> }
  >();

  for (const bucket of usageBuckets) {
    const bucketCost =
      costMap.get(
        `${bucket.provider}:${bucket.bucketStart.toISOString()}:${bucket.dimensionKey}`
      ) ?? 0;

    const modelKey = `${bucket.provider}:${bucket.model ?? "unknown"}`;
    const modelItem = modelSummary.get(modelKey) ?? {
      label: bucket.model ?? "Unspecified model",
      provider: bucket.provider,
      tokens: 0,
      cost: 0,
      requests: 0,
    };
    modelItem.tokens += bucket.totalTokens;
    modelItem.cost += bucketCost;
    modelItem.requests += bucket.requestCount ?? 0;
    modelSummary.set(modelKey, modelItem);

    const projectLabel =
      bucket.projectName ??
      bucket.actorName ??
      bucket.apiKeyName ??
      bucket.projectExternalId ??
      bucket.actorExternalId ??
      "Unattributed usage";
    const projectItem = projectSummary.get(projectLabel) ?? {
      label: projectLabel,
      tokens: 0,
      cost: 0,
      providers: new Set<string>(),
    };
    projectItem.tokens += bucket.totalTokens;
    projectItem.cost += bucketCost;
    projectItem.providers.add(bucket.provider);
    projectSummary.set(projectLabel, projectItem);
  }

  const topModels = [...modelSummary.values()]
    .sort((a, b) => b.tokens - a.tokens)
    .slice(0, 8);
  const topProjects = [...projectSummary.values()]
    .sort((a, b) => b.tokens - a.tokens)
    .slice(0, 8);

  const totalTokens = usageBuckets.reduce((sum, bucket) => sum + bucket.totalTokens, 0);
  const totalRequests = usageBuckets.reduce(
    (sum, bucket) => sum + (bucket.requestCount ?? 0),
    0
  );
  const totalCost = costBuckets.reduce((sum, bucket) => sum + bucket.amount, 0);

  const tableRows = usageBuckets.slice(0, 60).map((bucket) => ({
    id: bucket.id,
    date: bucket.bucketStart,
    provider: bucket.provider,
    model: bucket.model ?? "—",
    project:
      bucket.projectName ??
      bucket.actorName ??
      bucket.apiKeyName ??
      bucket.projectExternalId ??
      bucket.actorExternalId ??
      "—",
    requests: bucket.requestCount ?? 0,
    tokens: bucket.totalTokens,
    cost:
      costMap.get(
        `${bucket.provider}:${bucket.bucketStart.toISOString()}:${bucket.dimensionKey}`
      ) ?? 0,
  }));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Usage Telemetry"
        description="Normalized provider-admin telemetry with supplemental request logs for drill-down"
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardContent className="pt-6">
            <p className="text-xs uppercase tracking-wider text-[var(--text-faint)]">
              Usage Buckets
            </p>
            <p className="mt-2 text-3xl font-semibold">{usageBuckets.length}</p>
            <p className="mt-1 text-sm text-[var(--text-muted)]">Last 30 days</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-xs uppercase tracking-wider text-[var(--text-faint)]">
              Token Volume
            </p>
            <p className="mt-2 text-3xl font-semibold">{totalTokens.toLocaleString()}</p>
            <p className="mt-1 text-sm text-[var(--text-muted)]">
              {totalRequests.toLocaleString()} requests tracked
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-xs uppercase tracking-wider text-[var(--text-faint)]">
              Estimated Cost
            </p>
            <p className="mt-2 text-3xl font-semibold">${totalCost.toFixed(2)}</p>
            <p className="mt-1 text-sm text-[var(--text-muted)]">From provider cost buckets</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-xs uppercase tracking-wider text-[var(--text-faint)]">
              Sync Coverage
            </p>
            <p className="mt-2 text-3xl font-semibold">
              {new Set(syncRuns.map((run) => run.provider)).size}
            </p>
            <p className="mt-1 text-sm text-[var(--text-muted)]">Providers synced recently</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle>Normalized Usage Activity</CardTitle>
          </CardHeader>
          <CardContent>
            {tableRows.length === 0 ? (
              <p className="text-sm text-[var(--text-muted)]">No usage telemetry yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[var(--border-subtle)]">
                      <th className="px-3 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-[var(--text-faint)]">Date</th>
                      <th className="px-3 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-[var(--text-faint)]">Provider</th>
                      <th className="px-3 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-[var(--text-faint)]">Model</th>
                      <th className="px-3 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-[var(--text-faint)]">Project / Actor</th>
                      <th className="px-3 py-3 text-right text-[11px] font-semibold uppercase tracking-wider text-[var(--text-faint)]">Requests</th>
                      <th className="px-3 py-3 text-right text-[11px] font-semibold uppercase tracking-wider text-[var(--text-faint)]">Tokens</th>
                      <th className="px-3 py-3 text-right text-[11px] font-semibold uppercase tracking-wider text-[var(--text-faint)]">Cost</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tableRows.map((row) => (
                      <tr key={row.id} className="border-b border-[var(--border-subtle)]">
                        <td className="px-3 py-3 text-xs text-[var(--text-faint)] whitespace-nowrap">
                          {formatDate(row.date)}
                        </td>
                        <td className="px-3 py-3">
                          <Badge variant="info" className="capitalize">
                            {row.provider}
                          </Badge>
                        </td>
                        <td className="px-3 py-3 font-mono text-xs text-[var(--text-secondary)]">
                          {row.model}
                        </td>
                        <td className="px-3 py-3 text-[var(--text-secondary)]">
                          {row.project}
                        </td>
                        <td className="px-3 py-3 text-right tabular-nums">
                          {row.requests.toLocaleString()}
                        </td>
                        <td className="px-3 py-3 text-right tabular-nums">
                          {row.tokens.toLocaleString()}
                        </td>
                        <td className="px-3 py-3 text-right tabular-nums">
                          ${row.cost.toFixed(2)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Top Models</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {topModels.length === 0 ? (
                <p className="text-sm text-[var(--text-muted)]">No model-level telemetry yet.</p>
              ) : (
                topModels.map((item) => (
                  <div
                    key={`${item.provider}:${item.label}`}
                    className="rounded-lg border border-[var(--border-subtle)] p-3"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium">{item.label}</p>
                        <p className="text-xs text-[var(--text-faint)] capitalize">
                          {item.provider}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-semibold">
                          {item.tokens.toLocaleString()}
                        </p>
                        <p className="text-xs text-[var(--text-muted)]">
                          ${item.cost.toFixed(2)}
                        </p>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Projects and Actors</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {topProjects.length === 0 ? (
                <p className="text-sm text-[var(--text-muted)]">No project or actor attribution yet.</p>
              ) : (
                topProjects.map((item) => (
                  <div
                    key={item.label}
                    className="rounded-lg border border-[var(--border-subtle)] p-3"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium">{item.label}</p>
                        <p className="text-xs text-[var(--text-faint)]">
                          {[...item.providers].join(", ")}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-semibold">
                          {item.tokens.toLocaleString()}
                        </p>
                        <p className="text-xs text-[var(--text-muted)]">
                          ${item.cost.toFixed(2)}
                        </p>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Supplemental Request Logs</CardTitle>
        </CardHeader>
        <CardContent>
          {recentLogs.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)]">No supplemental logs yet.</p>
          ) : (
            <div className="space-y-3">
              {recentLogs.map((log) => (
                <div
                  key={log.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--border-subtle)] p-3"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <Badge variant={log.flagged ? "critical" : "info"} className="capitalize">
                        {log.provider}
                      </Badge>
                      <span className="font-mono text-xs text-[var(--text-secondary)]">
                        {log.model ?? "—"}
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-[var(--text-secondary)]">
                      {log.user?.name ?? log.user?.email ?? "System"} · {log.totalTokens.toLocaleString()} tokens · ${log.cost.toFixed(4)}
                    </p>
                  </div>
                  <div className="text-right">
                    {log.flagged && <Badge variant="critical">Flagged</Badge>}
                    <p className="mt-1 text-xs text-[var(--text-faint)]">
                      {formatDateTime(log.createdAt)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
