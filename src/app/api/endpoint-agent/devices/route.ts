import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withAuth } from "@/lib/auth-guard";

/**
 * GET /api/endpoint-agent/devices
 *
 * Fleet listing for the console. Any authenticated user can read it, but
 * `tokenHash` is never selected, and `machineId` is withheld from VIEWER.
 */
export async function GET(req: NextRequest) {
  return withAuth(async (session) => {
    const isAuthor = ["ADMIN", "COMPLIANCE_OFFICER"].includes(session.user.role);
    const params = req.nextUrl.searchParams;
    const status = params.get("status");
    const platform = params.get("platform");
    const take = Math.min(
      Math.max(Number.parseInt(params.get("take") ?? "100", 10) || 100, 1),
      500,
    );

    const devices = await prisma.endpointDevice.findMany({
      where: {
        ...(status ? { status } : {}),
        ...(platform ? { platform } : {}),
      },
      take,
      orderBy: [{ lastReportAt: { sort: "desc", nulls: "last" } }, { hostname: "asc" }],
      select: {
        id: true,
        machineId: true,
        hostname: true,
        platform: true,
        osVersion: true,
        arch: true,
        agentVersion: true,
        userEmail: true,
        userName: true,
        status: true,
        statusReason: true,
        enrolledAt: true,
        lastSeenAt: true,
        lastReportAt: true,
        collectorStatus: true,
        _count: { select: { detections: true } },
      },
    });

    // machineId is half of what re-enrollment needs, so keep it with the
    // governance roles that actually act on devices.
    return NextResponse.json(
      isAuthor
        ? devices
        : devices.map((device) => {
            const redacted: Record<string, unknown> = { ...device };
            delete redacted.machineId;
            return redacted;
          }),
    );
  });
}
