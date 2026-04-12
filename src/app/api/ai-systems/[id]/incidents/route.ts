import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withRole } from "@/lib/auth-guard";
import { prisma } from "@/lib/prisma";

const incidentSchema = z.object({
  title: z.string().trim().min(1).max(200),
  summary: z.string().trim().optional(),
  severity: z.enum(["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"]),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withRole(["ADMIN", "COMPLIANCE_OFFICER"], async (session) => {
    const { id } = await params;
    const body = await req.json();
    const parsed = incidentSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json({ error: "Validation failed", details: parsed.error.flatten() }, { status: 400 });
    }

    const system = await prisma.aISystem.findUnique({ where: { id } });
    if (!system) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const incident = await prisma.$transaction(async (tx) => {
      const created = await tx.governanceIncident.create({
        data: {
          aiSystemId: id,
          openedByUserId: session.user.userId,
          title: parsed.data.title,
          summary: parsed.data.summary || null,
          severity: parsed.data.severity,
        },
        include: { openedByUser: { select: { name: true, email: true } } },
      });

      await tx.alert.create({
        data: {
          title: `Governance incident: ${created.title}`,
          description: created.summary,
          severity: created.severity,
          source: "governance_incident",
          aiSystemId: id,
          governanceIncidentId: created.id,
        },
      });

      await tx.auditLog.create({
        data: {
          userId: session.user.userId,
          action: "CREATE",
          entityType: "GovernanceIncident",
          entityId: created.id,
          aiSystemId: id,
          changes: { title: created.title, severity: created.severity },
        },
      });

      return created;
    });

    return NextResponse.json(incident, { status: 201 });
  });
}
