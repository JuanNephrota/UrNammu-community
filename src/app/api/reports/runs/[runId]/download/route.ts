import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withAuth } from "@/lib/auth-guard";
import { canView } from "@/lib/reports/access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/reports/runs/:runId/download — stream a stored run artifact.
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ runId: string }> }
) {
  return withAuth(async (session) => {
    const { runId } = await params;
    const run = await prisma.reportRun.findUnique({
      where: { id: runId },
      include: { definition: { select: { ownerId: true, visibility: true } } },
    });
    if (!run) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (!canView(run.definition, session))
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    if (!run.content)
      return NextResponse.json(
        { error: "Artifact not stored (too large or run failed). Re-run the report to download." },
        { status: 410 }
      );

    const bytes = new Uint8Array(run.content as unknown as Buffer);
    return new NextResponse(bytes, {
      status: 200,
      headers: {
        "Content-Type": run.contentType ?? "application/octet-stream",
        "Content-Disposition": `attachment; filename="${run.filename ?? "report"}"`,
        "Content-Length": String(bytes.byteLength),
        "Cache-Control": "no-store",
      },
    });
  });
}
