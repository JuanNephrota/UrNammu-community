import Link from "next/link";
import { Eye } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { StatCard } from "@/components/dashboard/stat-card";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDateTime } from "@/lib/utils";
import { UsageChart } from "@/components/dashboard/usage-chart";

export default async function OversightPage() {
  const [totalLogs, flaggedCount, providerStats, recentLogs, dailyUsage] = await Promise.all([
    prisma.aPIUsageLog.count(),
    prisma.aPIUsageLog.count({ where: { flagged: true } }),
    prisma.aPIUsageLog.groupBy({
      by: ["provider"],
      _sum: { totalTokens: true, cost: true },
      _count: true,
    }),
    prisma.aPIUsageLog.findMany({
      take: 10,
      orderBy: { createdAt: "desc" },
      include: { user: { select: { name: true } } },
    }),
    prisma.$queryRaw<{ date: string; tokens: number; cost: number }[]>`
      SELECT
        DATE("createdAt") as date,
        SUM("totalTokens")::int as tokens,
        SUM(cost)::float as cost
      FROM "APIUsageLog"
      WHERE "createdAt" > NOW() - INTERVAL '30 days'
      GROUP BY DATE("createdAt")
      ORDER BY date ASC
    `,
  ]);

  const totalCost = providerStats.reduce((s, p) => s + (p._sum.cost ?? 0), 0);
  const totalTokens = providerStats.reduce((s, p) => s + (p._sum.totalTokens ?? 0), 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title="AI Oversight"
        description="Monitor Claude and ChatGPT API usage across your organization"
      >
        <Link href="/oversight/usage">
          <Button variant="outline">
            <Eye className="mr-2 h-4 w-4" /> View All Logs
          </Button>
        </Link>
      </PageHeader>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard title="Total Requests" value={totalLogs} iconName="Eye" variant="info" />
        <StatCard title="Total Tokens" value={totalTokens.toLocaleString()} iconName="Eye" variant="default" />
        <StatCard title="Total Cost" value={`$${totalCost.toFixed(2)}`} iconName="DollarSign" variant="info" />
        <StatCard title="Flagged" value={flaggedCount} iconName="AlertTriangle" variant="danger" />
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
                      <p className="text-xs text-[var(--text-muted)]">{p._count} requests</p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-bold">${(p._sum.cost ?? 0).toFixed(2)}</p>
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
        <CardHeader><CardTitle>Recent Logs</CardTitle></CardHeader>
        <CardContent>
          {recentLogs.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)]">No logs yet. Use the API or manual entry to add usage data.</p>
          ) : (
            <div className="space-y-2">
              {recentLogs.map((log) => (
                <div key={log.id} className="flex items-center justify-between rounded-md border border-[var(--border-subtle)] p-3">
                  <div className="flex items-center gap-3">
                    <Badge variant={log.flagged ? "critical" : "info"} className="capitalize">
                      {log.provider}
                    </Badge>
                    <div>
                      <p className="text-sm">{log.user?.name ?? "System"} &middot; {log.model ?? "—"}</p>
                      <p className="text-xs text-[var(--text-muted)]">{log.totalTokens} tokens &middot; ${log.cost.toFixed(4)}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    {log.flagged && <Badge variant="critical">Flagged</Badge>}
                    <p className="text-xs text-[var(--text-faint)]">{formatDateTime(log.createdAt)}</p>
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
