import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDate, formatDateTime } from "@/lib/utils";
import {
  buildCostLookup,
  buildDataExposureFindings,
  buildTelemetryActivityRows,
  getBucketIdentityKey,
  getTelemetryAttributionLabel,
  summarizeDataExposureFindings,
} from "@/lib/oversight-telemetry";
import { LinkUsageDialog } from "@/components/oversight/link-usage-dialog";

export default async function UsageLogsPage() {
  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  const [usageBuckets, costBuckets, syncRuns] = await Promise.all([
    prisma.usageBucket.findMany({
      where: { bucketStart: { gte: thirtyDaysAgo } },
      orderBy: [{ bucketStart: "desc" }, { provider: "asc" }],
      take: 300,
      include: { aiSystem: { select: { id: true, name: true, dataSensitivity: true } } },
    }),
    prisma.costBucket.findMany({
      where: { bucketStart: { gte: thirtyDaysAgo } },
      orderBy: [{ bucketStart: "desc" }, { provider: "asc" }],
      take: 300,
    }),
    prisma.providerSyncRun.findMany({
      where: { syncType: "telemetry" },
      orderBy: { startedAt: "desc" },
      take: 8,
    }),
  ]);

  const costMap = buildCostLookup(costBuckets);

  const modelSummary = new Map<
    string,
    { label: string; provider: string; tokens: number; cost: number; requests: number }
  >();
  const projectSummary = new Map<
    string,
    { label: string; tokens: number; cost: number; providers: Set<string> }
  >();

  for (const bucket of usageBuckets) {
    const bucketCost = costMap.get(getBucketIdentityKey(bucket)) ?? 0;

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

    const projectLabel = getTelemetryAttributionLabel(bucket, bucket.aiSystem?.name);
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

  const tableRows = buildTelemetryActivityRows(usageBuckets, costMap, 60);
  const recentTelemetry = buildTelemetryActivityRows(usageBuckets, costMap, 30);
  const exposureFindings = buildDataExposureFindings(usageBuckets, costMap, 20);
  const exposureSummary = summarizeDataExposureFindings(exposureFindings);

  // Group unattributed buckets (no aiSystemId) by label+provider+model for remediation
  const unattributedGroups = new Map<
    string,
    { label: string; provider: string; model: string; tokens: number; bucketIds: string[] }
  >();
  for (const bucket of usageBuckets) {
    if (bucket.aiSystemId) continue;
    const label = getTelemetryAttributionLabel(bucket);
    const groupKey = `${label}::${bucket.provider}::${bucket.model ?? "unknown"}`;
    const existing = unattributedGroups.get(groupKey) ?? {
      label,
      provider: bucket.provider,
      model: bucket.model ?? "unknown",
      tokens: 0,
      bucketIds: [],
    };
    existing.tokens += bucket.totalTokens;
    existing.bucketIds.push(bucket.id);
    unattributedGroups.set(groupKey, existing);
  }
  const unattributedList = [...unattributedGroups.values()]
    .sort((a, b) => b.tokens - a.tokens)
    .slice(0, 20);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Usage Telemetry"
        description="Normalized provider-admin telemetry for usage, cost, and attribution drill-down"
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
        <Card>
          <CardContent className="pt-6">
            <p className="text-xs uppercase tracking-wider text-[var(--text-faint)]">
              Exposure Signals
            </p>
            <p className="mt-2 text-3xl font-semibold">{exposureSummary.totalFindings}</p>
            <p className="mt-1 text-sm text-[var(--text-muted)]">
              {exposureSummary.restrictedSystemFindings} linked to restricted systems
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Restricted-Data Exposure Findings</CardTitle>
        </CardHeader>
        <CardContent>
          {exposureFindings.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)]">
              No restricted-data signals were detected from the last 30 days of provider-visible telemetry.
            </p>
          ) : (
            <div className="space-y-3">
              {exposureFindings.map((finding) => (
                <div
                  key={finding.id}
                  className="rounded-lg border border-[var(--border-subtle)] p-4"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <Badge
                          variant={
                            finding.severity === "critical"
                              ? "critical"
                              : finding.severity === "warning"
                                ? "warning"
                                : "info"
                          }
                        >
                          {finding.severity.toUpperCase()}
                        </Badge>
                        <Badge variant="info" className="capitalize">
                          {finding.provider}
                        </Badge>
                        {finding.systemSensitivity && (
                          <Badge variant={finding.systemSensitivity === "RESTRICTED" ? "critical" : "warning"}>
                            {finding.systemSensitivity}
                          </Badge>
                        )}
                      </div>
                      <p className="mt-2 text-sm font-medium">
                        {finding.attribution} · {finding.model}
                      </p>
                      <p className="mt-1 text-xs text-[var(--text-muted)]">
                        {finding.reasons.join(" ")}
                      </p>
                      <p className="mt-2 text-xs text-[var(--text-faint)]">
                        Indicators: {finding.matchedIndicators.join(", ") || "Sensitivity markers only"} · Visibility:{" "}
                        {finding.visibilitySignals.join(", ")}
                      </p>
                    </div>
                    <div className="text-right text-xs text-[var(--text-faint)]">
                      <p>{formatDateTime(finding.date)}</p>
                      <p className="mt-1">{finding.tokens.toLocaleString()} tokens</p>
                      <p className="mt-1">{finding.requests.toLocaleString()} requests</p>
                      <p className="mt-1">${finding.cost.toFixed(4)}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {unattributedList.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Unattributed Usage ({unattributedList.reduce((s, g) => s + g.bucketIds.length, 0)} buckets)</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-[var(--text-muted)] mb-4">
              These usage buckets are not linked to a registered AI system. Link them to track usage against governed systems.
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--border-subtle)]">
                    <th className="px-3 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-[var(--text-faint)]">Attribution</th>
                    <th className="px-3 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-[var(--text-faint)]">Provider</th>
                    <th className="px-3 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-[var(--text-faint)]">Model</th>
                    <th className="px-3 py-3 text-right text-[11px] font-semibold uppercase tracking-wider text-[var(--text-faint)]">Tokens</th>
                    <th className="px-3 py-3 text-right text-[11px] font-semibold uppercase tracking-wider text-[var(--text-faint)]">Buckets</th>
                    <th className="px-3 py-3 text-right text-[11px] font-semibold uppercase tracking-wider text-[var(--text-faint)]"></th>
                  </tr>
                </thead>
                <tbody>
                  {unattributedList.map((group, i) => (
                    <tr key={i} className="border-b border-[var(--border-subtle)]">
                      <td className="px-3 py-3 text-[var(--text-secondary)]">{group.label}</td>
                      <td className="px-3 py-3">
                        <Badge variant="info" className="capitalize">{group.provider}</Badge>
                      </td>
                      <td className="px-3 py-3 font-mono text-xs text-[var(--text-secondary)]">{group.model}</td>
                      <td className="px-3 py-3 text-right tabular-nums">{group.tokens.toLocaleString()}</td>
                      <td className="px-3 py-3 text-right tabular-nums">{group.bucketIds.length}</td>
                      <td className="px-3 py-3 text-right">
                        <LinkUsageDialog
                          bucketIds={group.bucketIds}
                          label={group.label}
                          bucketCount={group.bucketIds.length}
                          tokenCount={group.tokens}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

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
                          {row.attribution}
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
          <CardTitle>Recent Telemetry Activity</CardTitle>
        </CardHeader>
        <CardContent>
          {recentTelemetry.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)]">No recent telemetry activity yet.</p>
          ) : (
            <div className="space-y-3">
              {recentTelemetry.map((row) => (
                <div
                  key={row.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--border-subtle)] p-3"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <Badge variant="info" className="capitalize">
                        {row.provider}
                      </Badge>
                      <span className="font-mono text-xs text-[var(--text-secondary)]">
                        {row.model}
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-[var(--text-secondary)]">
                      {row.attribution} · {row.tokens.toLocaleString()} tokens · ${row.cost.toFixed(4)}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="mt-1 text-xs text-[var(--text-faint)]">
                      {formatDateTime(row.date)}
                    </p>
                    <p className="mt-1 text-xs text-[var(--text-muted)]">
                      {row.requests.toLocaleString()} requests
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
