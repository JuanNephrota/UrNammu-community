import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withRole } from "@/lib/auth-guard";
import { createAuditLog } from "@/lib/audit";
import { updateScheduleSchema } from "@/lib/validations/report";
import { computeNextRun } from "@/lib/reports/schedule";

export const dynamic = "force-dynamic";

const AUTHOR_ROLES = ["ADMIN", "COMPLIANCE_OFFICER"];

// PATCH /api/reports/:id/schedules/:scheduleId — update a schedule. Any change
// to cadence recomputes nextRunAt.
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; scheduleId: string }> }
) {
  return withRole(AUTHOR_ROLES, async (session) => {
    const { scheduleId } = await params;
    const existing = await prisma.reportSchedule.findUnique({ where: { id: scheduleId } });
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const body = await req.json();
    const parsed = updateScheduleSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.flatten() },
        { status: 400 }
      );
    }
    const data = parsed.data;

    const frequency = data.frequency ?? existing.frequency;
    const hourUtc = data.hourUtc ?? existing.hourUtc;
    const dayOfWeek = data.dayOfWeek !== undefined ? data.dayOfWeek : existing.dayOfWeek;
    const dayOfMonth = data.dayOfMonth !== undefined ? data.dayOfMonth : existing.dayOfMonth;
    const cadenceChanged =
      data.frequency !== undefined ||
      data.hourUtc !== undefined ||
      data.dayOfWeek !== undefined ||
      data.dayOfMonth !== undefined;

    const updated = await prisma.reportSchedule.update({
      where: { id: scheduleId },
      data: {
        frequency,
        hourUtc,
        dayOfWeek: dayOfWeek ?? null,
        dayOfMonth: dayOfMonth ?? null,
        ...(data.format !== undefined ? { format: data.format } : {}),
        ...(data.recipients !== undefined ? { recipients: data.recipients } : {}),
        ...(data.enabled !== undefined ? { enabled: data.enabled } : {}),
        ...(cadenceChanged
          ? { nextRunAt: computeNextRun(frequency, hourUtc, dayOfWeek, dayOfMonth) }
          : {}),
      },
    });

    await createAuditLog({
      userId: session.user.userId,
      action: "UPDATE",
      entityType: "ReportSchedule",
      entityId: scheduleId,
    });

    return NextResponse.json(updated);
  });
}

// DELETE /api/reports/:id/schedules/:scheduleId
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; scheduleId: string }> }
) {
  return withRole(AUTHOR_ROLES, async (session) => {
    const { scheduleId } = await params;
    const existing = await prisma.reportSchedule.findUnique({ where: { id: scheduleId } });
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

    await prisma.reportSchedule.delete({ where: { id: scheduleId } });
    await createAuditLog({
      userId: session.user.userId,
      action: "DELETE",
      entityType: "ReportSchedule",
      entityId: scheduleId,
    });
    return NextResponse.json({ ok: true });
  });
}
