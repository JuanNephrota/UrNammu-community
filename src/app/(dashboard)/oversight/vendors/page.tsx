import Link from "next/link";
import { Building2 } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export default async function VendorGovernancePage() {
  const systems = await prisma.aISystem.findMany({
    where: { vendor: { not: null } },
    include: {
      alerts: { where: { status: "OPEN" } },
      governanceIncidents: { where: { status: "OPEN" } },
      governanceExceptions: { where: { status: "ACTIVE", expiresAt: { gte: new Date() } } },
    },
  });

  const discoveredByVendor = await prisma.discoveredAITool.groupBy({
    by: ["vendor"],
    _count: true,
    where: { vendor: { not: null } },
  });

  const vendorMap = new Map<string, {
    systems: number;
    openAlerts: number;
    incidents: number;
    exceptions: number;
    highRisk: number;
    discovered: number;
  }>();

  for (const system of systems) {
    const key = system.vendor ?? "Unknown";
    const current = vendorMap.get(key) ?? { systems: 0, openAlerts: 0, incidents: 0, exceptions: 0, highRisk: 0, discovered: 0 };
    current.systems += 1;
    current.openAlerts += system.alerts.length;
    current.incidents += system.governanceIncidents.length;
    current.exceptions += system.governanceExceptions.length;
    current.highRisk += ["CRITICAL", "HIGH"].includes(system.riskLevel) ? 1 : 0;
    vendorMap.set(key, current);
  }

  for (const row of discoveredByVendor) {
    if (!row.vendor) continue;
    const current = vendorMap.get(row.vendor) ?? { systems: 0, openAlerts: 0, incidents: 0, exceptions: 0, highRisk: 0, discovered: 0 };
    current.discovered = row._count;
    vendorMap.set(row.vendor, current);
  }

  const vendors = [...vendorMap.entries()].sort((a, b) => b[1].systems - a[1].systems);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Vendor Governance"
        description="Track governance posture by AI vendor across approved systems and shadow AI discoveries"
      >
        <Link href="/oversight">
          <Badge variant="info">Back to Oversight</Badge>
        </Link>
      </PageHeader>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Building2 className="h-4 w-4 text-[var(--accent)]" />
            Vendor Profiles
          </CardTitle>
        </CardHeader>
        <CardContent>
          {vendors.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)]">No vendor-governed systems yet.</p>
          ) : (
            <div className="space-y-3">
              {vendors.map(([vendor, stats]) => (
                <div key={vendor} className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-base)] p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-[var(--text-primary)]">{vendor}</p>
                      <p className="text-xs text-[var(--text-muted)]">
                        {stats.systems} governed systems · {stats.discovered} shadow AI discoveries
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Badge variant={stats.highRisk > 0 ? "warning" : "success"}>{stats.highRisk} high risk</Badge>
                      <Badge variant={stats.openAlerts > 0 ? "critical" : "outline"}>{stats.openAlerts} open alerts</Badge>
                      <Badge variant={stats.incidents > 0 ? "critical" : "outline"}>{stats.incidents} incidents</Badge>
                      <Badge variant={stats.exceptions > 0 ? "warning" : "outline"}>{stats.exceptions} exceptions</Badge>
                    </div>
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
