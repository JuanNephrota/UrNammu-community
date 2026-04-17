import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withAuth } from "@/lib/auth-guard";
import { loadProxyHealthConfig } from "@/lib/azure-monitor";

/**
 * Live snapshot for the /proxy-health board:
 *  - latest `ProxyHealthSnapshot` (from the last manual or auto sync)
 *  - sparkline-friendly recent snapshots (last hour)
 *  - always-fresh DB-side counters the proxy itself writes
 *
 * The DB-side counters update in real time — they're how the board proves
 * the proxy is actually breathing even if the Azure Monitor sync is stale.
 */
export async function GET() {
  return withAuth(async () => {
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
      recentLogs,
    ] = await Promise.all([
      prisma.proxyHealthSnapshot.findFirst({
        orderBy: { capturedAt: "desc" },
      }),
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
      prisma.aPIUsageLog.count({
        where: { createdAt: { gte: fifteenMinAgo } },
      }),
      prisma.aPIUsageLog.count({
        where: { createdAt: { gte: fifteenMinAgo }, flagged: true },
      }),
      prisma.policyDenial.count({
        where: { createdAt: { gte: fifteenMinAgo } },
      }),
      prisma.aPIUsageLog.findFirst({
        orderBy: { createdAt: "desc" },
        select: { createdAt: true },
      }),
      prisma.aPIUsageLog.findMany({
        orderBy: { createdAt: "desc" },
        take: 10,
        select: {
          id: true,
          createdAt: true,
          provider: true,
          model: true,
          aiSystemId: true,
          department: true,
          totalTokens: true,
          cost: true,
          flagged: true,
          flagReason: true,
          user: { select: { name: true, email: true } },
        },
      }),
    ]);

    return NextResponse.json({
      configured: config !== null,
      functionAppName: config?.functionAppName ?? null,
      resourceGroup: config?.resourceGroup ?? null,
      region: config?.region ?? null,
      latestSnapshot,
      recentSnapshots,
      live: {
        windowStart: fifteenMinAgo.toISOString(),
        windowEnd: now.toISOString(),
        usageCount: usageLast15m,
        flaggedCount: flaggedLast15m,
        denialCount: denialsLast15m,
        latestUsageLogAt: latestUsageLog?.createdAt ?? null,
      },
      recentLogs,
    });
  });
}
