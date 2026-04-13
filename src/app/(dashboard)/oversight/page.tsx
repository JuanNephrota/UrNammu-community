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
  buildModelDriftFindings,
  buildTelemetryAnomalies,
  buildCostLookup,
  buildDataExposureFindings,
  buildSystemTelemetrySummaries,
  buildTelemetryActivityRows,
  getTelemetryAttributionLabel,
  summarizeDataExposureFindings,
} from "@/lib/oversight-telemetry";
import { SpendBudgetManager } from "@/components/oversight/spend-budget-manager";
import { getTopCostDrivers, summarizeSpendBudgets } from "@/lib/spend-governance";
import { getOversightRecommendations } from "@/lib/oversight-recommendations";

export default async function OversightPage() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const prismaAny = prisma as any;
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
    spendBudgets,
    investigations,
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
      include: {
        aiSystem: {
          select: {
            id: true,
            name: true,
            vendor: true,
            modelType: true,
            dataSensitivity: true,
            department: true,
            status: true,
            riskLevel: true,
          },
        },
      },
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
    prismaAny.spendBudget.findMany({
      orderBy: [{ scopeType: "asc" }, { label: "asc" }],
    }),
    prismaAny.investigation.findMany({
      where: { status: { in: ["OPEN", "IN_PROGRESS"] } },
      orderBy: { updatedAt: "desc" },
      take: 6,
      include: {
        ownerUser: { select: { name: true, email: true } },
        aiSystem: { select: { id: true, name: true } },
        alert: { select: { id: true, title: true, severity: true } },
        governanceIncident: { select: { id: true, title: true, severity: true } },
      },
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

  const costByProvider = costBuckets.reduce<Record<string, number>>((acc: Record<string, number>, bucket) => {
    acc[bucket.provider] = (acc[bucket.provider] ?? 0) + bucket.amount;
    return acc;
  }, {});
  const costLookup = buildCostLookup(costBuckets);
  const recentActivity = buildTelemetryActivityRows(
    recentUsageBuckets,
    costLookup,
    10
  );
  const attributedSystemSummaries = buildSystemTelemetrySummaries(
    recentUsageBuckets,
    costLookup,
    6
  );
  const telemetryAnomalies = buildTelemetryAnomalies(recentUsageBuckets, costLookup, {
    now,
    take: 8,
  });
  const modelDriftFindings = buildModelDriftFindings(recentUsageBuckets, costLookup, 8);
  const exposureFindings = buildDataExposureFindings(recentUsageBuckets, costLookup, 8);
  const exposureSummary = summarizeDataExposureFindings(exposureFindings);
  const totalCost = costBuckets.reduce((s: number, bucket) => s + bucket.amount, 0);
  const totalTokens = providerStats.reduce((s: number, p) => s + (p._sum.totalTokens ?? 0), 0);
  const attributedTokens = recentUsageBuckets
    .filter((bucket) => bucket.aiSystemId)
    .reduce((sum: number, bucket) => sum + bucket.totalTokens, 0);
  const attributedCoverage = totalTokens > 0 ? Math.round((attributedTokens / totalTokens) * 100) : 0;
  const trackedEntities = new Set(
    recentUsageBuckets.map((bucket) => getTelemetryAttributionLabel(bucket))
  ).size;
  const latestSuccessByProvider = syncRuns.reduce<Record<string, Date | null>>((acc: Record<string, Date | null>, run) => {
    if (run.status === "SUCCEEDED" && !acc[run.provider]) acc[run.provider] = run.completedAt;
    return acc;
  }, {});
  const staleProviders = Object.entries(latestSuccessByProvider)
    .filter(([, completedAt]) => !completedAt || now.getTime() - new Date(completedAt as Date).getTime() > 24 * 60 * 60 * 1000)
    .map(([provider]) => provider);

  const recentSevenDayCost = costBuckets
    .filter((bucket) => bucket.bucketStart >= recentCostWindowStart)
    .reduce((sum: number, bucket) => sum + bucket.amount, 0);
  const previousSevenDayCost = costBuckets
    .filter((bucket) => bucket.bucketStart >= previousCostWindowStart && bucket.bucketStart < recentCostWindowStart)
    .reduce((sum: number, bucket) => sum + bucket.amount, 0);
  const spendSpike =
    previousSevenDayCost > 0 && recentSevenDayCost > previousSevenDayCost * 1.5;

  const latestFailedSync = syncRuns.find((run) => run.status === "FAILED");
  const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const currentMonthBuckets = recentUsageBuckets.filter(
    (bucket) => bucket.bucketStart >= currentMonthStart
  );
  const spendByScope = new Map<string, number>();
  const departmentTotals = new Map<string, number>();
  for (const bucket of currentMonthBuckets) {
    const bucketCost = costLookup.get([
      bucket.provider,
      bucket.bucketStart.toISOString(),
      bucket.bucketEnd.toISOString(),
      bucket.granularity,
      bucket.dimensionKey,
    ].join(":")) ?? 0;
    spendByScope.set(
      `PROVIDER:${bucket.provider}`,
      (spendByScope.get(`PROVIDER:${bucket.provider}`) ?? 0) + bucketCost
    );
    if (bucket.aiSystemId && bucket.aiSystem) {
      spendByScope.set(
        `AI_SYSTEM:${bucket.aiSystemId}`,
        (spendByScope.get(`AI_SYSTEM:${bucket.aiSystemId}`) ?? 0) + bucketCost
      );
      departmentTotals.set(
        bucket.aiSystem.department,
        (departmentTotals.get(bucket.aiSystem.department) ?? 0) + bucketCost
      );
      spendByScope.set(
        `DEPARTMENT:${bucket.aiSystem.department}`,
        (spendByScope.get(`DEPARTMENT:${bucket.aiSystem.department}`) ?? 0) + bucketCost
      );
    }
  }
  const budgetSummaries = summarizeSpendBudgets({
    budgets: spendBudgets,
    spendByScope,
    now,
  });
  const topCostDrivers = getTopCostDrivers({
    providerTotals: costByProvider,
    systemTotals: attributedSystemSummaries.map((summary) => ({
      label: summary.systemName,
      amount: summary.cost,
    })),
    departmentTotals: [...departmentTotals.entries()].map(([label, amount]) => ({
      label,
      amount,
    })),
    take: 6,
  });
  const oversightRecommendations = getOversightRecommendations({
    staleProviders,
    latestFailedSyncMessage: latestFailedSync?.errorMessage ?? null,
    exposureFindingCount: exposureSummary.totalFindings,
    openInvestigations: investigations.length,
    unattributedCoverageGapPct: 100 - attributedCoverage,
    driftAlerts,
    anomalyCount: telemetryAnomalies.length,
    modelDriftCount: modelDriftFindings.length,
    budgetSummaries,
    recentAlerts: [],
  });

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
        <Link href="/oversight/investigations">
          <Button variant="outline">
            <AlertTriangle className="mr-2 h-4 w-4" /> Investigations
          </Button>
        </Link>
      </PageHeader>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-7">
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
        <StatCard
          title="Exposure Signals"
          value={exposureSummary.totalFindings}
          description={
            exposureSummary.criticalFindings > 0
              ? `${exposureSummary.criticalFindings} critical`
              : "No critical signals"
          }
          iconName="AlertTriangle"
          variant={exposureSummary.totalFindings > 0 ? "warning" : "success"}
        />
        <StatCard
          title="Anomalies"
          value={telemetryAnomalies.length}
          description={telemetryAnomalies.length > 0 ? telemetryAnomalies[0]?.label : "No recent spikes"}
          iconName="TrendingUp"
          variant={
            telemetryAnomalies.some((finding) => finding.severity === "critical")
              ? "danger"
              : telemetryAnomalies.length > 0
                ? "warning"
                : "success"
          }
        />
        <StatCard
          title="Model Drift"
          value={modelDriftFindings.length}
          description={modelDriftFindings.length > 0 ? modelDriftFindings[0]?.systemName : "No model drift"}
          iconName="GitBranch"
          variant={
            modelDriftFindings.some((finding) => finding.severity === "critical")
              ? "danger"
              : modelDriftFindings.length > 0
                ? "warning"
                : "success"
          }
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
                {providerStats.map((p: { provider: string; _count: number; _sum: { totalTokens: number | null } }) => (
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

      <Card>
        <CardHeader>
          <CardTitle>Governed System Telemetry Attribution</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="rounded-lg border border-[var(--border-subtle)] p-4">
              <p className="text-xs uppercase tracking-wider text-[var(--text-faint)]">
                Attributed Coverage
              </p>
              <p className="mt-2 text-2xl font-semibold">{attributedCoverage}%</p>
              <p className="mt-1 text-xs text-[var(--text-muted)]">
                Of recent token volume is linked to a governed system
              </p>
            </div>
            <div className="rounded-lg border border-[var(--border-subtle)] p-4">
              <p className="text-xs uppercase tracking-wider text-[var(--text-faint)]">
                Governed Systems Seen
              </p>
              <p className="mt-2 text-2xl font-semibold">{attributedSystemSummaries.length}</p>
              <p className="mt-1 text-xs text-[var(--text-muted)]">
                Systems with attributed telemetry in the last 30 days
              </p>
            </div>
            <div className="rounded-lg border border-[var(--border-subtle)] p-4">
              <p className="text-xs uppercase tracking-wider text-[var(--text-faint)]">
                Unattributed Gap
              </p>
              <p className="mt-2 text-2xl font-semibold">
                {(100 - attributedCoverage).toLocaleString()}%
              </p>
              <p className="mt-1 text-xs text-[var(--text-muted)]">
                Remaining recent token volume to map to governed systems
              </p>
            </div>
          </div>

          {attributedSystemSummaries.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)]">
              No governed systems have attributed telemetry yet. Link usage buckets from the usage page to start system-level oversight.
            </p>
          ) : (
            <div className="space-y-3">
              {attributedSystemSummaries.map((summary) => (
                <Link
                  key={summary.aiSystemId}
                  href={`/registry/${summary.aiSystemId}`}
                  className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-[var(--border-subtle)] p-4 hover:bg-[var(--bg-hover)]"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-medium">{summary.systemName}</p>
                      <Badge variant="info">{summary.department}</Badge>
                      <Badge variant="outline">{summary.status.replace(/_/g, " ")}</Badge>
                      <Badge variant={summary.dataSensitivity === "RESTRICTED" ? "critical" : "warning"}>
                        {summary.dataSensitivity}
                      </Badge>
                    </div>
                    <p className="mt-1 text-xs text-[var(--text-muted)]">
                      {summary.bucketCount} buckets · {summary.providerCount} providers · last seen {formatDateTime(summary.lastSeen)}
                    </p>
                  </div>
                  <div className="text-right text-sm">
                    <p className="font-semibold">{summary.tokens.toLocaleString()} tokens</p>
                    <p className="text-xs text-[var(--text-muted)]">
                      {summary.requests.toLocaleString()} requests · ${summary.cost.toFixed(2)}
                    </p>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

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
            ...(telemetryAnomalies.length > 0
              ? [{
                  label: "Usage or cost anomalies detected",
                  description: "Provider, model, or project activity spiked versus the prior baseline window.",
                  count: telemetryAnomalies.length,
                  href: "/oversight/usage",
                  tone: telemetryAnomalies.some((finding) => finding.severity === "critical") ? "critical" as const : "warning" as const,
                }]
              : []),
            ...(modelDriftFindings.length > 0
              ? [{
                  label: "Governed-system model drift",
                  description: "Observed providers or model families differ from the governed system posture.",
                  count: modelDriftFindings.length,
                  href: "/oversight",
                  tone: modelDriftFindings.some((finding) => finding.severity === "critical") ? "critical" as const : "warning" as const,
                }]
              : []),
            ...(exposureSummary.totalFindings > 0
              ? [{
                  label: "Restricted-data exposure signals",
                  description:
                    exposureSummary.restrictedSystemFindings > 0
                      ? `${exposureSummary.restrictedSystemFindings} findings are tied to systems already classified as restricted.`
                      : "Provider-visible telemetry includes sensitive markers that merit review.",
                  count: exposureSummary.totalFindings,
                  href: "/oversight/usage",
                  tone: exposureSummary.criticalFindings > 0 ? "critical" as const : "warning" as const,
                }]
              : []),
            ...(investigations.length > 0
              ? [{
                  label: "Open investigations",
                  description: "Alerts and incidents already in follow-up need owner attention and closure tracking.",
                  count: investigations.length,
                  href: "/oversight/investigations",
                  tone: "warning" as const,
                }]
              : []),
            ...(budgetSummaries.filter((budget) => budget.pacingStatus !== "on_track").length > 0
              ? [{
                  label: "Spend budgets are off pace",
                  description: "One or more provider, system, or department budgets are above warning thresholds.",
                  count: budgetSummaries.filter((budget) => budget.pacingStatus !== "on_track").length,
                  href: "/oversight",
                  tone: budgetSummaries.some((budget) => budget.pacingStatus === "critical") ? "critical" as const : "warning" as const,
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

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Oversight Recommendations</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {oversightRecommendations.map((recommendation) => (
              <Link
                key={recommendation.key}
                href={recommendation.href}
                className="block rounded-lg border border-[var(--border-subtle)] p-4 hover:bg-[var(--bg-hover)]"
              >
                <div className="flex items-center gap-2">
                  <Badge
                    variant={
                      recommendation.tone === "critical"
                        ? "critical"
                        : recommendation.tone === "warning"
                          ? "warning"
                          : recommendation.tone === "success"
                            ? "success"
                            : "info"
                    }
                  >
                    {recommendation.tone}
                  </Badge>
                  <p className="text-sm font-medium text-[var(--text-primary)]">
                    {recommendation.title}
                  </p>
                </div>
                <p className="mt-2 text-sm text-[var(--text-secondary)]">
                  {recommendation.detail}
                </p>
              </Link>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Active Investigations</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {investigations.length === 0 ? (
              <p className="text-sm text-[var(--text-muted)]">
                No active investigations right now.
              </p>
            ) : (
              investigations.map((investigation: {
                id: string;
                title: string;
                status: string;
                summary: string | null;
                ownerUser?: { name: string | null; email: string | null } | null;
              }) => (
                <Link
                  key={investigation.id}
                  href="/oversight/investigations"
                  className="block rounded-lg border border-[var(--border-subtle)] p-4 hover:bg-[var(--bg-hover)]"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={investigation.status === "OPEN" ? "critical" : "warning"}>
                      {investigation.status.replace(/_/g, " ")}
                    </Badge>
                    <p className="text-sm font-medium text-[var(--text-primary)]">
                      {investigation.title}
                    </p>
                  </div>
                  <p className="mt-1 text-xs text-[var(--text-muted)]">
                    Owner: {investigation.ownerUser?.name ?? investigation.ownerUser?.email ?? "Unassigned"}
                  </p>
                  {investigation.summary && (
                    <p className="mt-2 text-sm text-[var(--text-secondary)]">
                      {investigation.summary}
                    </p>
                  )}
                </Link>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Telemetry Anomalies</CardTitle>
          </CardHeader>
          <CardContent>
            {telemetryAnomalies.length === 0 ? (
              <p className="text-sm text-[var(--text-muted)]">
                No provider, model, or project spikes exceeded the current baseline thresholds.
              </p>
            ) : (
              <div className="space-y-3">
                {telemetryAnomalies.map((anomaly) => (
                  <div
                    key={anomaly.id}
                    className="rounded-lg border border-[var(--border-subtle)] p-4"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge
                            variant={
                              anomaly.severity === "critical"
                                ? "critical"
                                : anomaly.severity === "warning"
                                  ? "warning"
                                  : "info"
                            }
                          >
                            {anomaly.scope.toUpperCase()}
                          </Badge>
                          <p className="text-sm font-medium text-[var(--text-primary)]">
                            {anomaly.label}
                          </p>
                        </div>
                        <p className="mt-1 text-xs text-[var(--text-muted)]">
                          {anomaly.reasons.join(" ")}
                        </p>
                      </div>
                      <div className="text-right text-xs text-[var(--text-faint)]">
                        <p>{anomaly.recentTokens.toLocaleString()} recent tokens</p>
                        <p>${anomaly.recentCost.toFixed(2)} recent cost</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Model Drift Tracking</CardTitle>
          </CardHeader>
          <CardContent>
            {modelDriftFindings.length === 0 ? (
              <p className="text-sm text-[var(--text-muted)]">
                No governed systems show provider or model-family drift in recent telemetry.
              </p>
            ) : (
              <div className="space-y-3">
                {modelDriftFindings.map((finding) => (
                  <Link
                    key={finding.id}
                    href={`/registry/${finding.aiSystemId}`}
                    className="block rounded-lg border border-[var(--border-subtle)] p-4 hover:bg-[var(--bg-hover)]"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge
                            variant={
                              finding.severity === "critical"
                                ? "critical"
                                : finding.severity === "warning"
                                  ? "warning"
                                  : "info"
                            }
                          >
                            DRIFT
                          </Badge>
                          <p className="text-sm font-medium text-[var(--text-primary)]">
                            {finding.systemName}
                          </p>
                        </div>
                        <p className="mt-1 text-xs text-[var(--text-muted)]">
                          {finding.reasons.join(" ")}
                        </p>
                        <p className="mt-2 text-xs text-[var(--text-faint)]">
                          Expected: {finding.expectedVendor ?? "Unknown vendor"} / {finding.expectedModelType ?? "Unknown model"} · Observed:{" "}
                          {finding.observedProviders.join(", ")} / {finding.observedModels.join(", ")}
                        </p>
                      </div>
                      <p className="text-xs text-[var(--text-faint)]">
                        {formatDateTime(finding.lastSeen)}
                      </p>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Spend Governance</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <SpendBudgetManager budgets={spendBudgets} />
            {budgetSummaries.length > 0 && (
              <div className="space-y-3">
                {budgetSummaries.map((budget) => (
                  <div
                    key={budget.id}
                    className="rounded-lg border border-[var(--border-subtle)] p-4"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium text-[var(--text-primary)]">{budget.label}</p>
                        <p className="text-xs text-[var(--text-muted)]">
                          {budget.scopeType.replace("_", " ")} · {budget.currentSpend.toFixed(2)} / {budget.monthlyBudget.toFixed(2)}
                        </p>
                      </div>
                      <Badge
                        variant={
                          budget.pacingStatus === "critical"
                            ? "critical"
                            : budget.pacingStatus === "warning"
                              ? "warning"
                              : "success"
                        }
                      >
                        {budget.pacingStatus.replace("_", " ")}
                      </Badge>
                    </div>
                    <p className="mt-2 text-xs text-[var(--text-secondary)]">
                      Utilization {budget.utilizationPct.toFixed(1)}% · projected month end ${budget.projectedMonthEndSpend.toFixed(2)}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Top Cost Drivers</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {topCostDrivers.length === 0 ? (
              <p className="text-sm text-[var(--text-muted)]">
                No cost drivers yet.
              </p>
            ) : (
              topCostDrivers.map((driver) => (
                <div
                  key={`${driver.scopeType}:${driver.label}`}
                  className="flex items-center justify-between rounded-lg border border-[var(--border-subtle)] p-3"
                >
                  <div>
                    <p className="text-sm font-medium text-[var(--text-primary)]">{driver.label}</p>
                    <p className="text-xs text-[var(--text-muted)] capitalize">{driver.scopeType}</p>
                  </div>
                  <p className="text-sm font-semibold">${driver.amount.toFixed(2)}</p>
                </div>
              ))
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

      <Card>
        <CardHeader>
          <CardTitle>Restricted-Data Exposure Monitoring</CardTitle>
        </CardHeader>
        <CardContent>
          {exposureFindings.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)]">
              No restricted-data exposure signals were detected from recent provider-visible telemetry.
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
                      <p className="mt-1">${finding.cost.toFixed(4)}</p>
                    </div>
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
