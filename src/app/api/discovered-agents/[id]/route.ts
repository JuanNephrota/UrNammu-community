import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { withAuth, withRole } from "@/lib/auth-guard";
import { createAuditLog } from "@/lib/audit";

const updateSchema = z
  .object({
    // REGISTERED is reached only through POST .../register, which links an agent.
    status: z.enum(["DISCOVERED", "UNDER_REVIEW", "APPROVED", "BLOCKED"]).optional(),
    notes: z.string().max(2000).nullish(),
  })
  .refine((data) => data.status !== undefined || data.notes !== undefined, {
    message: "status or notes is required",
  });

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withAuth(async () => {
    const { id } = await params;
    const row = await prisma.discoveredAgent.findUnique({
      where: { id },
      include: { linkedAgent: { select: { id: true, name: true } } },
    });
    if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(row);
  });
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withRole(["ADMIN", "COMPLIANCE_OFFICER"], async (session) => {
    const { id } = await params;
    const parsed = updateSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: "Validation failed", details: parsed.error.flatten() }, { status: 400 });
    }
    const existing = await prisma.discoveredAgent.findUnique({ where: { id } });
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const updated = await prisma.discoveredAgent.update({
      where: { id },
      data: {
        status: parsed.data.status,
        notes: parsed.data.notes === undefined ? undefined : parsed.data.notes,
      },
    });
    await createAuditLog({
      userId: session.user.userId,
      action: "UPDATE",
      entityType: "DiscoveredAgent",
      entityId: id,
      changes: {
        ...(parsed.data.status ? { status: { from: existing.status, to: parsed.data.status } } : {}),
        ...(parsed.data.notes !== undefined ? { notes: true } : {}),
      },
    });
    return NextResponse.json(updated);
  });
}
