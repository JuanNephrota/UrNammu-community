import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withAuth, withRole } from "@/lib/auth-guard";
import { updateAISystemSchema } from "@/lib/validations/ai-system";
import { createAuditLog } from "@/lib/audit";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withAuth(async () => {
    const { id } = await params;
    const system = await prisma.aISystem.findUnique({
      where: { id },
      include: {
        owner: { select: { id: true, name: true, email: true, image: true } },
        agents: { select: { id: true, name: true, autonomyLevel: true, status: true } },
        riskAssessments: { orderBy: { createdAt: "desc" }, take: 5 },
        approvals: {
          orderBy: { createdAt: "desc" },
          take: 10,
          include: {
            decidedByUser: { select: { id: true, name: true, email: true } },
          },
        },
        policyAssignments: {
          include: { policy: { select: { id: true, name: true, framework: true } } },
        },
        governanceReviews: {
          orderBy: { createdAt: "desc" },
          take: 20,
          include: { decidedByUser: { select: { id: true, name: true, email: true } } },
        },
        governanceExceptions: {
          orderBy: { createdAt: "desc" },
          take: 20,
          include: { approvedByUser: { select: { id: true, name: true, email: true } } },
        },
        evidenceArtifacts: {
          orderBy: { createdAt: "desc" },
          take: 20,
          include: { uploadedByUser: { select: { id: true, name: true, email: true } } },
        },
        governanceIncidents: {
          orderBy: { openedAt: "desc" },
          take: 20,
          include: { openedByUser: { select: { id: true, name: true, email: true } } },
        },
        complianceMappings: true,
      },
    });

    if (!system) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json(system);
  });
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withRole(["ADMIN", "COMPLIANCE_OFFICER"], async (session) => {
    const { id } = await params;
    const body = await req.json();
    const parsed = updateAISystemSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const existing = await prisma.aISystem.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    if (parsed.data.status === "APPROVED" && existing.status !== "APPROVED") {
      return NextResponse.json(
        {
          error:
            "Approved status must be recorded through the approval workflow after governance review.",
        },
        { status: 400 }
      );
    }

    const nextReviewDate = parsed.data.nextReviewDate
      ? new Date(parsed.data.nextReviewDate)
      : parsed.data.reviewIntervalDays
        ? new Date(Date.now() + parsed.data.reviewIntervalDays * 24 * 60 * 60 * 1000)
        : undefined;

    const driftFields = [
      "vendor",
      "modelType",
      "dataSensitivity",
      "riskLevel",
      "department",
      "useCase",
      "dataInputs",
      "dataOutputs",
    ] as const;
    const driftChanges = driftFields
      .map((field) => ({
        field,
        before: existing[field],
        after: parsed.data[field],
      }))
      .filter((change) => change.after !== undefined && change.before !== change.after);

    const system = await prisma.aISystem.update({
      where: { id },
      data: {
        ...parsed.data,
        ...(nextReviewDate ? { nextReviewDate } : {}),
      },
      include: {
        owner: { select: { id: true, name: true, email: true } },
      },
    });

    await createAuditLog({
      userId: session.user.userId,
      action: "UPDATE",
      entityType: "AISystem",
      entityId: system.id,
      aiSystemId: system.id,
      changes: JSON.parse(JSON.stringify({ before: existing, after: system })),
    });

    if (
      driftChanges.length > 0 &&
      (existing.status === "APPROVED" || existing.status === "DEPLOYED")
    ) {
      await prisma.alert.create({
        data: {
          title: `Governance drift detected: ${existing.name}`,
          description: `Detected changes to ${driftChanges.map((change) => change.field).join(", ")} on a governed system.`,
          severity:
            driftChanges.some((change) => change.field === "dataSensitivity" || change.field === "riskLevel")
              ? "HIGH"
              : "MEDIUM",
          source: "system_drift",
          aiSystemId: existing.id,
        },
      });
    }

    return NextResponse.json(system);
  });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withRole(["ADMIN"], async (session) => {
    const { id } = await params;
    const existing = await prisma.aISystem.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const system = await prisma.aISystem.update({
      where: { id },
      data: { status: "RETIRED" },
    });

    await createAuditLog({
      userId: session.user.userId,
      action: "DELETE",
      entityType: "AISystem",
      entityId: system.id,
      aiSystemId: system.id,
    });

    return NextResponse.json({ success: true });
  });
}
