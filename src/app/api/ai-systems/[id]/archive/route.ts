import { NextRequest, NextResponse } from "next/server";
import { withRole } from "@/lib/auth-guard";
import { prisma } from "@/lib/prisma";
import { createAuditLog } from "@/lib/audit";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withRole(["ADMIN", "COMPLIANCE_OFFICER"], async (session) => {
    const { id } = await params;
    const existing = await prisma.aISystem.findUnique({ where: { id } });

    if (!existing) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    if (existing.status === "RETIRED") {
      return NextResponse.json({ success: true, system: existing });
    }

    const system = await prisma.aISystem.update({
      where: { id },
      data: { status: "RETIRED" },
    });

    await createAuditLog({
      userId: session.user.userId,
      action: "ARCHIVE",
      entityType: "AISystem",
      entityId: system.id,
      aiSystemId: system.id,
      changes: {
        before: { status: existing.status },
        after: { status: system.status },
      },
    });

    return NextResponse.json({ success: true, system });
  });
}
