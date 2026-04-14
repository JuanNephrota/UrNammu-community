import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withRole } from "@/lib/auth-guard";
import { z } from "zod";

const updateAlertSchema = z.object({
  status: z.enum(["OPEN", "ACKNOWLEDGED", "RESOLVED", "DISMISSED"]),
});

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withRole(["ADMIN", "COMPLIANCE_OFFICER"], async () => {
    const { id } = await params;
    const body = await req.json();
    const parsed = updateAlertSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Validation failed", details: parsed.error.flatten() }, { status: 400 });
    }

    const existing = await prisma.alert.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "Alert not found" }, { status: 404 });
    }

    const alert = await prisma.alert.update({
      where: { id },
      data: { status: parsed.data.status },
    });
    return NextResponse.json(alert);
  });
}
