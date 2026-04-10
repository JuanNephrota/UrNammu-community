import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withAuth, withRole } from "@/lib/auth-guard";
import { createAgentSchema } from "@/lib/validations/agent";
import { createAuditLog } from "@/lib/audit";

export async function GET() {
  return withAuth(async () => {
    const agents = await prisma.aIAgent.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        owner: { select: { id: true, name: true } },
        aiSystem: { select: { id: true, name: true } },
      },
    });
    return NextResponse.json(agents);
  });
}

export async function POST(req: NextRequest) {
  return withRole(["ADMIN", "COMPLIANCE_OFFICER"], async (session) => {
    const body = await req.json();
    const parsed = createAgentSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const agent = await prisma.aIAgent.create({
      data: {
        ...parsed.data,
        ownerId: session.user.userId,
      },
    });

    await createAuditLog({
      userId: session.user.userId,
      action: "CREATE",
      entityType: "AIAgent",
      entityId: agent.id,
      agentId: agent.id,
    });

    return NextResponse.json(agent, { status: 201 });
  });
}
