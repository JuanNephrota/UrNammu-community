import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withRole } from "@/lib/auth-guard";
import { createAuditLog } from "@/lib/audit";

/**
 * DELETE /api/mcp-catalog/[id] — withdraw a server from the org catalog.
 * Soft: the row is kept (inactive) for the audit trail and both proxies stop
 * merging it within their cache window.
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withRole(["ADMIN", "COMPLIANCE_OFFICER"], async (session) => {
    const { id } = await params;
    const existing = await prisma.mcpCatalogEntry.findUnique({ where: { id } });
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const entry = await prisma.mcpCatalogEntry.update({ where: { id }, data: { active: false } });
    await createAuditLog({
      userId: session.user.userId,
      action: "WITHDRAW",
      entityType: "McpCatalogEntry",
      entityId: id,
      changes: { server: existing.server },
    });
    return NextResponse.json(entry);
  });
}
