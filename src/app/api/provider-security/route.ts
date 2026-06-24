import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withAuth, withRole } from "@/lib/auth-guard";
import { executeProviderSecurityScan } from "@/lib/provider-security/scan-executor";
import { createAuditLog } from "@/lib/audit";

// Live provider reads + evaluation; comfortably within the Vercel Pro limit.
export const maxDuration = 60;

export async function GET() {
  return withAuth(async () => {
    const [lastScan, recentScans] = await Promise.all([
      prisma.providerSecurityScan.findFirst({
        orderBy: { createdAt: "desc" },
        include: { results: { orderBy: { provider: "asc" } } },
      }),
      prisma.providerSecurityScan.findMany({
        orderBy: { createdAt: "desc" },
        take: 20,
        select: {
          id: true,
          status: true,
          providersScanned: true,
          findingsFound: true,
          criticalCount: true,
          errorMessage: true,
          completedAt: true,
          createdAt: true,
        },
      }),
    ]);

    return NextResponse.json({ lastScan: lastScan ?? null, recentScans });
  });
}

export async function POST() {
  return withRole(["ADMIN", "COMPLIANCE_OFFICER"], async (session) => {
    // Expire any scan stuck "running" for more than 10 minutes.
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
    await prisma.providerSecurityScan.updateMany({
      where: { status: "running", startedAt: { lt: tenMinutesAgo } },
      data: {
        status: "failed",
        errorMessage: "Scan timed out",
        completedAt: new Date(),
      },
    });

    const runningScan = await prisma.providerSecurityScan.findFirst({
      where: { status: "running" },
    });
    if (runningScan) {
      return NextResponse.json(
        { error: "A scan is already in progress", scanId: runningScan.id },
        { status: 409 }
      );
    }

    const result = await executeProviderSecurityScan(session.user.userId);

    await createAuditLog({
      userId: session.user.userId,
      action: "PROVIDER_SECURITY_SCAN",
      entityType: "ProviderSecurityScan",
      entityId: result.scanId,
      changes: {
        status: result.status,
        providersScanned: result.providersScanned,
        findingsFound: result.findingsFound,
        criticalCount: result.criticalCount,
      },
    });

    return NextResponse.json(result);
  });
}
