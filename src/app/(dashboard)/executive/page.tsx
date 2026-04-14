import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PostureScorecard } from "@/components/executive/posture-scorecard";
import { BoardSummaryCards } from "@/components/executive/board-summary-cards";
import { PostureNarrative } from "@/components/executive/posture-narrative";
import {
  PostureTrendChart,
  type PostureTrendPoint,
} from "@/components/executive/posture-trend-chart";
import { SegmentRiskHeatmap } from "@/components/dashboard/segment-risk-heatmap";
import {
  computeExecutivePosture,
  type PostureMetrics,
} from "@/lib/executive-posture";
import { formatDate } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const revalidate = 0;

async function gatherMetrics(
  periodStart: Date,
  periodEnd: Date
): Promise<PostureMetrics> {
  const [
    systemsByStatus,
    systemsByRisk,
    complianceMappings,
    discoveredToolsByStatus,
    openIncidents,
    criticalAlerts,
    openAlerts,
    costBuckets,
    riskAssessments,
  ] = await Promise.all([
    prisma.aISystem.groupBy({
      by: ["status"],
      _count: true,
      where: { createdAt: { lte: periodEnd } },
    }),
    prisma.aISystem.groupBy({
      by: ["riskLevel"],
      _count: true,
      where: { createdAt: { lte: periodEnd } },
    }),
    prisma.complianceMapping.groupBy({
      by: ["status"],
      _count: true,
    }),
    prisma.discoveredAITool.groupBy({
      by: ["status"],
      _count: true,
      where: { detectedAt: { lte: periodEnd } },
    }),
    prisma.governanceIncident.count({
      where: {
        status: { in: ["OPEN", "ACKNOWLEDGED"] },
        openedAt: { gte: periodStart, lte: periodEnd },
      },
    }),
    prisma.alert.count({
      where: {
        severity: "CRITICAL",
        status: "OPEN",
        createdAt: { gte: periodStart, lte: periodEnd },
      },
    }),
    prisma.alert.count({
      where: {
        status: "OPEN",
        createdAt: { gte: periodStart, lte: periodEnd },
      },
    }),
    prisma.costBucket.findMany({
      where: { bucketStart: { gte: periodStart, lte: periodEnd } },
      select: { amount: true, provider: true },
    }),
    prisma.riskAssessment.findMany({
      where: { createdAt: { lte: periodEnd } },
      select: { overallScore: true },
      orderBy: { createdAt: "desc" },
      take: 200,
    }),
  ]);

  // System counts
  const totalSystems = systemsByStatus.reduce((s, g) => s + g._count, 0);
  const approvedOrDeployed = systemsByStatus
    .filter((g) => g.status === "APPROVED" || g.status === "DEPLOYED")
    .reduce((s, g) => s + g._count, 0);
  const draftOrReview = systemsByStatus
    .filter((g) => g.status === "DRAFT" || g.status === "UNDER_REVIEW")
    .reduce((s, g) => s + g._count, 0);

  // Compliance
  const totalComplianceMappings = complianceMappings.reduce(
    (s, g) => s + g._count,
    0
  );
  const compliantMappings =
    complianceMappings.find((g) => g.status === "COMPLIANT")?._count ?? 0;

  // Risk
  const avgRiskScore =
    riskAssessments.length > 0
      ? riskAssessments.reduce((s, r) => s + r.overallScore, 0) /
        riskAssessments.length
      : 0;
  const highOrCriticalSystems = systemsByRisk
    .filter((g) => g.riskLevel === "HIGH" || g.riskLevel === "CRITICAL")
    .reduce((s, g) => s + g._count, 0);

  // Shadow AI
  const discoveredTools =
    discoveredToolsByStatus.find((g) => g.status === "DISCOVERED")?._count ?? 0;
  const underReviewTools =
    discoveredToolsByStatus.find((g) => g.status === "UNDER_REVIEW")?._count ??
    0;
  const totalDiscoveryTools = discoveredToolsByStatus.reduce(
    (s, g) => s + g._count,
    0
  );

  // Spend
  const totalSpend = costBuckets.reduce((s, b) => s + b.amount, 0);
  const providerTotals = new Map<string, number>();
  for (const b of costBuckets) {
    providerTotals.set(
      b.provider,
      (providerTotals.get(b.provider) ?? 0) + b.amount
    );
  }
  let topProvider: string | null = null;
  let topProviderSpend = 0;
  for (const [provider, amount] of providerTotals) {
    if (amount > topProviderSpend) {
      topProvider = provider;
      topProviderSpend = amount;
    }
  }

  return {
    totalSystems,
    approvedOrDeployed,
    draftOrReview,
    totalComplianceMappings,
    compliantMappings,
    avgRiskScore,
    highOrCriticalSystems,
    discoveredTools,
    underReviewTools,
    totalDiscoveryTools,
    openIncidents,
    criticalAlerts,
    openAlerts,
    totalSpend,
    topProvider,
    topProviderSpend,
  };
}

export default async function ExecutivePage() {
  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const sixtyDaysAgo = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);

  // Gather current and prior period metrics in parallel
  const [currentMetrics, priorMetrics] = await Promise.all([
    gatherMetrics(thirtyDaysAgo, now),
    gatherMetrics(sixtyDaysAgo, thirtyDaysAgo),
  ]);

  const posture = computeExecutivePosture(currentMetrics, priorMetrics);

  // Build 12-month posture trend
  const trendData: PostureTrendPoint[] = [];
  const twelveMonthsAgo = new Date(now);
  twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12);

  // Fetch monthly snapshots for trend
  const [allSystems, allComplianceMappings, allRiskAssessments] =
    await Promise.all([
      prisma.aISystem.findMany({
        where: { createdAt: { lte: now } },
        select: { status: true, createdAt: true },
      }),
      prisma.complianceMapping.findMany({
        select: { status: true, updatedAt: true },
      }),
      prisma.riskAssessment.findMany({
        where: { createdAt: { gte: twelveMonthsAgo } },
        select: { overallScore: true, createdAt: true },
        orderBy: { createdAt: "asc" },
      }),
    ]);

  // Build month-by-month trend
  for (let i = 11; i >= 0; i--) {
    const monthEnd = new Date(now);
    monthEnd.setMonth(monthEnd.getMonth() - i);
    monthEnd.setDate(1);
    if (i > 0) {
      monthEnd.setDate(0); // last day of prior month
    } else {
      monthEnd.setTime(now.getTime()); // current month uses today
    }

    const periodLabel = monthEnd.toLocaleDateString("en-US", {
      month: "short",
      year: "2-digit",
    });

    // Systems approved/ungoverned at that point
    const systemsAtPoint = allSystems.filter(
      (s) => s.createdAt <= monthEnd
    );
    const approved = systemsAtPoint.filter(
      (s) => s.status === "APPROVED" || s.status === "DEPLOYED"
    ).length;
    const total = systemsAtPoint.length;
    const ungoverned = systemsAtPoint.filter(
      (s) => s.status === "DRAFT" || s.status === "UNDER_REVIEW"
    ).length;

    // Governance score approximation (coverage-based)
    const governanceScore =
      total > 0 ? Math.round((approved / total) * 100) : 100;

    // Compliance rate at that month
    // Note: compliance mappings don't have per-month snapshots, so we use current state
    // This is a simplification — in production you'd use audit logs for historical snapshots
    const totalMappings = allComplianceMappings.length;
    const compliant = allComplianceMappings.filter(
      (m) => m.status === "COMPLIANT"
    ).length;
    const complianceRate =
      totalMappings > 0 ? Math.round((compliant / totalMappings) * 100) : 100;

    // Risk health (inverted avg score for assessments up to that month)
    const assessmentsAtPoint = allRiskAssessments.filter(
      (r) => r.createdAt <= monthEnd
    );
    const avgRisk =
      assessmentsAtPoint.length > 0
        ? assessmentsAtPoint.reduce((s, r) => s + r.overallScore, 0) /
          assessmentsAtPoint.length
        : 0;
    const riskScore = Math.round(100 - avgRisk);

    trendData.push({
      period: periodLabel,
      governanceScore,
      complianceRate,
      riskScore,
      approved,
      ungoverned,
    });
  }

  // Risk segment heatmap (reuse dashboard pattern)
  const systemsForSegments = await prisma.aISystem.findMany({
    where: { status: { not: "RETIRED" } },
    select: {
      department: true,
      vendor: true,
      riskLevel: true,
      riskAssessments: {
        select: { overallScore: true },
        orderBy: { createdAt: "desc" },
        take: 1,
      },
    },
  });

  const deptSegments = new Map<
    string,
    { systems: number; totalScore: number; highRisk: number }
  >();
  for (const sys of systemsForSegments) {
    const key = sys.department || "Unassigned";
    const existing = deptSegments.get(key) ?? {
      systems: 0,
      totalScore: 0,
      highRisk: 0,
    };
    existing.systems++;
    existing.totalScore += sys.riskAssessments[0]?.overallScore ?? 0;
    if (sys.riskLevel === "HIGH" || sys.riskLevel === "CRITICAL") {
      existing.highRisk++;
    }
    deptSegments.set(key, existing);
  }
  const deptRows = [...deptSegments.entries()]
    .map(([label, data]) => ({
      label,
      systems: data.systems,
      avgScore: data.systems > 0 ? Math.round(data.totalScore / data.systems) : 0,
      highRisk: data.highRisk,
    }))
    .sort((a, b) => b.avgScore - a.avgScore)
    .slice(0, 6);

  const vendorSegments = new Map<
    string,
    { systems: number; totalScore: number; highRisk: number }
  >();
  for (const sys of systemsForSegments) {
    const key = sys.vendor || "Unknown";
    const existing = vendorSegments.get(key) ?? {
      systems: 0,
      totalScore: 0,
      highRisk: 0,
    };
    existing.systems++;
    existing.totalScore += sys.riskAssessments[0]?.overallScore ?? 0;
    if (sys.riskLevel === "HIGH" || sys.riskLevel === "CRITICAL") {
      existing.highRisk++;
    }
    vendorSegments.set(key, existing);
  }
  const vendorRows = [...vendorSegments.entries()]
    .map(([label, data]) => ({
      label,
      systems: data.systems,
      avgScore: data.systems > 0 ? Math.round(data.totalScore / data.systems) : 0,
      highRisk: data.highRisk,
    }))
    .sort((a, b) => b.avgScore - a.avgScore)
    .slice(0, 6);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Executive Dashboard"
        description="Board-ready AI governance posture overview with trend storytelling and period-over-period deltas"
      />

      {/* Hero: Scorecard + Narrative */}
      <div className="grid gap-6 xl:grid-cols-[320px_1fr]">
        <PostureScorecard score={posture.score} />
        <PostureNarrative
          narrative={posture.narrative}
          tier={posture.score.tier}
          generatedAt={formatDate(now)}
        />
      </div>

      {/* Board KPI Cards */}
      <BoardSummaryCards metrics={posture.boardMetrics} />

      {/* Posture Trend */}
      <Card>
        <CardHeader>
          <CardTitle>12-Month Posture Trend</CardTitle>
        </CardHeader>
        <CardContent>
          <PostureTrendChart data={trendData} />
        </CardContent>
      </Card>

      {/* Risk Concentration */}
      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Risk by Department</CardTitle>
          </CardHeader>
          <CardContent>
            <SegmentRiskHeatmap title="Department" rows={deptRows} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Risk by Vendor</CardTitle>
          </CardHeader>
          <CardContent>
            <SegmentRiskHeatmap title="Vendor" rows={vendorRows} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
