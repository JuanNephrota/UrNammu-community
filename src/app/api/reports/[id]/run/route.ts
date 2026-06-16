import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withAuth } from "@/lib/auth-guard";
import { createAuditLog } from "@/lib/audit";
import { runReportSchema } from "@/lib/validations/report";
import { canView, loadDefinition, MAX_STORED_ARTIFACT_BYTES } from "@/lib/reports/access";
import { generateReport } from "@/lib/reports/generate";
import type { ReportConfig, ReportDataSourceKey } from "@/lib/reports/types";

// PDF rendering requires the Node runtime.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// POST /api/reports/:id/run — generate the report in the requested format,
// record a ReportRun, and stream the file back as an attachment.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withAuth(async (session) => {
    const { id } = await params;
    const definition = await loadDefinition(id);
    if (!definition) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (!canView(definition, session))
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const body = await req.json().catch(() => ({}));
    const parsed = runReportSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.flatten() },
        { status: 400 }
      );
    }
    const { format, overrides } = parsed.data;

    try {
      const generated = await generateReport(
        {
          name: definition.name,
          description: definition.description,
          dataSource: definition.dataSource as ReportDataSourceKey,
          config: definition.config as unknown as ReportConfig,
        },
        format,
        { overrides, generatedBy: session.user.email ?? session.user.name ?? null }
      );

      await prisma.reportRun.create({
        data: {
          definitionId: definition.id,
          format,
          status: "SUCCESS",
          rowCount: generated.rowCount,
          filename: generated.filename,
          contentType: generated.contentType,
          content:
            generated.buffer.byteLength <= MAX_STORED_ARTIFACT_BYTES
              ? new Uint8Array(generated.buffer)
              : null,
          triggeredById: session.user.userId,
        },
      });

      await createAuditLog({
        userId: session.user.userId,
        action: "RUN",
        entityType: "ReportDefinition",
        entityId: definition.id,
        changes: { format, rowCount: generated.rowCount },
      });

      return new NextResponse(new Uint8Array(generated.buffer), {
        status: 200,
        headers: {
          "Content-Type": generated.contentType,
          "Content-Disposition": `attachment; filename="${generated.filename}"`,
          "Content-Length": String(generated.buffer.byteLength),
          "Cache-Control": "no-store",
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Report generation failed";
      await prisma.reportRun.create({
        data: {
          definitionId: definition.id,
          format,
          status: "FAILED",
          error: message,
          triggeredById: session.user.userId,
        },
      });
      return NextResponse.json({ error: message }, { status: 500 });
    }
  });
}
