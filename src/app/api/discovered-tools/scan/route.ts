import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withAuth, withRole } from "@/lib/auth-guard";
import { isGoogleWorkspaceConfigured } from "@/lib/google-workspace";
import { isMicrosoft365Configured } from "@/lib/microsoft-365-shadow-ai";
import { isHexnodeConfigured } from "@/lib/hexnode";
import { isCrowdStrikeConfigured } from "@/lib/crowdstrike";
import {
  executeScan,
  type ShadowAIScanProvider,
} from "@/lib/scan-executor";
import { createAuditLog } from "@/lib/audit";

// Allow up to 60s for the scan to complete (Vercel Pro limit)
export const maxDuration = 60;

export async function GET() {
  return withAuth(async () => {
    const [
      lastScan,
      googleLastScan,
      microsoftLastScan,
      hexnodeLastScan,
      crowdstrikeLastScan,
      googleConfigured,
      microsoftConfigured,
      hexnodeConfigured,
      crowdstrikeConfigured,
    ] = await Promise.all([
      prisma.scanHistory.findFirst({
        orderBy: { createdAt: "desc" },
      }),
      prisma.scanHistory.findFirst({
        where: { scanType: "google_workspace" },
        orderBy: { createdAt: "desc" },
      }),
      prisma.scanHistory.findFirst({
        where: { scanType: "microsoft_365" },
        orderBy: { createdAt: "desc" },
      }),
      prisma.scanHistory.findFirst({
        where: { scanType: "hexnode" },
        orderBy: { createdAt: "desc" },
      }),
      prisma.scanHistory.findFirst({
        where: { scanType: "crowdstrike" },
        orderBy: { createdAt: "desc" },
      }),
      isGoogleWorkspaceConfigured(),
      isMicrosoft365Configured(),
      isHexnodeConfigured(),
      isCrowdStrikeConfigured(),
    ]);

    return NextResponse.json({
      configured:
        googleConfigured ||
        microsoftConfigured ||
        hexnodeConfigured ||
        crowdstrikeConfigured,
      lastScan: lastScan ?? null,
      sources: {
        googleWorkspace: {
          configured: googleConfigured,
          lastScan: googleLastScan ?? null,
        },
        microsoft365: {
          configured: microsoftConfigured,
          lastScan: microsoftLastScan ?? null,
        },
        hexnode: {
          configured: hexnodeConfigured,
          lastScan: hexnodeLastScan ?? null,
        },
        crowdstrike: {
          configured: crowdstrikeConfigured,
          lastScan: crowdstrikeLastScan ?? null,
        },
      },
    });
  });
}

export async function POST(req: Request) {
  return withRole(["ADMIN", "COMPLIANCE_OFFICER"], async (session) => {
    let provider: ShadowAIScanProvider = "google_workspace";
    try {
      const body = (await req.json()) as { provider?: ShadowAIScanProvider };
      if (
        body.provider === "google_workspace" ||
        body.provider === "microsoft_365" ||
        body.provider === "hexnode" ||
        body.provider === "crowdstrike"
      ) {
        provider = body.provider;
      }
    } catch {
      provider = "google_workspace";
    }

    if (provider === "google_workspace" && !(await isGoogleWorkspaceConfigured())) {
      return NextResponse.json(
        {
          error: "Google Workspace not configured",
          details:
            "Configure your Google Workspace service account in Settings > Shadow AI.",
        },
        { status: 400 }
      );
    }

    if (provider === "microsoft_365" && !(await isMicrosoft365Configured())) {
      return NextResponse.json(
        {
          error: "Microsoft 365 Shadow AI not configured",
          details:
            "Configure your Microsoft 365 tenant app in Settings > Shadow AI.",
        },
        { status: 400 }
      );
    }

    if (provider === "hexnode" && !(await isHexnodeConfigured())) {
      return NextResponse.json(
        {
          error: "Hexnode not configured",
          details:
            "Configure your Hexnode API key and subdomain in Settings > Shadow AI.",
        },
        { status: 400 }
      );
    }

    if (provider === "crowdstrike" && !(await isCrowdStrikeConfigured())) {
      return NextResponse.json(
        {
          error: "CrowdStrike not configured",
          details:
            "Configure your CrowdStrike API client and cloud in Settings > Shadow AI.",
        },
        { status: 400 }
      );
    }

    // Expire any scans stuck in "running" for more than 10 minutes
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
    await prisma.scanHistory.updateMany({
      where: { status: "running", startedAt: { lt: tenMinutesAgo } },
      data: { status: "failed", errorMessage: "Scan timed out", completedAt: new Date() },
    });

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

    // Run scan synchronously — wait for completion before responding
    try {
      const completedResult = await executeScan(
        session.user.userId,
        provider
      );

      await createAuditLog({
        userId: session.user.userId,
        action: "SCAN",
        entityType: "ShadowAI",
        entityId: completedResult.scanId,
        changes: { provider },
      });

      return NextResponse.json(completedResult);
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "Scan failed" },
        { status: 500 }
      );
    }
  });
}
