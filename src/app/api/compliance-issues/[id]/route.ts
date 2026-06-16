import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withRole } from "@/lib/auth-guard";
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
    const parsed = updateSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "Validation failed" }, { status: 400 });
    }

    const existing = await prisma.complianceIssue.findUnique({
      where: { id },
      include: {
        policyAssignment: {
          select: { aiSystemId: true },
        },
      },
    });
    if (!existing) {
      return NextResponse.json({ error: "Compliance issue not found" }, { status: 404 });
    }

    const issue = await prisma.complianceIssue.update({
      where: { id },
      data: { status: parsed.data.status },
    });

    await createAuditLog({
      userId: session.user.userId,
      action: "UPDATE",
      entityType: "ComplianceIssue",
      entityId: issue.id,
      aiSystemId: existing.policyAssignment.aiSystemId,
      changes: {
        fromStatus: existing.status,
        toStatus: issue.status,
      },
    });

    return NextResponse.json(issue);
  });
}
