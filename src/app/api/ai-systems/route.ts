import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withAuth, withRole } from "@/lib/auth-guard";
import { createAISystemSchema } from "@/lib/validations/ai-system";
import { createAuditLog } from "@/lib/audit";

export async function GET() {
  return withAuth(async () => {
    const systems = await prisma.aISystem.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        owner: { select: { id: true, name: true, email: true } },
        _count: {
          select: {
            agents: true,
            riskAssessments: true,
            policyAssignments: true,
          },
        },
      },
    });
    return NextResponse.json(systems);
  });
}

export async function POST(req: NextRequest) {
  return withRole(["ADMIN", "COMPLIANCE_OFFICER"], async (session) => {
    const body = await req.json();
    const parsed = createAISystemSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const system = await prisma.aISystem.create({
      data: {
        ...parsed.data,
        ownerId: session.user.userId,
      },
      include: {
        owner: { select: { id: true, name: true, email: true } },
      },
    });

    await createAuditLog({
      userId: session.user.userId,
      action: "CREATE",
      entityType: "AISystem",
      entityId: system.id,
      aiSystemId: system.id,
    });

    return NextResponse.json(system, { status: 201 });
  });
}
