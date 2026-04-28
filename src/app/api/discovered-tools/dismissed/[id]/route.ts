import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withRole } from "@/lib/auth-guard";
import { createAuditLog } from "@/lib/audit";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withRole(["ADMIN", "COMPLIANCE_OFFICER"], async (session) => {
    const { id } = await params;

    const existing = await prisma.dismissedCandidate.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    await prisma.dismissedCandidate.delete({ where: { id } });

    await createAuditLog({
      userId: session.user.userId,
      action: "UNDISMISS_CANDIDATE",
      entityType: "DismissedCandidate",
      entityId: id,
      changes: { toolName: existing.toolName, detectedDomain: existing.detectedDomain },
    });

    return NextResponse.json({ undismissed: true });
  });
}
