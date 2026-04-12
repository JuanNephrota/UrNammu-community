import Link from "next/link";
import { Eye, AlertTriangle, RefreshCw, Building2 } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { StatCard } from "@/components/dashboard/stat-card";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDateTime } from "@/lib/utils";
import { UsageChart } from "@/components/dashboard/usage-chart";
import { OrgDataPanel } from "@/components/dashboard/org-data-panel";
import { OversightActionQueue } from "@/components/dashboard/governance-action-queue";
import {
  buildCostLookup,
  buildTelemetryActivityRows,
  getTelemetryAttributionLabel,
} from "@/lib/oversight-telemetry";

export default async function OversightPage() {
  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const recentCostWindowStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const previousCostWindowStart = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);

  const [
    totalUsageBuckets,
    providerStats,
    recentUsageBuckets,
    dailyUsage,
    costBuckets,
    syncRuns,
    unlinkedOpenAIAgents,
    driftAlerts,
    openIncidents,
  ] = await Promise.all([
    prisma.usageBucket.count(),
    prisma.usageBucket.groupBy({
      by: ["provider"],
      _sum: { totalTokens: true },
      _count: true,
    }),
    prisma.usageBucket.findMany({
      where: { bucketStart: { gte: thirtyDaysAgo } },
      take: 120,
      orderBy: [{ bucketStart: "desc" }, { provider: "asc" }],
    }),
    prisma.$queryRaw<{ date: string; tokens: number; cost: number }[]>`
      SELECT
        DATE("bucketStart") as date,
        SUM("totalTokens")::int as tokens,
        0::float as cost
      FROM "UsageBucket"
      WHERE "bucketStart" > NOW() - INTERVAL '30 days'
      GROUP BY DATE("bucketStart")
      ORDER BY date ASC
    `,
    prisma.costBucket.findMany({
      where: {
        bucketStart: { gte: thirtyDaysAgo },
      },
      orderBy: { bucketStart: "desc" },
      take: 200,
    }),
    prisma.providerSyncRun.findMany({
      where: { syncType: "telemetry" },
      orderBy: { startedAt: "desc" },
      take: 12,
    }),
    prisma.aIAgent.count({
      where: {
        department: "OpenAI",
        aiSystemId: null,
      },
    }),
    prisma.alert.count({
      where: { status: "OPEN", source: "system_drift" },
    }),
    prisma.governanceIncident.count({
      where: { status: "OPEN" },
    }),
  ]);

  const costByProvider = costBuckets.reduce<Record<string, number>>((acc, bucket) => {
    acc[bucket.provider] = (acc[bucket.provider] ?? 0) + bucket.amount;
    return acc;
  }, {});
  const costLookup = buildCostLookup(costBuckets);
  const recentActivity = buildTelemetryActivityRows(
    recentUsageBuckets,
    costLookup,
    10
  );
  const totalCost = costBuckets.reduce((s, bucket) => s + bucket.amount, 0);
  const totalTokens = providerStats.reduce((s, p) => s + (p._sum.totalTokens ?? 0), 0);
  const trackedEntities = new Set(
    recentUsageBuckets.map((bucket) => getTelemetryAttributionLabel(bucket))
  ).size;
  const latestSuccessByProvider = syncRuns.reduce<Record<string, Date | null>>((acc, run) => {
    if (run.status === "SUCCEEDED" && !acc[run.provider]) acc[run.provider] = run.completedAt;
    return acc;
  }, {});
  const staleProviders = Object.entries(latestSuccessByProvider)
    .filter(([, completedAt]) => !completedAt || now.getTime() - new Date(completedAt).getTime() > 24 * 60 * 60 * 1000)
    .map(([provider]) => provider);

  const recentSevenDayCost = costBuckets
    .filter((bucket) => bucket.bucketStart >= recentCostWindowStart)
    .reduce((sum, bucket) => sum + bucket.amount, 0);
  const previousSevenDayCost = costBuckets
    .filter((bucket) => bucket.bucketStart >= previousCostWindowStart && bucket.bucketStart < recentCostWindowStart)
    .reduce((sum, bucket) => sum + bucket.amount, 0);
  const spendSpike =
    previousSevenDayCost > 0 && recentSevenDayCost > previousSevenDayCost * 1.5;

  const latestFailedSync = syncRuns.find((run) => run.status === "FAILED");

  return (
    <div className="space-y-6">
      <PageHeader
        title="AI Oversight"
        description="Monitor Claude and ChatGPT API usage across your organization"
      >
        <Link href="/oversight/vendors">
          <Button variant="outline">
            <Building2 className="mr-2 h-4 w-4" /> Vendor Governance
          </Button>
        </Link>
        <Link href="/oversight/usage">
          <Button variant="outline">
            <Eye className="mr-2 h-4 w-4" /> View All Logs
          </Button>
        </Link>
      </PageHeader>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard title="Telemetry Buckets" value={totalUsageBuckets} iconName="Eye" variant="info" />
        <StatCard title="Total Tokens" value={totalTokens.toLocaleString()} iconName="Eye" variant="default" />
        <StatCard title="Total Cost" value={`$${totalCost.toFixed(2)}`} iconName="DollarSign" variant="info" />
        <StatCard
          title="Tracked Entities"
          value={trackedEntities}
          description="Recent projects, actors, or API keys"
          iconName="Database"
          variant={trackedEntities > 0 ? "success" : "default"}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Usage by Provider</CardTitle></CardHeader>
          <CardContent>
            {providerStats.length === 0 ? (
              <p className="text-sm text-[var(--text-muted)]">No usage data yet.</p>
            ) : (
              <div className="space-y-3">
                {providerStats.map((p) => (
                  <div key={p.provider} className="flex items-center justify-between rounded-md border border-[var(--border-subtle)] p-3">
                    <div>
                      <p className="text-sm font-medium capitalize">{p.provider}</p>
                      <p className="text-xs text-[var(--text-muted)]">{p._count} normalized usage buckets</p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-bold">${(costByProvider[p.provider] ?? 0).toFixed(2)}</p>
                      <p className="text-xs text-[var(--text-muted)]">{(p._sum.totalTokens ?? 0).toLocaleString()} tokens</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Usage Trend (30 days)</CardTitle></CardHeader>
          <CardContent>
            <UsageChart data={dailyUsage} />
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <OversightActionQueue
          items={[
            ...(staleProviders.length > 0
              ? [{
                  label: "Provider telemetry is stale",
                  description: `No successful sync in the last 24 hours for ${staleProviders.join(", ")}.`,
                  count: staleProviders.length,
                  href: "/settings/provider-admin",
                  tone: "warning" as const,
                }]
              : []),
            ...(latestFailedSync
              ? [{
                  label: "Recent sync failure",
                  description: latestFailedSync.errorMessage ?? "A provider sync failed and needs investigation.",
                  count: 1,
                  href: "/settings/provider-admin",
                  tone: "critical" as const,
                }]
              : []),
            ...(spendSpike
              ? [{
                  label: "Weekly spend spike",
                  description: `Last 7 days spend is $${recentSevenDayCost.toFixed(2)} versus $${previousSevenDayCost.toFixed(2)} in the prior 7 days.`,
                  count: 1,
                  href: "/oversight",
                  tone: "warning" as const,
                }]
              : []),
            ...(unlinkedOpenAIAgents > 0
              ? [{
                  label: "Assistants missing registry linkage",
                  description: "Provider-discovered assistants exist without a linked governed system.",
                  count: unlinkedOpenAIAgents,
                  href: "/agents",
                  tone: "info" as const,
                }]
              : []),
            ...(driftAlerts > 0
              ? [{
                  label: "Governance drift detected",
                  description: "Approved or deployed systems changed in ways that should be re-reviewed.",
                  count: driftAlerts,
                  href: "/alerts",
                  tone: "critical" as const,
                }]
              : []),
            ...(openIncidents > 0
              ? [{
                  label: "Open governance incidents",
                  description: "Policy breaches or oversight incidents are still open.",
                  count: openIncidents,
                  href: "/alerts",
                  tone: "critical" as const,
                }]
              : []),
          ]}
        />

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <RefreshCw className="h-4 w-4 text-[var(--accent)]" />
              Sync Health
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {Object.keys(latestSuccessByProvider).length === 0 ? (
              <p className="text-sm text-[var(--text-muted)]">No provider syncs have completed yet.</p>
            ) : (
              Object.entries(latestSuccessByProvider).map(([provider, completedAt]) => (
                (() => {
                  const isFresh = !!completedAt && now.getTime() - new Date(completedAt).getTime() <= 24 * 60 * 60 * 1000;
                  return (
                    <div key={provider} className="flex items-center justify-between rounded-md border border-[var(--border-subtle)] p-3">
                      <div>
                        <p className="text-sm font-medium capitalize">{provider}</p>
                        <p className="text-xs text-[var(--text-muted)]">
                          {completedAt ? `Last success ${formatDateTime(completedAt)}` : "No successful sync yet"}
                        </p>
                      </div>
                      <Badge variant={isFresh ? "success" : "warning"}>
                        {isFresh ? "Fresh" : "Stale"}
                      </Badge>
                    </div>
                  );
                })()
              ))
            )}

            {latestFailedSync && (
              <div className="rounded-md border border-red-500/20 bg-red-500/5 p-3">
                <div className="flex items-center gap-2 text-[var(--critical)]">
                  <AlertTriangle className="h-4 w-4" />
                  <p className="text-sm font-medium">Most recent failure</p>
                </div>
                <p className="mt-1 text-xs text-[var(--text-muted)]">
                  {latestFailedSync.provider} at {formatDateTime(latestFailedSync.startedAt)}
                </p>
                {latestFailedSync.errorMessage && (
                  <p className="mt-1 text-xs text-[var(--critical)]">{latestFailedSync.errorMessage}</p>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle>Recent Telemetry Activity</CardTitle></CardHeader>
        <CardContent>
          {recentActivity.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)]">No recent telemetry activity yet.</p>
          ) : (
            <div className="space-y-2">
              {recentActivity.map((row) => (
                <div key={row.id} className="flex items-center justify-between rounded-md border border-[var(--border-subtle)] p-3">
                  <div className="flex items-center gap-3">
                    <Badge variant="info" className="capitalize">
                      {row.provider}
                    </Badge>
                    <div>
                      <p className="text-sm">{row.attribution} &middot; {row.model}</p>
                      <p className="text-xs text-[var(--text-muted)]">
                        {row.tokens.toLocaleString()} tokens &middot; ${row.cost.toFixed(4)} &middot; {row.requests.toLocaleString()} requests
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-[var(--text-faint)]">{formatDateTime(row.date)}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <OrgDataPanel />
    </div>
  );
}
