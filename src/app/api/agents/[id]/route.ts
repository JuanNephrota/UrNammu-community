import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withAuth, withRole } from "@/lib/auth-guard";
import { updateAgentSchema } from "@/lib/validations/agent";
import { createAuditLog } from "@/lib/audit";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withAuth(async () => {
    const { id } = await params;
    const agent = await prisma.aIAgent.findUnique({
      where: { id },
      include: {
        owner: { select: { name: true, email: true } },
        aiSystem: { select: { id: true, name: true } },
        auditLogs: {
          orderBy: { createdAt: "desc" },
          take: 10,
          include: { user: { select: { name: true } } },
        },
      },
    });
    if (!agent) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(agent);
  });
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withRole(["ADMIN", "COMPLIANCE_OFFICER"], async (session) => {
    const { id } = await params;
    const body = await req.json();
    const parsed = updateAgentSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Validation failed" }, { status: 400 });
    }

    const agent = await prisma.aIAgent.update({
      where: { id },
      data: parsed.data,
    });

    await createAuditLog({
      userId: session.user.userId,
      action: "UPDATE",
      entityType: "AIAgent",
      entityId: agent.id,
      agentId: agent.id,
    });

    return NextResponse.json(agent);
  });
}
