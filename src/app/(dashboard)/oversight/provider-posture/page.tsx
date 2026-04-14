import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ProviderPostureTable,
  type ProviderPostureRow,
} from "@/components/oversight/provider-posture-table";
import { buildCostLookup, getBucketIdentityKey } from "@/lib/oversight-telemetry";

export default async function ProviderPosturePage() {
  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  // Fetch all data needed for provider comparison
  const [
    usageBuckets,
    costBuckets,
    aiSystems,
    incidents,
    exceptions,
    alerts,
  ] = await Promise.all([
    prisma.usageBucket.findMany({
      where: { bucketStart: { gte: thirtyDaysAgo } },
      orderBy: { bucketStart: "desc" },
      take: 500,
    }),
    prisma.costBucket.findMany({
      where: { bucketStart: { gte: thirtyDaysAgo } },
      orderBy: { bucketStart: "desc" },
      take: 500,
    }),
    prisma.aISystem.findMany({
      where: { status: { not: "RETIRED" } },
      select: {
        id: true,
        vendor: true,
        riskLevel: true,
      },
    }),
    prisma.governanceIncident.findMany({
      where: { openedAt: { gte: thirtyDaysAgo } },
      select: {
        aiSystem: { select: { vendor: true } },
      },
    }),
    prisma.governanceException.findMany({
      where: {
        status: "ACTIVE",
        createdAt: { gte: thirtyDaysAgo },
      },
      select: {
        aiSystem: { select: { vendor: true } },
      },
    }),
    prisma.alert.findMany({
      where: {
        status: "OPEN",
        createdAt: { gte: thirtyDaysAgo },
      },
      select: {
        aiSystem: { select: { vendor: true } },
      },
    }),
  ]);

  const costMap = buildCostLookup(costBuckets);

  // Aggregate by provider from telemetry
  const providerMap = new Map<
    string,
    {
      totalCost: number;
      tokenVolume: number;
      requestCount: number;
    }
  >();

  for (const bucket of usageBuckets) {
    const existing = providerMap.get(bucket.provider) ?? {
      totalCost: 0,
      tokenVolume: 0,
      requestCount: 0,
    };
    existing.tokenVolume += bucket.totalTokens;
    existing.requestCount += bucket.requestCount ?? 0;
    existing.totalCost += costMap.get(getBucketIdentityKey(bucket)) ?? 0;
    providerMap.set(bucket.provider, existing);
  }

  // Also add cost-only providers
  for (const bucket of costBuckets) {
    if (!providerMap.has(bucket.provider)) {
      providerMap.set(bucket.provider, {
        totalCost: bucket.amount,
        tokenVolume: 0,
        requestCount: 0,
      });
    }
  }

  const totalCostAll = [...providerMap.values()].reduce(
    (s, p) => s + p.totalCost,
    0
  );

  // Build system counts per vendor (normalized lowercase)
  const vendorSystemCounts = new Map<string, { total: number; highRisk: number }>();
  for (const sys of aiSystems) {
    const key = (sys.vendor ?? "unknown").toLowerCase();
    const existing = vendorSystemCounts.get(key) ?? { total: 0, highRisk: 0 };
    existing.total++;
    if (sys.riskLevel === "HIGH" || sys.riskLevel === "CRITICAL") {
      existing.highRisk++;
    }
    vendorSystemCounts.set(key, existing);
  }

  // Build incident/exception/alert counts per vendor
  const vendorIncidents = new Map<string, number>();
  for (const inc of incidents) {
    const key = (inc.aiSystem?.vendor ?? "unknown").toLowerCase();
    vendorIncidents.set(key, (vendorIncidents.get(key) ?? 0) + 1);
  }

  const vendorExceptions = new Map<string, number>();
  for (const exc of exceptions) {
    const key = (exc.aiSystem?.vendor ?? "unknown").toLowerCase();
    vendorExceptions.set(key, (vendorExceptions.get(key) ?? 0) + 1);
  }

  const vendorAlerts = new Map<string, number>();
  for (const alert of alerts) {
    const key = (alert.aiSystem?.vendor ?? "unknown").toLowerCase();
    vendorAlerts.set(key, (vendorAlerts.get(key) ?? 0) + 1);
  }

  // Build provider posture rows — union of telemetry providers and system vendors
  const allProviderKeys = new Set<string>([
    ...providerMap.keys(),
    ...vendorSystemCounts.keys(),
  ]);

  const rows: ProviderPostureRow[] = [...allProviderKeys].map((key) => {
    const telemetry = providerMap.get(key) ?? {
      totalCost: 0,
      tokenVolume: 0,
      requestCount: 0,
    };
    const systems = vendorSystemCounts.get(key) ?? { total: 0, highRisk: 0 };
    return {
      provider: key,
      totalCost: telemetry.totalCost,
      costPct: totalCostAll > 0 ? (telemetry.totalCost / totalCostAll) * 100 : 0,
      tokenVolume: telemetry.tokenVolume,
      requestCount: telemetry.requestCount,
      systemCount: systems.total,
      highRiskCount: systems.highRisk,
      incidentCount: vendorIncidents.get(key) ?? 0,
      exceptionCount: vendorExceptions.get(key) ?? 0,
      alertCount: vendorAlerts.get(key) ?? 0,
    };
  });

  // Summary stats
  const totalProviders = rows.length;
  const totalIncidents = rows.reduce((s, r) => s + r.incidentCount, 0);
  const totalHighRisk = rows.reduce((s, r) => s + r.highRiskCount, 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Provider Posture Comparison"
        description="Cross-provider comparison of cost, risk, incidents, and governance exceptions"
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardContent className="pt-6">
            <p className="text-xs uppercase tracking-wider text-[var(--text-faint)]">
              Active Providers
            </p>
            <p className="mt-2 text-3xl font-semibold">{totalProviders}</p>
            <p className="mt-1 text-xs text-[var(--text-muted)]">
              With telemetry or registered systems
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-xs uppercase tracking-wider text-[var(--text-faint)]">
              Total Spend (30d)
            </p>
            <p className="mt-2 text-3xl font-semibold">
              ${totalCostAll.toFixed(2)}
            </p>
            <p className="mt-1 text-xs text-[var(--text-muted)]">
              Across all providers
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-xs uppercase tracking-wider text-[var(--text-faint)]">
              Recent Incidents
            </p>
            <p className="mt-2 text-3xl font-semibold">{totalIncidents}</p>
            <p className="mt-1 text-xs text-[var(--text-muted)]">
              Last 30 days
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-xs uppercase tracking-wider text-[var(--text-faint)]">
              High-Risk Systems
            </p>
            <p className="mt-2 text-3xl font-semibold">{totalHighRisk}</p>
            <p className="mt-1 text-xs text-[var(--text-muted)]">
              Across all providers
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Provider Comparison</CardTitle>
        </CardHeader>
        <CardContent>
          <ProviderPostureTable rows={rows} />
        </CardContent>
      </Card>
    </div>
  );
}
