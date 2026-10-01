import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withRole } from "@/lib/auth-guard";
import { prisma } from "@/lib/prisma";

const incidentSchema = z.object({
  title: z.string().trim().min(1).max(200),
  summary: z.string().trim().optional(),
  severity: z.enum(["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"]),
});

/**
 * POST /api/agents/[id]/incidents   Body: { title, summary?, severity }
 *
 * Opens a governance incident against an agent (GovernanceIncident.agentId).
 * The linked alert is attributed to the agent's parent system when it has
 * one. Open incidents hard-block the agent's approval and appear in the
 * workflow notifications feed.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withRole(["ADMIN", "COMPLIANCE_OFFICER"], async (session) => {
    const { id } = await params;
    const parsed = incidentSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: "Validation failed", details: parsed.error.flatten() }, { status: 400 });
    }

    const agent = await prisma.aIAgent.findUnique({ where: { id }, select: { id: true, name: true, aiSystemId: true } });
    if (!agent) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const incident = await prisma.$transaction(async (tx) => {
      const created = await tx.governanceIncident.create({
        data: {
          agentId: agent.id,
          aiSystemId: agent.aiSystemId,
          openedByUserId: session.user.userId,
          title: parsed.data.title,
          summary: parsed.data.summary || null,
          severity: parsed.data.severity,
        },
        include: { openedByUser: { select: { name: true, email: true } } },
      });

      await tx.alert.create({
        data: {
          title: `Agent incident: ${created.title}`,
          description: `${created.summary ?? ""}\n\nAgent: ${agent.name}. Suspend it from the agent page if the behaviour must stop now.`.trim(),
          severity: created.severity,
          source: "governance_incident",
          aiSystemId: agent.aiSystemId,
          governanceIncidentId: created.id,
        },
      });

      await tx.auditLog.create({
        data: {
          userId: session.user.userId,
          action: "CREATE",
          entityType: "GovernanceIncident",
          entityId: created.id,
          agentId: agent.id,
          aiSystemId: agent.aiSystemId ?? undefined,
          changes: { title: created.title, severity: created.severity },
        },
      });

      return created;
    });

    return NextResponse.json(incident, { status: 201 });
  });
}
