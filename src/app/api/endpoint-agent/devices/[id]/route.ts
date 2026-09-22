import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { withAuth, withRole } from "@/lib/auth-guard";
import { createAuditLog } from "@/lib/audit";
import { logger } from "@/lib/observability";

const patchSchema = z.object({
  /**
   * REVOKED kills the device's token immediately and is not undone by
   * reinstalling the agent — re-enrollment of a revoked machineId is refused.
   * Setting ACTIVE again clears that, but the agent must re-enroll to get a
   * working token, since the old one is not recoverable.
   */
  status: z.enum(["ACTIVE", "REVOKED"]),
  statusReason: z.string().trim().max(1000).nullish(),
});

/** GET /api/endpoint-agent/devices/[id] — device detail with its detections. */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return withAuth(async () => {
    const device = await prisma.endpointDevice.findUnique({
      where: { id },
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
        detections: {
          orderBy: { lastSeenAt: "desc" },
          select: {
            id: true,
            signal: true,
            toolName: true,
            vendor: true,
            category: true,
            matchConfidence: true,
            evidence: true,
            detail: true,
            observations: true,
            firstSeenAt: true,
            lastSeenAt: true,
          },
        },
      },
    });

    if (!device) {
      return NextResponse.json({ error: "Device not found" }, { status: 404 });
    }
    return NextResponse.json(device);
  });
}

/** PATCH /api/endpoint-agent/devices/[id] — revoke or re-activate. */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return withRole(["ADMIN", "COMPLIANCE_OFFICER"], async (session) => {
    let raw: unknown;
    try {
      raw = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const parsed = patchSchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid payload", details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const existing = await prisma.endpointDevice.findUnique({
      where: { id },
      select: { id: true, hostname: true, status: true },
    });
    if (!existing) {
      return NextResponse.json({ error: "Device not found" }, { status: 404 });
    }

    const device = await prisma.endpointDevice.update({
      where: { id },
      data: {
        status: parsed.data.status,
        statusReason: parsed.data.statusReason ?? null,
        // Revoking rotates the stored hash to a value no token can produce, so
        // the credential is dead even if the status is later flipped back.
        ...(parsed.data.status === "REVOKED"
          ? { tokenHash: `revoked:${id}:${Date.now()}` }
          : {}),
      },
      select: { id: true, hostname: true, status: true, statusReason: true },
    });

    await createAuditLog({
      userId: session.user.userId,
      action: parsed.data.status === "REVOKED" ? "REVOKE" : "UPDATE",
      entityType: "EndpointDevice",
      entityId: id,
      changes: { from: existing.status, to: device.status },
    });

    logger.info("endpoint_agent.device.status_changed", {
      deviceId: id,
      hostname: device.hostname,
      from: existing.status,
      to: device.status,
      byUserId: session.user.userId,
    });

    return NextResponse.json(device);
  });
}
