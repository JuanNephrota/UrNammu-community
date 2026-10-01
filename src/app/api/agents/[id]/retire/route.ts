import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { withRole } from "@/lib/auth-guard";

const retireSchema = z.object({
  notes: z.string().trim().max(5000).optional(),
  attested: z.boolean().default(false),
});

const select = {
  id: true,
  name: true,
  status: true,
  retiredAt: true,
  retirementNotes: true,
  retirementAttested: true,
  retiredBy: { select: { name: true, email: true } },
} as const;

/**
 * POST /api/agents/[id]/retire   Body: { notes?, attested }
 *
 * Controlled shutdown (playbook phase 6). Sets the agent to RETIRED, which
 * makes both proxies refuse its traffic (agent_retired), records who retired
 * it and whether disposal of data, credentials and artifacts was attested,
 * and revokes a standing approval so re-activation must go back through the
 * gate. Idempotent: retiring again only updates notes and attestation.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withRole(["ADMIN", "COMPLIANCE_OFFICER"], async (session) => {
    const { id } = await params;
    const parsed = retireSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ error: "Validation failed", details: parsed.error.flatten() }, { status: 400 });
    }

    const existing = await prisma.aIAgent.findUnique({
      where: { id },
      include: { approvals: { orderBy: { createdAt: "desc" }, take: 1, select: { decision: true } } },
    });
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const notes = parsed.data.notes || null;
    const alreadyRetired = existing.status === "RETIRED" && existing.retiredAt;

    const agent = await prisma.$transaction(async (tx) => {
      const updated = await tx.aIAgent.update({
        where: { id },
        data: {
          status: "RETIRED",
          retiredAt: alreadyRetired ? existing.retiredAt : new Date(),
          retiredById: alreadyRetired ? existing.retiredById : session.user.userId,
          retirementNotes: notes ?? existing.retirementNotes,
          retirementAttested: parsed.data.attested || existing.retirementAttested,
        },
        select,
      });

      if (existing.approvals[0]?.decision === "APPROVED") {
        await tx.agentApproval.create({
          data: {
            agentId: id,
            decidedByUserId: session.user.userId,
            decision: "REVOKED",
            rationale: `Retired${notes ? `: ${notes}` : ""}`,
          },
        });
      }

      await tx.auditLog.create({
        data: {
          userId: session.user.userId,
          action: "RETIRE",
          entityType: "AIAgent",
          entityId: id,
          agentId: id,
          aiSystemId: existing.aiSystemId ?? undefined,
          changes: {
            from: existing.status,
            attested: updated.retirementAttested,
            notes,
            approvalRevoked: existing.approvals[0]?.decision === "APPROVED",
          },
        },
      });

      return updated;
    });

    return NextResponse.json(agent);
  });
}
