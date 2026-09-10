import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withRole } from "@/lib/auth-guard";
import { prisma } from "@/lib/prisma";
import { createAuditLog } from "@/lib/audit";

const updateIncidentSchema = z.object({
  status: z.enum(["OPEN", "ACKNOWLEDGED", "RESOLVED", "DISMISSED"]),
});

const CLOSED_STATUSES = new Set(["RESOLVED", "DISMISSED"]);

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; incidentId: string }> }
) {
  return withRole(["ADMIN", "COMPLIANCE_OFFICER"], async (session) => {
    const { id, incidentId } = await params;
    const body = await req.json();
    const parsed = updateIncidentSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json({ error: "Validation failed", details: parsed.error.flatten() }, { status: 400 });
    }

    const existing = await prisma.governanceIncident.findUnique({ where: { id: incidentId } });
    if (!existing || existing.aiSystemId !== id) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const { status } = parsed.data;
    const isClosing = CLOSED_STATUSES.has(status);

    const incident = await prisma.$transaction(async (tx) => {
      const updated = await tx.governanceIncident.update({
        where: { id: incidentId },
        data: {
          status,
          closedAt: isClosing ? existing.closedAt ?? new Date() : null,
        },
        include: { openedByUser: { select: { name: true, email: true } } },
      });

      // Keep linked alerts in step with the incident's disposition.
      await tx.alert.updateMany({
        where: { governanceIncidentId: incidentId },
        data: { status },
      });

      await tx.auditLog.create({
        data: {
          userId: session.user.userId,
          action: "UPDATE",
          entityType: "GovernanceIncident",
          entityId: incidentId,
          aiSystemId: id,
          changes: { status: { from: existing.status, to: status } },
        },
      });

      return updated;
    });

    return NextResponse.json(incident);
  });
}
