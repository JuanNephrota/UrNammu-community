import { NextRequest, NextResponse } from "next/server";
import { withAuth, withRole } from "@/lib/auth-guard";
import { prisma } from "@/lib/prisma";
import { createAuditLog } from "@/lib/audit";
import { z } from "zod";

const createSchema = z.object({
  title: z.string().min(1),
  summary: z.string().optional().nullable(),
  aiSystemId: z.string().optional().nullable(),
  alertId: z.string().optional().nullable(),
  governanceIncidentId: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

export async function GET() {
  return withAuth(async () => {
    const investigations = await prisma.investigation.findMany({
      orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
      include: {
        ownerUser: { select: { id: true, name: true, email: true } },
        aiSystem: { select: { id: true, name: true } },
        alert: { select: { id: true, title: true, severity: true } },
        governanceIncident: { select: { id: true, title: true, severity: true } },
      },
      take: 100,
    });
    return NextResponse.json(investigations);
  });
}

export async function POST(req: NextRequest) {
  return withRole(["ADMIN", "COMPLIANCE_OFFICER"], async (session) => {
    const parsed = createSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "Validation failed" }, { status: 400 });
    }

    if (parsed.data.alertId) {
      const existing = await prisma.investigation.findUnique({
        where: { alertId: parsed.data.alertId },
      });
      if (existing) return NextResponse.json(existing);
    }

    if (parsed.data.governanceIncidentId) {
      const existing = await prisma.investigation.findUnique({
        where: { governanceIncidentId: parsed.data.governanceIncidentId },
      });
      if (existing) return NextResponse.json(existing);
    }

    const investigation = await prisma.investigation.create({
      data: {
        title: parsed.data.title,
        summary: parsed.data.summary || null,
        aiSystemId: parsed.data.aiSystemId || null,
        alertId: parsed.data.alertId || null,
        governanceIncidentId: parsed.data.governanceIncidentId || null,
        notes: parsed.data.notes || null,
        ownerUserId: session.user.userId,
      },
    });

    await createAuditLog({
      userId: session.user.userId,
      action: "CREATE",
      entityType: "Investigation",
      entityId: investigation.id,
      aiSystemId: investigation.aiSystemId ?? undefined,
    });

    return NextResponse.json(investigation, { status: 201 });
  });
}
