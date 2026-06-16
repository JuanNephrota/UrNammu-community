import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withAuth } from "@/lib/auth-guard";
import { createAuditLog } from "@/lib/audit";
import { updateReportSchema } from "@/lib/validations/report";
import { canMutate, canView, loadDefinition } from "@/lib/reports/access";

export const dynamic = "force-dynamic";

// GET /api/reports/:id — definition + recent runs + schedules.
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withAuth(async (session) => {
    const { id } = await params;
    const definition = await prisma.reportDefinition.findUnique({
      where: { id },
      include: {
        owner: { select: { name: true, email: true } },
        schedules: { orderBy: { createdAt: "desc" } },
        runs: {
          orderBy: { createdAt: "desc" },
          take: 20,
          select: {
            id: true,
            format: true,
            status: true,
            rowCount: true,
            filename: true,
            error: true,
            deliveredTo: true,
            createdAt: true,
            scheduleId: true,
            contentType: true,
            // content intentionally omitted — fetched via the download route
          },
        },
      },
    });
    if (!definition) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (!canView(definition, session))
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    return NextResponse.json(definition);
  });
}

// PATCH /api/reports/:id — update. Owner or author roles only.
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withAuth(async (session) => {
    const { id } = await params;
    const definition = await loadDefinition(id);
    if (!definition) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (!canMutate(definition, session))
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const body = await req.json();
    const parsed = updateReportSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const data = parsed.data;
    const updated = await prisma.reportDefinition.update({
      where: { id },
      data: {
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.description !== undefined ? { description: data.description ?? null } : {}),
        ...(data.dataSource !== undefined ? { dataSource: data.dataSource } : {}),
        ...(data.templateKey !== undefined ? { templateKey: data.templateKey ?? null } : {}),
        ...(data.config !== undefined ? { config: data.config } : {}),
        ...(data.visibility !== undefined ? { visibility: data.visibility } : {}),
      },
    });

    await createAuditLog({
      userId: session.user.userId,
      action: "UPDATE",
      entityType: "ReportDefinition",
      entityId: id,
    });

    return NextResponse.json(updated);
  });
}

// DELETE /api/reports/:id — cascades to schedules + runs.
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withAuth(async (session) => {
    const { id } = await params;
    const definition = await loadDefinition(id);
    if (!definition) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (!canMutate(definition, session))
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    await prisma.reportDefinition.delete({ where: { id } });
    await createAuditLog({
      userId: session.user.userId,
      action: "DELETE",
      entityType: "ReportDefinition",
      entityId: id,
    });
    return NextResponse.json({ ok: true });
  });
}
