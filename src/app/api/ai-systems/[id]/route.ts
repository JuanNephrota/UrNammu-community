import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withAuth, withRole } from "@/lib/auth-guard";
import { updateAISystemSchema } from "@/lib/validations/ai-system";
import { createAuditLog } from "@/lib/audit";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withAuth(async () => {
    const { id } = await params;
    const system = await prisma.aISystem.findUnique({
      where: { id },
      include: {
        owner: { select: { id: true, name: true, email: true, image: true } },
        agents: { select: { id: true, name: true, autonomyLevel: true, status: true } },
        riskAssessments: { orderBy: { createdAt: "desc" }, take: 5 },
        policyAssignments: {
          include: { policy: { select: { id: true, name: true, framework: true } } },
        },
        complianceMappings: true,
      },
    });

    if (!system) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json(system);
  });
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withRole(["ADMIN", "COMPLIANCE_OFFICER"], async (session) => {
    const { id } = await params;
    const body = await req.json();
    const parsed = updateAISystemSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const existing = await prisma.aISystem.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const system = await prisma.aISystem.update({
      where: { id },
      data: parsed.data,
      include: {
        owner: { select: { id: true, name: true, email: true } },
      },
    });

    await createAuditLog({
      userId: session.user.userId,
      action: "UPDATE",
      entityType: "AISystem",
      entityId: system.id,
      aiSystemId: system.id,
      changes: JSON.parse(JSON.stringify({ before: existing, after: system })),
    });

    return NextResponse.json(system);
  });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withRole(["ADMIN"], async (session) => {
    const { id } = await params;
    const existing = await prisma.aISystem.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const system = await prisma.aISystem.update({
      where: { id },
      data: { status: "RETIRED" },
    });

    await createAuditLog({
      userId: session.user.userId,
      action: "DELETE",
      entityType: "AISystem",
      entityId: system.id,
      aiSystemId: system.id,
    });

    return NextResponse.json({ success: true });
  });
}
