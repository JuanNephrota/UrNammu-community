import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withRole } from "@/lib/auth-guard";
import { createAuditLog } from "@/lib/audit";
import { z } from "zod";

const updateExceptionSchema = z.object({
  active: z.boolean().optional(),
  expiresAt: z.string().datetime().nullable().optional(),
});

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withRole(["ADMIN", "COMPLIANCE_OFFICER"], async (session) => {
    const { id } = await params;
    const body = await req.json();
    const parsed = updateExceptionSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Validation failed", details: parsed.error.flatten() }, { status: 400 });
    }

    const existing = await prisma.promptRiskException.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "Exception not found" }, { status: 404 });
    }

    const data: Record<string, unknown> = {};
    if (parsed.data.active !== undefined) data.active = parsed.data.active;
    if (parsed.data.expiresAt !== undefined) {
      data.expiresAt = parsed.data.expiresAt ? new Date(parsed.data.expiresAt) : null;
    }

    const exception = await prisma.promptRiskException.update({
      where: { id },
      data,
    });

    await createAuditLog({
      userId: session.user.userId,
      action: "UPDATE",
      entityType: "PromptRiskException",
      entityId: id,
      changes: JSON.parse(JSON.stringify(data)),
    });

    return NextResponse.json(exception);
  });
}
