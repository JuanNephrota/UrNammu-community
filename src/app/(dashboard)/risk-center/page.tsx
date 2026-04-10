import Link from "next/link";
import { Plus } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { StatCard } from "@/components/dashboard/stat-card";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { RiskHeatMap } from "@/components/dashboard/risk-heat-map";
import { Badge, riskBadgeVariant } from "@/components/ui/badge";
import { formatDate } from "@/lib/utils";

export default async function RiskCenterPage() {
  const [assessments, systemRisks, recentAssessments] = await Promise.all([
    // Get latest assessment per system for heat map
    prisma.$queryRaw<
      {
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
  ]);

  const riskCounts: Record<string, number> = {};
  systemRisks.forEach((r) => {
    riskCounts[r.riskLevel] = r._count;
  });

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
