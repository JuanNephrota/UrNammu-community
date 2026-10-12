import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withRole } from "@/lib/auth-guard";
import { createAuditLog } from "@/lib/audit";

/** DELETE /api/tool-classifications/[id] — remove a rule; the name heuristic applies again. */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withRole(["ADMIN", "COMPLIANCE_OFFICER"], async (session) => {
    const { id } = await params;
    const existing = await prisma.toolClassification.findUnique({ where: { id } });
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
    await prisma.toolClassification.delete({ where: { id } });
    await createAuditLog({
      userId: session.user.userId,
      action: "DELETE",
      entityType: "ToolClassification",
      entityId: id,
      changes: { server: existing.server, tool: existing.tool, access: existing.access },
    });
    return NextResponse.json({ ok: true });
  });
}
