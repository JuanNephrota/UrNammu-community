import Link from "next/link";
import {
  Database,
  ArrowRight,
  Activity,
} from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { StatCard } from "@/components/dashboard/stat-card";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge, riskBadgeVariant, statusBadgeVariant } from "@/components/ui/badge";
import { prisma } from "@/lib/prisma";
import { formatDate } from "@/lib/utils";

export default async function DashboardPage() {
  const [
    systemCount,
    agentCount,
    highRiskCount,
    openAlerts,
    discoveredTools,
    recentSystems,
    recentAlerts,
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
  ]);

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

  return (
    <div className="space-y-8">
      <PageHeader
        title="Command Center"
        description="Real-time AI governance posture overview"
      />

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
    </div>
  );
}
