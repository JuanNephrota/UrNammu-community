import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withRole } from "@/lib/auth-guard";
import { fetchProxyHealth, loadProxyHealthConfig } from "@/lib/azure-monitor";
import { createAuditLog } from "@/lib/audit";

/**
 * Trigger a one-shot Azure Monitor sync. Persists one ProxyHealthSnapshot
 * row whether the sync succeeded or failed — a row with `syncError` is a
 * useful "last attempt" indicator on the live board.
 */
export async function POST() {
  return withRole(["ADMIN"], async (session) => {
    const config = await loadProxyHealthConfig();
    if (!config) {
      return NextResponse.json(
        {
          error:
            "Azure Monitor is not configured. Set subscription ID, resource group, and function app name in Settings → General.",
        },
        { status: 400 }
      );
    }

    const windowMinutes = 15;

    try {
      const health = await fetchProxyHealth(config, windowMinutes);
      const snapshot = await prisma.proxyHealthSnapshot.create({
        data: {
          windowStart: health.windowStart,
          windowEnd: health.windowEnd,
          invocationCount: health.invocationCount,
          http2xxCount: health.http2xxCount,
          http4xxCount: health.http4xxCount,
          http5xxCount: health.http5xxCount,
          avgResponseTimeMs: health.avgResponseTimeMs,
          rawMetrics: health.rawMetrics as object,
        },
      });

      await createAuditLog({
        userId: session.user.userId,
        action: "SYNC",
        entityType: "ProxyHealth",
        entityId: snapshot.id,
      });

      return NextResponse.json(snapshot);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const snapshot = await prisma.proxyHealthSnapshot.create({
        data: {
          windowStart: new Date(Date.now() - windowMinutes * 60 * 1000),
          windowEnd: new Date(),
          syncError: message,
        },
      });
      return NextResponse.json(
        { ...snapshot, error: message },
        { status: 502 }
      );
    }
  });
}
