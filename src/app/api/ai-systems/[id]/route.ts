import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withAuth, withRole } from "@/lib/auth-guard";
import { updateAISystemSchema } from "@/lib/validations/ai-system";
import { createAuditLog } from "@/lib/audit";
import { getRiskReassessmentDrift } from "@/lib/risk-center";

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

    const existing = await prisma.aISystem.findUnique({
      where: { id },
      include: {
        _count: {
          select: {
            riskAssessments: true,
          },
        },
      },
    });
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

    const reassessmentDrift = getRiskReassessmentDrift({
      before: existing,
      after: parsed.data,
      hasAssessments: existing._count.riskAssessments > 0,
    });

    if (reassessmentDrift.requiresReassessment) {
      const existingOpenReassessmentAlert = await prisma.alert.findFirst({
        where: {
          aiSystemId: existing.id,
          source: "risk_reassessment",
          status: { in: ["OPEN", "ACKNOWLEDGED"] },
        },
      });

      if (existingOpenReassessmentAlert) {
        await prisma.alert.update({
          where: { id: existingOpenReassessmentAlert.id },
          data: {
            title: reassessmentDrift.title,
            description: reassessmentDrift.description,
            severity: reassessmentDrift.severity,
          },
        });
      } else {
        await prisma.alert.create({
          data: {
            title: reassessmentDrift.title,
            description: reassessmentDrift.description,
            severity: reassessmentDrift.severity,
            source: "risk_reassessment",
            aiSystemId: existing.id,
          },
        });
      }
    }

    return NextResponse.json(system);
  });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withRole(["ADMIN"], async (session) => {
    const { id } = await params;
    const existing = await prisma.aISystem.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const body = await req.json().catch(() => ({}));
    if (body?.confirmationText?.trim() !== existing.name) {
      return NextResponse.json(
        {
          error:
            "Type the exact service name to confirm permanent deletion.",
        },
        { status: 400 }
      );
    }

    await prisma.$transaction(async (tx) => {
      await tx.auditLog.updateMany({
        where: { aiSystemId: existing.id },
        data: { aiSystemId: null },
      });

      await tx.aIAgent.updateMany({
        where: { aiSystemId: existing.id },
        data: { aiSystemId: null },
      });

      await tx.usageBucket.updateMany({
        where: { aiSystemId: existing.id },
        data: { aiSystemId: null },
      });

      await tx.investigation.deleteMany({
        where: {
          OR: [
            { aiSystemId: existing.id },
            { alert: { aiSystemId: existing.id } },
            { governanceIncident: { aiSystemId: existing.id } },
          ],
        },
      });

      await tx.alert.deleteMany({
        where: {
          OR: [
            { aiSystemId: existing.id },
            { governanceIncident: { aiSystemId: existing.id } },
          ],
        },
      });

      await tx.discoveredAITool.updateMany({
        where: { linkedSystemId: existing.id },
        data: { linkedSystemId: null },
      });

      await tx.aISystem.delete({
        where: { id: existing.id },
      });

      await tx.auditLog.create({
        data: {
          userId: session.user.userId,
          action: "DELETE_PERMANENT",
          entityType: "AISystem",
          entityId: existing.id,
          changes: {
            deletedSystem: {
              id: existing.id,
              name: existing.name,
              status: existing.status,
              department: existing.department,
            },
          },
        },
      });
    });

    return NextResponse.json({ success: true });
  });
}
