import { NextRequest, NextResponse } from "next/server";
import { withRole } from "@/lib/auth-guard";
import { prisma } from "@/lib/prisma";
import { createAuditLog } from "@/lib/audit";
import { z } from "zod";

const updateSchema = z.object({
  status: z.enum(["OPEN", "IN_PROGRESS", "RESOLVED"]).optional(),
  notes: z.string().optional().nullable(),
  summary: z.string().optional().nullable(),
  resolutionSummary: z.string().optional().nullable(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withRole(["ADMIN", "COMPLIANCE_OFFICER"], async (session) => {
    const { id } = await params;
    const parsed = updateSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "Validation failed" }, { status: 400 });
    }

    const existing = await prisma.investigation.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "Investigation not found" }, { status: 404 });
    }

    const status = parsed.data.status ?? existing.status;
    const investigation = await prisma.investigation.update({
      where: { id },
      data: {
        status,
        notes: parsed.data.notes === undefined ? existing.notes : parsed.data.notes,
        summary: parsed.data.summary === undefined ? existing.summary : parsed.data.summary,
        resolutionSummary:
          parsed.data.resolutionSummary === undefined
            ? existing.resolutionSummary
            : parsed.data.resolutionSummary,
        resolvedAt: status === "RESOLVED" ? new Date() : null,
      },
      include: {
        ownerUser: { select: { id: true, name: true, email: true } },
        aiSystem: { select: { id: true, name: true } },
        alert: { select: { id: true, title: true } },
        governanceIncident: { select: { id: true, title: true } },
      },
    });

    await createAuditLog({
      userId: session.user.userId,
      action: "UPDATE",
      entityType: "Investigation",
      entityId: investigation.id,
      aiSystemId: investigation.aiSystemId ?? undefined,
      changes: {
        fromStatus: existing.status,
        toStatus: investigation.status,
      },
    });

    return NextResponse.json(investigation);
  });
}
