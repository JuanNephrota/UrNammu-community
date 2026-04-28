import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import type { GovernanceReviewStage } from "@prisma/client";
import { withRole } from "@/lib/auth-guard";
import { prisma } from "@/lib/prisma";
import { evaluatePolicyRules, parsePolicyRules } from "@/lib/policy-rules";
import { getApprovalBlockers, isHardBlocker } from "@/lib/approval-blockers";

const approvalSchema = z.object({
  decision: z.enum(["APPROVED", "CHANGES_REQUESTED", "REVOKED"]),
  rationale: z.string().trim().max(5000).optional(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withRole(["ADMIN", "COMPLIANCE_OFFICER"], async (session) => {
    const { id } = await params;
    const body = await req.json();
    const parsed = approvalSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const system = await prisma.aISystem.findUnique({
      where: { id },
      include: {
        riskAssessments: { select: { id: true } },
        policyAssignments: {
          select: {
            id: true,
            complianceStatus: true,
            evidence: true,
            policy: { select: { id: true, name: true, rules: true } },
          },
        },
        governanceReviews: {
          orderBy: { createdAt: "desc" },
          select: { stage: true, approved: true },
        },
        governanceExceptions: {
          where: { status: "ACTIVE" },
          select: { id: true, expiresAt: true },
        },
      },
    });

    if (!system) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const requiredStages = [
      ...(system.requireOwnerApproval ? ["OWNER"] : []),
      ...(system.requireSecurityApproval ? ["SECURITY"] : []),
      ...(system.requireLegalApproval ? ["LEGAL"] : []),
      ...(system.requireComplianceApproval ? ["COMPLIANCE"] : []),
    ];
    const latestStageDecisions = new Map<string, boolean>();
    for (const review of system.governanceReviews) {
      if (!latestStageDecisions.has(review.stage)) {
        latestStageDecisions.set(review.stage, review.approved);
      }
    }
    const activeExceptionCount = system.governanceExceptions.filter(
      (exception) => new Date(exception.expiresAt).getTime() >= Date.now()
    ).length;
    const ruleEvaluations = system.policyAssignments.map((assignment) => ({
      assignment,
      evaluation: evaluatePolicyRules(parsePolicyRules(assignment.policy.rules), {
        vendor: system.vendor,
        department: system.department,
        status: system.status,
        modelType: system.modelType,
        dataSensitivity: system.dataSensitivity,
        reviewIntervalDays: system.reviewIntervalDays,
        riskLevel: system.riskLevel,
        requireOwnerApproval: system.requireOwnerApproval,
        requireSecurityApproval: system.requireSecurityApproval,
        requireLegalApproval: system.requireLegalApproval,
        requireComplianceApproval: system.requireComplianceApproval,
        activeExceptionCount,
      }),
    }));

    const approvedStages = new Set<GovernanceReviewStage>();
    for (const [stage, approved] of latestStageDecisions.entries()) {
      if (approved) approvedStages.add(stage as GovernanceReviewStage);
    }

    const blockers = getApprovalBlockers({
      systemId: system.id,
      riskAssessmentsCount: system.riskAssessments.length,
      policyAssignments: ruleEvaluations.map(({ assignment, evaluation }) => ({
        id: assignment.id,
        complianceStatus: assignment.complianceStatus,
        evidenceProvided: Boolean(assignment.evidence && assignment.evidence.trim()),
        policy: { id: assignment.policy.id, name: assignment.policy.name },
        blockingRuleViolations: evaluation.blockingViolations,
      })),
      requiredStages: requiredStages as GovernanceReviewStage[],
      approvedStages,
      nextReviewDate: system.nextReviewDate,
    });

    const hardBlockers = blockers.filter(isHardBlocker);

    if (parsed.data.decision === "APPROVED" && hardBlockers.length > 0) {
      return NextResponse.json(
        {
          error:
            "This system is not yet ready for approval. Resolve the items below before approving.",
          blockers: hardBlockers.map(({ message, category, href }) => ({
            message,
            category,
            href,
          })),
        },
        { status: 400 }
      );
    }

    const nextStatus =
      parsed.data.decision === "APPROVED" ? "APPROVED" : "UNDER_REVIEW";

    const result = await prisma.$transaction(async (tx) => {
      const approval = await tx.systemApproval.create({
        data: {
          aiSystemId: system.id,
          decidedByUserId: session.user.userId,
          decision: parsed.data.decision,
          rationale: parsed.data.rationale,
        },
        include: {
          decidedByUser: { select: { id: true, name: true, email: true } },
        },
      });

      const updatedSystem = await tx.aISystem.update({
        where: { id: system.id },
        data: { status: nextStatus },
      });

      await tx.auditLog.create({
        data: {
          userId: session.user.userId,
          action: parsed.data.decision,
          entityType: "SystemApproval",
          entityId: approval.id,
          aiSystemId: system.id,
          changes: {
            systemStatus: nextStatus,
            rationale: parsed.data.rationale ?? null,
          },
        },
      });

      return { approval, updatedSystem };
    });
    return NextResponse.json(result, { status: 201 });
  });
}
