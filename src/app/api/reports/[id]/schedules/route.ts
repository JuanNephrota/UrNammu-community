import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withRole } from "@/lib/auth-guard";
import { createAuditLog } from "@/lib/audit";
import { createScheduleSchema } from "@/lib/validations/report";
import { computeNextRun } from "@/lib/reports/schedule";

export const dynamic = "force-dynamic";

const AUTHOR_ROLES = ["ADMIN", "COMPLIANCE_OFFICER"];

// GET /api/reports/:id/schedules — list schedules for a report.
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withRole(AUTHOR_ROLES, async () => {
    const { id } = await params;
    const schedules = await prisma.reportSchedule.findMany({
      where: { definitionId: id },
      orderBy: { createdAt: "desc" },
    });
    return NextResponse.json(schedules);
  });
}

// POST /api/reports/:id/schedules — create a recurring schedule.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withRole(AUTHOR_ROLES, async (session) => {
    const { id } = await params;
    const definition = await prisma.reportDefinition.findUnique({ where: { id } });
    if (!definition) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const body = await req.json();
    const parsed = createScheduleSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.flatten() },
        { status: 400 }
      );
    }
    const data = parsed.data;
    const nextRunAt = computeNextRun(
      data.frequency,
      data.hourUtc,
      data.dayOfWeek ?? null,
      data.dayOfMonth ?? null
    );

    const created = await prisma.reportSchedule.create({
      data: {
        definitionId: id,
        frequency: data.frequency,
        hourUtc: data.hourUtc,
        dayOfWeek: data.dayOfWeek ?? null,
        dayOfMonth: data.dayOfMonth ?? null,
        format: data.format,
        recipients: data.recipients,
        enabled: data.enabled,
        nextRunAt,
        createdById: session.user.userId,
      },
    });

    await createAuditLog({
      userId: session.user.userId,
      action: "CREATE",
      entityType: "ReportSchedule",
      entityId: created.id,
      changes: { definitionId: id, frequency: data.frequency },
    });

    return NextResponse.json(created, { status: 201 });
  });
}
