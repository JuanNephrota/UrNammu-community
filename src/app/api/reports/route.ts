import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withAuth, withRole } from "@/lib/auth-guard";
import { createAuditLog } from "@/lib/audit";
import { createReportSchema } from "@/lib/validations/report";

export const dynamic = "force-dynamic";

// GET /api/reports — list reports visible to the caller (owned + SHARED).
export async function GET() {
  return withAuth(async (session) => {
    const reports = await prisma.reportDefinition.findMany({
      where: {
        OR: [{ ownerId: session.user.userId }, { visibility: "SHARED" }],
      },
      orderBy: { updatedAt: "desc" },
      include: {
        owner: { select: { name: true, email: true } },
        _count: { select: { schedules: true, runs: true } },
      },
    });
    return NextResponse.json(reports);
  });
}

// POST /api/reports — create a report definition. Authors only.
export async function POST(req: NextRequest) {
  return withRole(["ADMIN", "COMPLIANCE_OFFICER"], async (session) => {
    const body = await req.json();
    const parsed = createReportSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const created = await prisma.reportDefinition.create({
      data: {
        name: parsed.data.name,
        description: parsed.data.description ?? null,
        dataSource: parsed.data.dataSource,
        templateKey: parsed.data.templateKey ?? null,
        config: parsed.data.config,
        visibility: parsed.data.visibility,
        ownerId: session.user.userId,
      },
    });

    await createAuditLog({
      userId: session.user.userId,
      action: "CREATE",
      entityType: "ReportDefinition",
      entityId: created.id,
    });

    return NextResponse.json(created, { status: 201 });
  });
}
