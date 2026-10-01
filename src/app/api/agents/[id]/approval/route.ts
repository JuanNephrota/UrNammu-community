import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withRole } from "@/lib/auth-guard";
import { prisma } from "@/lib/prisma";
import { loadAgentGovernance } from "@/lib/agent-governance-data";
import { getAgentApprovalBlockers, isHardAgentBlocker } from "@/lib/agent-governance";

const approvalSchema = z.object({
  decision: z.enum(["APPROVED", "CHANGES_REQUESTED", "REVOKED"]),
  rationale: z.string().trim().max(5000).optional(),
});

/**
 * POST /api/agents/[id]/approval   Body: { decision, rationale? }
 *
 * The agent approval gate. APPROVED is refused (400 + blockers) while any hard
 * blocker from `getAgentApprovalBlockers` remains: incomplete charter,
 * suspended, FULL_AUTONOMY without an enforced allowlist, HIGH/CRITICAL with
 * no risk basis, missing stage reviews, or no/overdue review date.
 *
 * APPROVED moves a DRAFT / UNDER_REVIEW agent to APPROVED (a DEPLOYED agent
 * stays DEPLOYED) and restarts the review clock. CHANGES_REQUESTED and REVOKED
 * return the agent to UNDER_REVIEW.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withRole(["ADMIN", "COMPLIANCE_OFFICER"], async (session) => {
    const { id } = await params;
    const parsed = approvalSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: "Validation failed", details: parsed.error.flatten() }, { status: 400 });
    }

    const loaded = await loadAgentGovernance(id);
    if (!loaded) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const { agent, input } = loaded;

    if (parsed.data.decision === "APPROVED") {
      const hardBlockers = getAgentApprovalBlockers(input).filter(isHardAgentBlocker);
      if (hardBlockers.length > 0) {
        return NextResponse.json(
          {
            error: "This agent is not yet ready for approval. Resolve the items below before approving.",
            blockers: hardBlockers.map(({ message, category, href }) => ({ message, category, href })),
          },
          { status: 400 }
        );
      }
    }

    const nextStatus =
      parsed.data.decision === "APPROVED"
        ? agent.status === "DEPLOYED"
          ? "DEPLOYED"
          : "APPROVED"
        : "UNDER_REVIEW";
    const nextReviewDate =
      parsed.data.decision === "APPROVED"
        ? new Date(Date.now() + agent.reviewIntervalDays * 24 * 60 * 60 * 1000)
        : undefined;

    const result = await prisma.$transaction(async (tx) => {
      const approval = await tx.agentApproval.create({
        data: {
          agentId: agent.id,
          decidedByUserId: session.user.userId,
          decision: parsed.data.decision,
          rationale: parsed.data.rationale,
        },
        include: { decidedByUser: { select: { id: true, name: true, email: true } } },
      });

      const updatedAgent = await tx.aIAgent.update({
        where: { id: agent.id },
        data: { status: nextStatus, ...(nextReviewDate ? { nextReviewDate } : {}) },
      });

      await tx.auditLog.create({
        data: {
          userId: session.user.userId,
          action: parsed.data.decision,
          entityType: "AgentApproval",
          entityId: approval.id,
          agentId: agent.id,
          aiSystemId: agent.aiSystemId ?? undefined,
          changes: {
            agentStatus: nextStatus,
            rationale: parsed.data.rationale ?? null,
            nextReviewDate: nextReviewDate?.toISOString() ?? null,
          },
        },
      });

      return { approval, updatedAgent };
    });

    return NextResponse.json(result, { status: 201 });
  });
}
