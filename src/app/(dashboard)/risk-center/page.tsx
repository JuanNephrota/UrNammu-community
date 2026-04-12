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

export default async function RiskCenterPage() {
  const [assessments, systemRisks, recentAssessments, allAssessments] = await Promise.all([
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
