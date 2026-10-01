import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withAuth, withRole } from "@/lib/auth-guard";
import { normalizeAgentText, updateAgentSchema } from "@/lib/validations/agent";
import { createAuditLog } from "@/lib/audit";

const LIVE_STATUSES = new Set(["APPROVED", "DEPLOYED"]);

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

    const existing = await prisma.aIAgent.findUnique({
      where: { id },
      include: { approvals: { orderBy: { createdAt: "desc" }, take: 1, select: { decision: true } } },
    });
    if (!existing) {
      return NextResponse.json({ error: "Agent not found" }, { status: 404 });
    }

    // The approval gate: an agent only becomes APPROVED or DEPLOYED through a
    // recorded approval. Existing live agents can still be edited freely; only
    // the transition into a live status is gated.
    const data = normalizeAgentText(parsed.data);
    const enteringLive =
      data.status !== undefined && LIVE_STATUSES.has(data.status) && !LIVE_STATUSES.has(existing.status);
    if (enteringLive && existing.approvals[0]?.decision !== "APPROVED") {
      return NextResponse.json(
        {
          error:
            "Record an approval decision before moving this agent to APPROVED or DEPLOYED. Use the Approval Review card on the agent page.",
          blockers: [
            {
              category: "approval",
              message: "No approval on record.",
              href: `/agents/${id}#approval`,
            },
          ],
        },
        { status: 400 }
      );
    }

    const intervalChanged =
      data.reviewIntervalDays !== undefined && data.reviewIntervalDays !== existing.reviewIntervalDays;
    const nextReviewDate =
      intervalChanged || (data.reviewIntervalDays !== undefined && !existing.nextReviewDate)
        ? new Date(Date.now() + (data.reviewIntervalDays as number) * 24 * 60 * 60 * 1000)
        : undefined;

    const agent = await prisma.aIAgent.update({
      where: { id },
      data: { ...data, ...(nextReviewDate ? { nextReviewDate } : {}) },
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
