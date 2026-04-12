import Link from "next/link";
import {
  Database,
  ArrowRight,
  Activity,
} from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { StatCard } from "@/components/dashboard/stat-card";
import { GovernanceActionQueue } from "@/components/dashboard/governance-action-queue";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge, riskBadgeVariant, statusBadgeVariant } from "@/components/ui/badge";
import { prisma } from "@/lib/prisma";
import { formatDate } from "@/lib/utils";
import { isDemoModeEnabled } from "@/lib/demo-mode";
import { ExecutivePostureChart } from "@/components/dashboard/executive-posture-chart";
import { SegmentRiskHeatmap } from "@/components/dashboard/segment-risk-heatmap";

export default async function DashboardPage() {
  const demoMode = isDemoModeEnabled();
  const [
    systemCount,
    agentCount,
    highRiskCount,
    openAlerts,
    discoveredTools,
    recentSystems,
    recentAlerts,
    systemsNeedingAssessment,
    systemsMissingPolicies,
    nonCompliantAssignments,
    systemsReadyForApproval,
    systemsWithApprovalChanges,
    systemsWithOverdueReviews,
    systemsMissingStageApprovals,
    activeGovernanceExceptions,
    systemsWithScores,
    approvedSystems,
    unresolvedDiscoveries,
  ] = await Promise.all([
    prisma.aISystem.count(),
    prisma.aIAgent.count(),
    prisma.aISystem.count({
      where: { riskLevel: { in: ["CRITICAL", "HIGH"] } },
    }),
    prisma.alert.count({ where: { status: "OPEN" } }),
    prisma.discoveredAITool.count({ where: { status: "DISCOVERED" } }),
    prisma.aISystem.findMany({
      take: 5,
      orderBy: { createdAt: "desc" },
      include: { owner: { select: { name: true } } },
    }),
    prisma.alert.findMany({
      take: 5,
      orderBy: { createdAt: "desc" },
    }),
    prisma.aISystem.count({
      where: { riskAssessments: { none: {} } },
    }),
    prisma.aISystem.count({
      where: { policyAssignments: { none: {} } },
    }),
    prisma.policyAssignment.count({
      where: { complianceStatus: { in: ["NON_COMPLIANT", "NOT_ASSESSED"] } },
    }),
    prisma.aISystem.findMany({
      where: {
        riskAssessments: { some: {} },
        policyAssignments: {
          some: {},
          every: { complianceStatus: "COMPLIANT" },
        },
        approvals: { none: { decision: "APPROVED" } },
        nextReviewDate: { gte: new Date() },
      },
      select: {
        id: true,
        requireOwnerApproval: true,
        requireSecurityApproval: true,
        requireLegalApproval: true,
        requireComplianceApproval: true,
        governanceReviews: {
          select: { stage: true, approved: true },
          orderBy: { createdAt: "desc" },
        },
      },
    }).then((systems) =>
      systems.filter((system) => {
        const latestStageDecisions = new Map<string, boolean>();
        for (const review of system.governanceReviews) {
          if (!latestStageDecisions.has(review.stage)) {
            latestStageDecisions.set(review.stage, review.approved);
          }
        }
        const requiredStages = [
          ...(system.requireOwnerApproval ? ["OWNER"] : []),
          ...(system.requireSecurityApproval ? ["SECURITY"] : []),
          ...(system.requireLegalApproval ? ["LEGAL"] : []),
          ...(system.requireComplianceApproval ? ["COMPLIANCE"] : []),
        ];
        return requiredStages.every((stage) => latestStageDecisions.get(stage) === true);
      }).length
    ),
    prisma.aISystem.count({
      where: {
        approvals: {
          some: {
            decision: { in: ["CHANGES_REQUESTED", "REVOKED"] },
          },
        },
      },
    }),
    prisma.aISystem.count({
      where: {
        nextReviewDate: { lt: new Date() },
      },
    }),
    prisma.aISystem.findMany({
      select: {
        id: true,
        requireOwnerApproval: true,
        requireSecurityApproval: true,
        requireLegalApproval: true,
        requireComplianceApproval: true,
        governanceReviews: {
          select: { stage: true, approved: true },
          orderBy: { createdAt: "desc" },
        },
      },
    }).then((systems) =>
      systems.filter((system) => {
        const latestStageDecisions = new Map<string, boolean>();
        for (const review of system.governanceReviews) {
          if (!latestStageDecisions.has(review.stage)) {
            latestStageDecisions.set(review.stage, review.approved);
          }
        }
        const requiredStages = [
          ...(system.requireOwnerApproval ? ["OWNER"] : []),
          ...(system.requireSecurityApproval ? ["SECURITY"] : []),
          ...(system.requireLegalApproval ? ["LEGAL"] : []),
          ...(system.requireComplianceApproval ? ["COMPLIANCE"] : []),
        ];
        return requiredStages.some((stage) => latestStageDecisions.get(stage) !== true);
      }).length
    ),
    prisma.governanceException.count({
      where: {
        status: "ACTIVE",
        expiresAt: { gte: new Date() },
      },
    }),
    prisma.aISystem.findMany({
      include: {
        riskAssessments: {
          orderBy: { createdAt: "desc" },
          take: 1,
        },
      },
    }),
    prisma.aISystem.findMany({
      where: { status: { in: ["APPROVED", "DEPLOYED"] } },
      select: { createdAt: true },
      orderBy: { createdAt: "asc" },
    }),
    prisma.discoveredAITool.findMany({
      where: { status: { in: ["DISCOVERED", "UNDER_REVIEW"] } },
      select: { detectedAt: true },
      orderBy: { detectedAt: "asc" },
    }),
  ]);

  const posturePeriods = new Set<string>();
  approvedSystems.forEach((s) => posturePeriods.add(new Date(s.createdAt).toLocaleString("en-US", { month: "short", year: "2-digit" })));
  unresolvedDiscoveries.forEach((d) => posturePeriods.add(new Date(d.detectedAt).toLocaleString("en-US", { month: "short", year: "2-digit" })));
  const orderedPeriods = [...posturePeriods].sort((a, b) => new Date(`1 ${a}`).getTime() - new Date(`1 ${b}`).getTime());
  const executiveTrend = orderedPeriods.reduce<{ period: string; approved: number; ungoverned: number }[]>(
    (acc, period) => {
      const previous = acc[acc.length - 1] ?? { approved: 0, ungoverned: 0 };
      const approvedDelta = approvedSystems.filter(
        (s) => new Date(s.createdAt).toLocaleString("en-US", { month: "short", year: "2-digit" }) === period
      ).length;
      const ungovernedDelta = unresolvedDiscoveries.filter(
        (d) => new Date(d.detectedAt).toLocaleString("en-US", { month: "short", year: "2-digit" }) === period
      ).length;
      acc.push({
        period,
        approved: previous.approved + approvedDelta,
        ungoverned: previous.ungoverned + ungovernedDelta,
      });
      return acc;
    },
    []
  );

  const scoredSystems = systemsWithScores
    .map((system) => ({
      label: system.name,
      department: system.department,
      vendor: system.vendor ?? "Unknown",
      dataSensitivity: system.dataSensitivity,
      riskLevel: system.riskLevel,
      avgScore: Math.round(system.riskAssessments[0]?.overallScore ?? 0),
    }))
    .filter((system) => system.avgScore > 0);

  function buildSegmentRows<K extends "department" | "vendor" | "dataSensitivity">(key: K) {
    const map = new Map<string, { systems: number; totalScore: number; highRisk: number }>();
    for (const system of scoredSystems) {
      const segment = system[key];
      const current = map.get(segment) ?? { systems: 0, totalScore: 0, highRisk: 0 };
      current.systems += 1;
      current.totalScore += system.avgScore;
      current.highRisk += ["HIGH", "CRITICAL"].includes(system.riskLevel) ? 1 : 0;
      map.set(segment, current);
    }
    return [...map.entries()]
      .map(([label, stats]) => ({
        label,
        systems: stats.systems,
        avgScore: Math.round(stats.totalScore / stats.systems),
        highRisk: stats.highRisk,
      }))
      .sort((a, b) => b.avgScore - a.avgScore)
      .slice(0, 6);
  }

  const departmentRiskRows = buildSegmentRows("department");
  const vendorRiskRows = buildSegmentRows("vendor");
  const sensitivityRiskRows = buildSegmentRows("dataSensitivity");

  const complianceAssignments = await prisma.policyAssignment.groupBy({
    by: ["complianceStatus"],
    _count: true,
  });
  const totalAssignments = complianceAssignments.reduce(
    (sum, g) => sum + g._count,
    0
  );
  const compliantCount =
    complianceAssignments.find((g) => g.complianceStatus === "COMPLIANT")
      ?._count ?? 0;
  const complianceRate =
    totalAssignments > 0
      ? Math.round((compliantCount / totalAssignments) * 100)
      : 0;

  const governanceItems = [
    {
      label: "Shadow AI triage",
      description: "Discovered tools still need registration, approval, or blocking.",
      count: discoveredTools,
      href: "/shadow-ai",
      tone: discoveredTools > 0 ? "warning" : "success",
    },
    {
      label: "Risk assessments due",
      description: "Registered systems without an initial risk assessment.",
      count: systemsNeedingAssessment,
      href: "/risk-center/assessments/new",
      tone: systemsNeedingAssessment > 0 ? "warning" : "success",
    },
    {
      label: "Policy mapping needed",
      description: "Systems without assigned policies cannot complete governance review.",
      count: systemsMissingPolicies,
      href: "/compliance",
      tone: systemsMissingPolicies > 0 ? "warning" : "success",
    },
    {
      label: "Stage approvals missing",
      description: "Systems still waiting on owner, security, legal, or compliance signoff.",
      count: systemsMissingStageApprovals,
      href: "/registry",
      tone: systemsMissingStageApprovals > 0 ? "warning" : "success",
    },
    {
      label: "Approval review ready",
      description: "Systems have completed governance steps and are waiting on a formal approval decision.",
      count: systemsReadyForApproval,
      href: "/registry",
      tone: systemsReadyForApproval > 0 ? "success" : "info",
    },
    {
      label: "Approval follow-up",
      description: "Systems have requested changes or revoked approvals that need re-review.",
      count: systemsWithApprovalChanges,
      href: "/registry",
      tone: systemsWithApprovalChanges > 0 ? "critical" : "success",
    },
    {
      label: "Renewals overdue",
      description: "Systems have passed their scheduled governance review date.",
      count: systemsWithOverdueReviews,
      href: "/registry",
      tone: systemsWithOverdueReviews > 0 ? "critical" : "success",
    },
    {
      label: "Compliance blockers",
      description: "Assignments marked non-compliant or not assessed need evidence updates.",
      count: nonCompliantAssignments,
      href: "/compliance",
      tone: nonCompliantAssignments > 0 ? "critical" : "success",
    },
    {
      label: "Active exceptions",
      description: "Time-boxed governance waivers that should be tracked to expiry.",
      count: activeGovernanceExceptions,
      href: "/compliance",
      tone: activeGovernanceExceptions > 0 ? "info" : "success",
    },
  ] as const;

  return (
    <div className="space-y-8">
      <PageHeader
        title="Command Center"
        description={
          demoMode
            ? "Demo workspace with seeded governance workflows, approvals, telemetry, and shadow AI discoveries"
            : "Real-time AI governance posture overview"
        }
      />

      {demoMode && (
        <Card className="border-amber-500/20 bg-amber-500/5">
          <CardContent className="pt-6">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="warning">Demo Data Loaded</Badge>
              <Badge variant="outline">No live provider credentials required</Badge>
            </div>
            <p className="mt-3 text-sm leading-relaxed text-[var(--text-secondary)]">
              This environment is preloaded with example systems, approvals, alerts, usage telemetry, sync history, and shadow-AI findings so new users can explore the full governance workflow immediately after setup.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Stat Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 stagger-children">
        <StatCard
          title="AI Systems"
          value={systemCount}
          iconName="Database"
          variant="info"
        />
        <StatCard
          title="AI Agents"
          value={agentCount}
          iconName="Bot"
          variant="info"
        />
        <StatCard
          title="High Risk"
          value={highRiskCount}
          iconName="ShieldAlert"
          variant="danger"
        />
        <StatCard
          title="Open Alerts"
          value={openAlerts}
          iconName="Bell"
          variant="warning"
        />
        <StatCard
          title="Shadow AI"
          value={discoveredTools}
          description="Unregistered"
          iconName="Eye"
          variant="warning"
        />
        <StatCard
          title="Compliance"
          value={`${complianceRate}%`}
          iconName="FileCheck"
          variant={complianceRate >= 80 ? "success" : "warning"}
        />
      </div>

      {/* Main content grid */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="lg:col-span-2 animate-fade-in-up" style={{ animationDelay: "280ms" }}>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <Activity className="h-4 w-4 text-[var(--accent)]" />
              Executive Governance Posture
            </CardTitle>
            <Link href="/oversight/vendors" className="flex items-center gap-1 text-xs text-[var(--accent)] hover:underline">
              Vendor governance <ArrowRight className="h-3 w-3" />
            </Link>
          </CardHeader>
          <CardContent>
            <ExecutivePostureChart data={executiveTrend} />
          </CardContent>
        </Card>

        {/* Recent AI Systems */}
        <Card className="animate-fade-in-up" style={{ animationDelay: "300ms" }}>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <Database className="h-4 w-4 text-[var(--accent)]" />
              Recent AI Systems
            </CardTitle>
            <Link
              href="/registry"
              className="flex items-center gap-1 text-xs text-[var(--accent)] hover:underline"
            >
              View all <ArrowRight className="h-3 w-3" />
            </Link>
          </CardHeader>
          <CardContent>
            {recentSystems.length === 0 ? (
              <div className="flex flex-col items-center py-8 text-center">
                <Database className="h-8 w-8 text-[var(--text-faint)] mb-2" />
                <p className="text-sm text-[var(--text-muted)]">No AI systems registered yet.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {recentSystems.map((system, i) => (
                  <Link
                    key={system.id}
                    href={`/registry/${system.id}`}
                    className="flex items-center justify-between rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-base)] p-3 transition-all hover:bg-[var(--bg-hover)] hover:border-[var(--border-default)] group"
                    style={{ animationDelay: `${400 + i * 60}ms` }}
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-[var(--text-primary)] truncate group-hover:text-[var(--accent)] transition-colors">
                        {system.name}
                      </p>
                      <p className="text-[11px] text-[var(--text-faint)] mt-0.5">
                        {system.department} &middot; {system.owner.name}
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0 ml-3">
                      <Badge variant={riskBadgeVariant(system.riskLevel)}>
                        {system.riskLevel}
                      </Badge>
                      <Badge variant={statusBadgeVariant(system.status)}>
                        {system.status.replace("_", " ")}
                      </Badge>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Alerts Feed */}
        <Card className="animate-fade-in-up" style={{ animationDelay: "360ms" }}>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <Activity className="h-4 w-4 text-[var(--critical)]" style={{ animation: "pulseGlow 2s ease-in-out infinite" }} />
              Live Alerts
            </CardTitle>
            <Link
              href="/alerts"
              className="flex items-center gap-1 text-xs text-[var(--accent)] hover:underline"
            >
              View all <ArrowRight className="h-3 w-3" />
            </Link>
          </CardHeader>
          <CardContent>
            {recentAlerts.length === 0 ? (
              <div className="flex flex-col items-center py-8 text-center">
                <div className="h-2 w-2 rounded-full bg-[var(--success)] shadow-[0_0_8px_var(--success)] mb-3" />
                <p className="text-sm font-medium text-[var(--success)]">All clear</p>
                <p className="text-xs text-[var(--text-faint)]">No active alerts</p>
              </div>
            ) : (
              <div className="space-y-2">
                {recentAlerts.map((alert, i) => (
                  <div
                    key={alert.id}
                    className="flex items-center justify-between rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-base)] p-3 transition-all hover:bg-[var(--bg-hover)]"
                    style={{ animationDelay: `${400 + i * 60}ms` }}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div
                        className="h-2 w-2 shrink-0 rounded-full"
                        style={{
                          backgroundColor:
                            alert.severity === "CRITICAL" ? "var(--critical)" :
                            alert.severity === "HIGH" ? "var(--high)" :
                            alert.severity === "MEDIUM" ? "var(--warning)" : "var(--text-muted)",
                          boxShadow:
                            alert.severity === "CRITICAL" ? "0 0 8px var(--critical-glow)" :
                            alert.severity === "HIGH" ? "0 0 8px rgba(249,115,22,0.3)" : "none",
                        }}
                      />
                      <div className="min-w-0">
                        <p className="text-sm text-[var(--text-primary)] truncate">
                          {alert.title}
                        </p>
                        <p className="text-[11px] text-[var(--text-faint)]">
                          {alert.source} &middot; {formatDate(alert.createdAt)}
                        </p>
                      </div>
                    </div>
                    <Badge variant={riskBadgeVariant(alert.severity)} className="shrink-0 ml-2">
                      {alert.severity}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <SegmentRiskHeatmap title="Risk by Department" rows={departmentRiskRows} />
        <SegmentRiskHeatmap title="Risk by Vendor" rows={vendorRiskRows} />
        <SegmentRiskHeatmap title="Risk by Data Sensitivity" rows={sensitivityRiskRows} />
      </div>

      <GovernanceActionQueue
        items={governanceItems.filter((item) => item.count > 0)}
      />
    </div>
  );
}
