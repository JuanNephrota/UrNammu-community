import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withAuth, withRole } from "@/lib/auth-guard";
import { executeSensitiveScan } from "@/lib/sensitive-scan-executor";
import { createAuditLog } from "@/lib/audit";

// Allow up to 60s for the probe sweep to complete (Vercel Pro limit).
export const maxDuration = 60;

export async function GET() {
  return withAuth(async () => {
    const [lastScan, recentScans, findings] = await Promise.all([
      prisma.sensitiveScan.findFirst({ orderBy: { createdAt: "desc" } }),
      prisma.sensitiveScan.findMany({
        orderBy: { createdAt: "desc" },
        take: 20,
      }),
      prisma.sensitiveFinding.findMany({
        orderBy: { createdAt: "desc" },
        take: 50,
      }),
    ]);

    return NextResponse.json({ lastScan: lastScan ?? null, recentScans, findings });
  });
}

export async function POST() {
  return withRole(["ADMIN", "COMPLIANCE_OFFICER"], async (session) => {
    // Expire any scan stuck in "running" for more than 10 minutes.
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
    await prisma.sensitiveScan.updateMany({
      where: { status: "running", startedAt: { lt: tenMinutesAgo } },
      data: {
        status: "failed",
        errorMessage: "Scan timed out",
        completedAt: new Date(),
      },
    });

    // One scan at a time — probing is rate-limit sensitive.
    const runningScan = await prisma.sensitiveScan.findFirst({
      where: { status: "running" },
    });
    if (runningScan) {
      return NextResponse.json(
        { error: "A scan is already in progress", scanId: runningScan.id },
        { status: 409 }
      );
    }

    try {
      const result = await executeSensitiveScan(session.user.userId);

      await createAuditLog({
        userId: session.user.userId,
        action: "SENSITIVE_SCAN",
        entityType: "SensitiveScan",
        entityId: result.scanId,
        changes: {
          targetsProbed: result.targetsProbed,
          findingsFound: result.findingsFound,
          criticalCount: result.criticalCount,
        },
      });

      return NextResponse.json(result);
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "Scan failed" },
        { status: 500 }
      );
    }
  });
}
