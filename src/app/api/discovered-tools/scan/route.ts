import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withAuth, withRole } from "@/lib/auth-guard";
import { isGoogleWorkspaceConfigured } from "@/lib/google-workspace";
import { executeScan } from "@/lib/scan-executor";
import { createAuditLog } from "@/lib/audit";

export async function GET() {
  return withAuth(async () => {
    const lastScan = await prisma.scanHistory.findFirst({
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json({
      configured: await isGoogleWorkspaceConfigured(),
      lastScan: lastScan ?? null,
    });
  });
}

export async function POST() {
  return withRole(["ADMIN", "COMPLIANCE_OFFICER"], async (session) => {
    if (!(await isGoogleWorkspaceConfigured())) {
      return NextResponse.json(
        {
          error: "Google Workspace not configured",
          details:
            "Configure your Google service account in Settings > Integrations.",
        },
        { status: 400 }
      );
    }

    // Check if a scan is already running
    const runningScan = await prisma.scanHistory.findFirst({
      where: { status: "running" },
    });
    if (runningScan) {
      return NextResponse.json(
        { error: "A scan is already in progress", scanId: runningScan.id },
        { status: 409 }
      );
    }

    const result = await executeScan(session.user.userId);

    await createAuditLog({
      userId: session.user.userId,
      action: "SCAN",
      entityType: "ShadowAI",
      entityId: result.scanId,
    });

    return NextResponse.json(result);
  });
}
