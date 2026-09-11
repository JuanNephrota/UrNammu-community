import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withAuth, withRole } from "@/lib/auth-guard";
import { createAuditLog } from "@/lib/audit";
import { upsertControlMappingSchema } from "@/lib/validations/compliance-mapping";
import { isCatalogFramework } from "@/lib/framework-catalog";
import { loadSystemCoverage } from "@/lib/framework-controls-data";

/**
 * GET /api/ai-systems/[id]/control-mappings[?framework=X]
 *
 * Coverage rows for the system: every catalog control with its direct or
 * inherited status. Without `framework`, returns all four frameworks.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withAuth(async () => {
    const { id } = await params;
    const framework = req.nextUrl.searchParams.get("framework");
    if (framework && !isCatalogFramework(framework)) {
      return NextResponse.json({ error: "Unknown framework" }, { status: 400 });
    }
    const system = await prisma.aISystem.findUnique({ where: { id }, select: { id: true } });
    if (!system) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const coverage = await loadSystemCoverage(id);
    if (framework && isCatalogFramework(framework)) {
      return NextResponse.json(coverage[framework]);
    }
    return NextResponse.json(coverage);
  });
}

/**
 * PUT /api/ai-systems/[id]/control-mappings
 * Body: { controlId, status, evidence? }
 *
 * Upserts the system's assessment of one catalog control. `framework` and
 * `requirement` on the ComplianceMapping row are derived from the control so
 * the legacy executive-posture query (which groups by status) keeps working.
 */
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withRole(["ADMIN", "COMPLIANCE_OFFICER"], async (session) => {
    const { id } = await params;
    const body = await req.json().catch(() => null);
    const parsed = upsertControlMappingSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const [system, control] = await Promise.all([
      prisma.aISystem.findUnique({ where: { id }, select: { id: true } }),
      prisma.frameworkControl.findUnique({
        where: { id: parsed.data.controlId },
        select: { id: true, framework: true, code: true, title: true },
      }),
    ]);
    if (!system) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (!control) return NextResponse.json({ error: "Unknown control" }, { status: 400 });

    const existing = await prisma.complianceMapping.findUnique({
      where: { aiSystemId_controlId: { aiSystemId: id, controlId: control.id } },
      select: { id: true, status: true, evidence: true },
    });

    const requirement = `${control.code} — ${control.title}`;
    const mapping = await prisma.complianceMapping.upsert({
      where: { aiSystemId_controlId: { aiSystemId: id, controlId: control.id } },
      update: {
        status: parsed.data.status,
        evidence: parsed.data.evidence,
        requirement,
        assessedAt: new Date(),
      },
      create: {
        aiSystemId: id,
        controlId: control.id,
        framework: control.framework,
        requirement,
        status: parsed.data.status,
        evidence: parsed.data.evidence,
        assessedAt: new Date(),
      },
    });

    await createAuditLog({
      userId: session.user.userId,
      action: existing ? "UPDATE" : "CREATE",
      entityType: "ComplianceMapping",
      entityId: mapping.id,
      aiSystemId: id,
      changes: {
        control: `${control.framework} ${control.code}`,
        before: existing ? { status: existing.status, evidence: existing.evidence } : null,
        after: { status: mapping.status, evidence: mapping.evidence },
      },
    });

    return NextResponse.json(mapping);
  });
}
