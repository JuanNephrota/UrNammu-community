import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withAuth, withRole } from "@/lib/auth-guard";
import { createRiskAssessmentSchema } from "@/lib/validations/risk-assessment";
import { createAuditLog } from "@/lib/audit";
import type { Prisma } from "@prisma/client";
import { generateAssessmentIssues } from "@/lib/risk-issues";

export async function GET() {
  return withAuth(async () => {
    const assessments = await prisma.riskAssessment.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        aiSystem: { select: { id: true, name: true, riskLevel: true } },
        issues: true,
      },
    });
    return NextResponse.json(assessments);
  });
}

export async function POST(req: NextRequest) {
  return withRole(["ADMIN", "COMPLIANCE_OFFICER"], async (session) => {
    const body = await req.json();
    const parsed = createRiskAssessmentSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { biasScore, securityScore, privacyScore, fairnessScore, performanceScore, transparencyScore } = parsed.data;
    const overallScore = (biasScore + securityScore + privacyScore + fairnessScore + performanceScore + transparencyScore) / 6;
    const derivedIssues =
      parsed.data.issues && parsed.data.issues.length > 0
        ? parsed.data.issues
        : generateAssessmentIssues({
            scores: {
              biasScore,
              securityScore,
              privacyScore,
              fairnessScore,
              performanceScore,
              transparencyScore,
            },
            justifications: parsed.data.justifications,
            notes: parsed.data.notes,
          });

    const assessment = await prisma.riskAssessment.create({
      data: {
        ...parsed.data,
        contextualAnswers: parsed.data.contextualAnswers as Prisma.InputJsonValue | undefined,
        overallScore: Math.round(overallScore * 10) / 10,
        assessedBy: session.user.name ?? session.user.email ?? "Unknown",
        issues: derivedIssues.length
          ? {
              create: derivedIssues.map((issue) => ({
                category: issue.category,
                title: issue.title,
                detail: issue.detail,
                remediation: issue.remediation ?? null,
                severity: issue.severity,
                status: issue.status ?? "OPEN",
                source: issue.source ?? "assessment",
              })),
            }
          : undefined,
      },
      include: {
        issues: true,
      },
    });

    // Auto-update system risk level based on overall score
    let riskLevel: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "MINIMAL" = "MINIMAL";
    if (overallScore >= 80) riskLevel = "CRITICAL";
    else if (overallScore >= 60) riskLevel = "HIGH";
    else if (overallScore >= 40) riskLevel = "MEDIUM";
    else if (overallScore >= 20) riskLevel = "LOW";

    await prisma.aISystem.update({
      where: { id: parsed.data.aiSystemId },
      data: { riskLevel },
    });

    // Create alert if high risk
    if (overallScore >= 60) {
      await prisma.alert.create({
        data: {
          title: `High risk score detected`,
          description: `AI system scored ${overallScore.toFixed(1)} in risk assessment`,
          severity: overallScore >= 80 ? "CRITICAL" : "HIGH",
          source: "risk_center",
        },
      });
    }

    await createAuditLog({
      userId: session.user.userId,
      action: "CREATE",
      entityType: "RiskAssessment",
      entityId: assessment.id,
      aiSystemId: parsed.data.aiSystemId,
      changes: {
        issueCount: assessment.issues.length,
      },
    });

    return NextResponse.json(assessment, { status: 201 });
  });
}
