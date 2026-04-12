import Link from "next/link";
import { Plus } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { StatCard } from "@/components/dashboard/stat-card";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { RiskHeatMap } from "@/components/dashboard/risk-heat-map";
import { DimensionDistributionChart } from "@/components/dashboard/dimension-distribution-chart";
import { RiskTierTrendChart } from "@/components/dashboard/risk-tier-trend-chart";
import { Badge, riskBadgeVariant } from "@/components/ui/badge";
import { formatDate } from "@/lib/utils";
import {
  getAgentRiskSummary,
  getApprovedStages,
  getRequiredStages,
  getRiskControlGaps,
  getSystemAgentOverlay,
  type RiskScores,
} from "@/lib/risk-center";

export default async function RiskCenterPage() {
  const [assessments, systemRisks, recentAssessments, allAssessments, reassessmentAlerts, systemsForControlGaps, agents] = await Promise.all([
    // Get latest assessment per system for heat map
    prisma.$queryRaw<
      {
        systemId: string;
        systemName: string;
        biasScore: number;
        securityScore: number;
        privacyScore: number;
        fairnessScore: number;
        performanceScore: number;
        transparencyScore: number;
      }[]
    >`
      SELECT DISTINCT ON (ra."aiSystemId")
        s.id as "systemId",
        s.name as "systemName",
        ra."biasScore",
        ra."securityScore",
        ra."privacyScore",
        ra."fairnessScore",
        ra."performanceScore",
        ra."transparencyScore"
      FROM "RiskAssessment" ra
      JOIN "AISystem" s ON ra."aiSystemId" = s.id
      ORDER BY ra."aiSystemId", ra."createdAt" DESC
    `,
    prisma.aISystem.groupBy({
      by: ["riskLevel"],
      _count: true,
    }),
    prisma.riskAssessment.findMany({
      take: 10,
      orderBy: { createdAt: "desc" },
      include: { aiSystem: { select: { name: true } } },
    }),
    // All assessments for risk tier trend (ordered chronologically)
    prisma.riskAssessment.findMany({
      orderBy: { createdAt: "asc" },
      select: { aiSystemId: true, overallScore: true, createdAt: true },
    }),
    prisma.alert.findMany({
      where: {
        source: "risk_reassessment",
        status: { in: ["OPEN", "ACKNOWLEDGED"] },
        aiSystemId: { not: null },
      },
      orderBy: { createdAt: "desc" },
      include: {
        aiSystem: {
          select: {
            id: true,
            name: true,
            department: true,
          },
        },
      },
      take: 8,
    }),
    prisma.aISystem.findMany({
      include: {
        riskAssessments: {
          orderBy: { createdAt: "desc" },
          take: 1,
        },
        policyAssignments: {
          select: {
            complianceStatus: true,
          },
        },
        governanceReviews: {
          orderBy: { createdAt: "desc" },
          select: {
            stage: true,
            approved: true,
          },
        },
        approvals: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: {
            decision: true,
          },
        },
        governanceIncidents: {
          where: { status: { in: ["OPEN", "ACKNOWLEDGED"] } },
          select: {
            id: true,
          },
        },
        agents: {
          select: {
            id: true,
            name: true,
            autonomyLevel: true,
            humanReviewRequired: true,
            humanReviewTriggers: true,
            connectedSystems: true,
            riskLevel: true,
            status: true,
            aiSystemId: true,
          },
        },
        _count: {
          select: {
            evidenceArtifacts: true,
          },
        },
      },
      take: 20,
      orderBy: { updatedAt: "desc" },
    }),
    prisma.aIAgent.findMany({
      include: {
        aiSystem: {
          select: {
            id: true,
            name: true,
            riskLevel: true,
          },
        },
      },
      orderBy: { updatedAt: "desc" },
      take: 30,
    }),
  ]);

  const riskCounts: Record<string, number> = {};
  systemRisks.forEach((r) => {
    riskCounts[r.riskLevel] = r._count;
  });

  // --- Dimension distribution data ---
  const dimensionKeys = [
    { key: "biasScore" as const, label: "Bias" },
    { key: "securityScore" as const, label: "Security" },
    { key: "privacyScore" as const, label: "Privacy" },
    { key: "fairnessScore" as const, label: "Fairness" },
    { key: "performanceScore" as const, label: "Perform." },
    { key: "transparencyScore" as const, label: "Transp." },
  ];

  function scoreToBucket(score: number): string {
    if (score >= 80) return "Critical";
    if (score >= 60) return "High";
    if (score >= 40) return "Medium";
    if (score >= 20) return "Low";
    return "Minimal";
  }

  const dimensionDistribution = dimensionKeys.map(({ key, label }) => {
    const bucketCounts: Record<string, number> = { Minimal: 0, Low: 0, Medium: 0, High: 0, Critical: 0 };
    for (const row of assessments) {
      bucketCounts[scoreToBucket(row[key])] += 1;
    }
    return { dimension: label, ...bucketCounts } as {
      dimension: string; Minimal: number; Low: number; Medium: number; High: number; Critical: number;
    };
  });

  // --- Risk tier trend data ---
  function scoreToTier(score: number): string {
    if (score >= 80) return "CRITICAL";
    if (score >= 60) return "HIGH";
    if (score >= 40) return "MEDIUM";
    if (score >= 20) return "LOW";
    return "MINIMAL";
  }

  type TierSnapshot = { date: string; CRITICAL: number; HIGH: number; MEDIUM: number; LOW: number; MINIMAL: number };

  function buildTierSnapshot(date: string, tiers: Iterable<string>): TierSnapshot {
    const s: TierSnapshot = { date, CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0, MINIMAL: 0 };
    for (const tier of tiers) {
      if (tier in s && tier !== "date") s[tier as keyof Omit<TierSnapshot, "date">] += 1;
    }
    return s;
  }

  const riskTierTrend: TierSnapshot[] = [];
  if (allAssessments.length > 0) {
    const latestTierBySystem = new Map<string, string>();
    let lastDate = "";

    for (const a of allAssessments) {
      const date = a.createdAt.toISOString().split("T")[0];
      latestTierBySystem.set(a.aiSystemId, scoreToTier(a.overallScore));

      if (date !== lastDate && lastDate !== "") {
        riskTierTrend.push(buildTierSnapshot(lastDate, latestTierBySystem.values()));
      }
      lastDate = date;
    }
    riskTierTrend.push(buildTierSnapshot(lastDate, latestTierBySystem.values()));
  }

  const controlGapQueue = systemsForControlGaps.reduce<
    Array<{
      id: string;
      name: string;
      department: string;
      gaps: ReturnType<typeof getRiskControlGaps>;
    }>
  >((acc, system) => {
      const latestAssessment = system.riskAssessments[0];
      if (!latestAssessment) return acc;

      const scores: RiskScores = {
        biasScore: latestAssessment.biasScore,
        securityScore: latestAssessment.securityScore,
        privacyScore: latestAssessment.privacyScore,
        fairnessScore: latestAssessment.fairnessScore,
        performanceScore: latestAssessment.performanceScore,
        transparencyScore: latestAssessment.transparencyScore,
      };

      const gaps = getRiskControlGaps({
        system: {
          id: system.id,
          name: system.name,
          department: system.department,
          vendor: system.vendor,
          modelType: system.modelType,
          useCase: system.useCase,
          dataInputs: system.dataInputs,
          dataOutputs: system.dataOutputs,
          dataSensitivity: system.dataSensitivity,
          reviewIntervalDays: system.reviewIntervalDays,
        },
        scores,
        agents: system.agents,
        policyAssignments: system.policyAssignments,
        evidenceArtifactCount: system._count.evidenceArtifacts,
        requiredStages: getRequiredStages(system),
        approvedStages: getApprovedStages(system.governanceReviews),
        latestApprovalDecision: system.approvals[0]?.decision ?? null,
        openIncidentCount: system.governanceIncidents.length,
      });

      if (gaps.length === 0) return acc;

      acc.push({
        id: system.id,
        name: system.name,
        department: system.department,
        gaps,
      });

      return acc;
    }, [])
    .sort((a, b) => b.gaps.length - a.gaps.length)
    .slice(0, 6);

  const agentRiskSummaries = agents
    .map((agent) => ({
      agent,
      summary: getAgentRiskSummary(agent, agent.aiSystem?.riskLevel),
    }))
    .sort((a, b) => b.summary.overlayScore - a.summary.overlayScore);

  const agentsNeedingReview = agentRiskSummaries.filter(({ summary }) => summary.reviewNeeded);
  const linkedAgentReviewCount = systemsForControlGaps.reduce(
    (sum, system) => sum + getSystemAgentOverlay(system.agents, system.riskLevel).reviewNeededCount,
    0
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Risk Center"
        description="Monitor and assess AI risk across your organization"
      >
        <Link href="/risk-center/assessments/new">
          <Button className="bg-[var(--accent)] text-[var(--bg-deep)] hover:brightness-110">
            <Plus className="mr-2 h-4 w-4" /> New Assessment
          </Button>
        </Link>
      </PageHeader>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <StatCard title="Critical" value={riskCounts.CRITICAL ?? 0} iconName="ShieldAlert" variant="danger" />
        <StatCard title="High" value={riskCounts.HIGH ?? 0} iconName="ShieldAlert" variant="warning" />
        <StatCard title="Medium" value={riskCounts.MEDIUM ?? 0} iconName="ShieldAlert" variant="default" />
        <StatCard title="Low" value={riskCounts.LOW ?? 0} iconName="ShieldAlert" variant="success" />
        <StatCard title="Minimal" value={riskCounts.MINIMAL ?? 0} iconName="ShieldAlert" variant="info" />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard title="Registered Agents" value={agents.length} iconName="Bot" variant="info" />
        <StatCard title="Agents Needing Review" value={agentsNeedingReview.length} iconName="Bot" variant={agentsNeedingReview.length > 0 ? "warning" : "success"} />
        <StatCard title="Linked Agent Review Signals" value={linkedAgentReviewCount} iconName="ShieldAlert" variant={linkedAgentReviewCount > 0 ? "warning" : "success"} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Risk Heat Map</CardTitle>
        </CardHeader>
        <CardContent>
          <RiskHeatMap data={assessments} />
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Risk by Dimension</CardTitle>
          </CardHeader>
          <CardContent>
            <DimensionDistributionChart data={dimensionDistribution} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Risk Tier Trend</CardTitle>
          </CardHeader>
          <CardContent>
            <RiskTierTrendChart data={riskTierTrend} />
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Reassessment Queue</CardTitle>
          </CardHeader>
          <CardContent>
            {reassessmentAlerts.length === 0 ? (
              <p className="text-sm text-[var(--text-muted)]">
                No systems are currently flagged for reassessment due to drift.
              </p>
            ) : (
              <div className="space-y-3">
                {reassessmentAlerts.map((alert) => (
                  <Link
                    key={alert.id}
                    href={alert.aiSystemId ? `/registry/${alert.aiSystemId}` : "/alerts"}
                    className="block rounded-md border border-[var(--border-subtle)] p-3 hover:bg-[var(--bg-hover)]"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium text-[var(--text-primary)]">
                          {alert.aiSystem?.name ?? "Unlinked system"}
                        </p>
                        <p className="text-xs text-[var(--text-muted)]">
                          {alert.aiSystem?.department ?? "Unknown department"} · {formatDate(alert.createdAt)}
                        </p>
                      </div>
                      <Badge variant={riskBadgeVariant(alert.severity)}>
                        {alert.severity}
                      </Badge>
                    </div>
                    {alert.description && (
                      <p className="mt-2 text-sm text-[var(--text-secondary)]">
                        {alert.description}
                      </p>
                    )}
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Control Gap Queue</CardTitle>
          </CardHeader>
          <CardContent>
            {controlGapQueue.length === 0 ? (
              <p className="text-sm text-[var(--text-muted)]">
                No obvious control gaps are currently surfaced from the latest saved assessments.
              </p>
            ) : (
              <div className="space-y-3">
                {controlGapQueue.map((system) => (
                  <Link
                    key={system.id}
                    href={`/registry/${system.id}`}
                    className="block rounded-md border border-[var(--border-subtle)] p-3 hover:bg-[var(--bg-hover)]"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium text-[var(--text-primary)]">
                          {system.name}
                        </p>
                        <p className="text-xs text-[var(--text-muted)]">
                          {system.department} · {system.gaps.length} gap{system.gaps.length === 1 ? "" : "s"}
                        </p>
                      </div>
                      <Badge variant={system.gaps.some((gap) => gap.tone === "critical") ? "critical" : "warning"}>
                        {system.gaps.some((gap) => gap.tone === "critical") ? "Needs action" : "Follow up"}
                      </Badge>
                    </div>
                    <div className="mt-2 space-y-1">
                      {system.gaps.slice(0, 2).map((gap) => (
                        <p key={gap.key} className="text-sm text-[var(--text-secondary)]">
                          {gap.title}
                        </p>
                      ))}
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Agent Review Queue</CardTitle>
        </CardHeader>
        <CardContent>
          {agentsNeedingReview.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)]">
              No agents are currently surfacing elevated autonomy or oversight review needs.
            </p>
          ) : (
            <div className="space-y-3">
              {agentsNeedingReview.slice(0, 8).map(({ agent, summary }) => (
                <Link
                  key={agent.id}
                  href={`/agents/${agent.id}`}
                  className="block rounded-md border border-[var(--border-subtle)] p-3 hover:bg-[var(--bg-hover)]"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium text-[var(--text-primary)]">
                        {agent.name}
                      </p>
                      <p className="text-xs text-[var(--text-muted)]">
                        {agent.aiSystem?.name ?? "Unlinked agent"} · {agent.autonomyLevel.replace(/_/g, " ")}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={riskBadgeVariant(summary.recommendedRiskLevel)}>
                        {summary.recommendedRiskLevel}
                      </Badge>
                      <Badge variant="warning">Review</Badge>
                    </div>
                  </div>
                  <div className="mt-2 space-y-1">
                    {summary.concerns.slice(0, 2).map((concern) => (
                      <p key={concern} className="text-sm text-[var(--text-secondary)]">
                        {concern}
                      </p>
                    ))}
                  </div>
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recent Assessments</CardTitle>
        </CardHeader>
        <CardContent>
          {recentAssessments.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)]">No assessments yet.</p>
          ) : (
            <div className="space-y-3">
              {recentAssessments.map((ra) => (
                <div key={ra.id} className="flex items-center justify-between rounded-md border border-[var(--border-subtle)] p-3">
                  <div>
                    <p className="text-sm font-medium">{ra.aiSystem.name}</p>
                    <p className="text-xs text-[var(--text-muted)]">
                      Assessed by {ra.assessedBy} on {formatDate(ra.createdAt)}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold">{ra.overallScore.toFixed(1)}</span>
                    <Badge variant={riskBadgeVariant(
                      ra.overallScore >= 80 ? "CRITICAL" :
                      ra.overallScore >= 60 ? "HIGH" :
                      ra.overallScore >= 40 ? "MEDIUM" :
                      ra.overallScore >= 20 ? "LOW" : "MINIMAL"
                    )}>
                      {ra.overallScore >= 80 ? "CRITICAL" :
                       ra.overallScore >= 60 ? "HIGH" :
                       ra.overallScore >= 40 ? "MEDIUM" :
                       ra.overallScore >= 20 ? "LOW" : "MINIMAL"}
                    </Badge>
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
