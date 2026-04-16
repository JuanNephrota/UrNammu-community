import { prisma } from "@/lib/prisma";
import { loadProxyHealthConfig } from "@/lib/azure-monitor";
import { PageHeader } from "@/components/layout/page-header";
import { ProxyHealthBoard } from "./proxy-health-board";

// Live ops board — don't cache; the client polls anyway but initial paint
// should also reflect "now".
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function ProxyHealthPage() {
  const config = await loadProxyHealthConfig();

  const now = new Date();
  const fifteenMinAgo = new Date(now.getTime() - 15 * 60 * 1000);
  const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);

  const [
    latestSnapshot,
    recentSnapshots,
    usageLast15m,
    flaggedLast15m,
    denialsLast15m,
    latestUsageLog,
  ] = await Promise.all([
    prisma.proxyHealthSnapshot.findFirst({ orderBy: { capturedAt: "desc" } }),
    prisma.proxyHealthSnapshot.findMany({
      where: { capturedAt: { gte: oneHourAgo } },
      orderBy: { capturedAt: "asc" },
      select: {
        capturedAt: true,
        invocationCount: true,
        http5xxCount: true,
        avgResponseTimeMs: true,
        syncError: true,
      },
    }),
    prisma.aPIUsageLog.count({ where: { createdAt: { gte: fifteenMinAgo } } }),
    prisma.aPIUsageLog.count({
      where: { createdAt: { gte: fifteenMinAgo }, flagged: true },
    }),
    prisma.policyDenial.count({ where: { createdAt: { gte: fifteenMinAgo } } }),
    prisma.aPIUsageLog.findFirst({
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    }),
  ]);

  const initial = {
    configured: config !== null,
    functionAppName: config?.functionAppName ?? null,
    resourceGroup: config?.resourceGroup ?? null,
    region: config?.region ?? null,
    latestSnapshot: latestSnapshot
      ? {
          ...latestSnapshot,
          capturedAt: latestSnapshot.capturedAt.toISOString(),
          windowStart: latestSnapshot.windowStart.toISOString(),
          windowEnd: latestSnapshot.windowEnd.toISOString(),
        }
      : null,
    recentSnapshots: recentSnapshots.map((s) => ({
      ...s,
      capturedAt: s.capturedAt.toISOString(),
    })),
    live: {
      windowStart: fifteenMinAgo.toISOString(),
      windowEnd: now.toISOString(),
      usageCount: usageLast15m,
      flaggedCount: flaggedLast15m,
      denialCount: denialsLast15m,
      latestUsageLogAt: latestUsageLog?.createdAt.toISOString() ?? null,
    },
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Proxy Health"
        description="Live ops view of the nammu-ai-proxy Azure Function. Heartbeat tiles update every 15s; Azure Monitor metrics update on demand."
      />
      <ProxyHealthBoard initial={initial} />
    </div>
  );
}
