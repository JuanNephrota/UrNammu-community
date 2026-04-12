import { NextRequest, NextResponse } from "next/server";
import { withRole } from "@/lib/auth-guard";
import { prisma } from "@/lib/prisma";
import { createAuditLog } from "@/lib/audit";
import { z } from "zod";

const updateSchema = z.object({
  status: z.enum(["OPEN", "IN_PROGRESS", "RESOLVED", "ACCEPTED"]),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withRole(["ADMIN", "COMPLIANCE_OFFICER"], async (session) => {
    const { id } = await params;
    const body = await req.json();
    const parsed = updateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Validation failed" }, { status: 400 });
    }

    const existing = await prisma.riskAssessmentIssue.findUnique({
      where: { id },
      include: {
        riskAssessment: {
          select: { aiSystemId: true },
        },
      },
    });

    if (!existing) {
      return NextResponse.json({ error: "Issue not found" }, { status: 404 });
    }

    const updated = await prisma.riskAssessmentIssue.update({
      where: { id },
      data: { status: parsed.data.status },
    });

    await createAuditLog({
      userId: session.user.userId,
      action: "UPDATE",
      entityType: "RiskAssessmentIssue",
      entityId: updated.id,
      aiSystemId: existing.riskAssessment.aiSystemId,
      changes: {
        fromStatus: existing.status,
        toStatus: updated.status,
      },
    });

    return NextResponse.json(updated);
  });
}
