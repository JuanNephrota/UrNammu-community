import { NextRequest, NextResponse } from "next/server";
import { withRole } from "@/lib/auth-guard";
import { prisma } from "@/lib/prisma";
import { createAuditLog } from "@/lib/audit";
import { completeVendorAssessmentSchema } from "@/lib/validations/vendor-assessment";
import { parseVendorAnswers, scoreVendorQuestionnaire } from "@/lib/vendor-questionnaire";

// Scores the questionnaire, locks it, and records the reviewer's decision as
// the vendor's security review status.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withRole(["ADMIN", "COMPLIANCE_OFFICER"], async (session) => {
    const { id } = await params;
    const parsed = completeVendorAssessmentSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: "Choose a decision" }, { status: 400 });
    }

    const assessment = await prisma.vendorAssessment.findUnique({ where: { id } });
    if (!assessment) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (assessment.status !== "IN_PROGRESS") {
      return NextResponse.json({ error: "Already completed" }, { status: 409 });
    }

    const result = scoreVendorQuestionnaire(parseVendorAnswers(assessment.answers));
    const reviewer = session.user.name ?? session.user.email ?? "Unknown";

    const [completed] = await prisma.$transaction([
      prisma.vendorAssessment.update({
        where: { id },
        data: {
          status: "COMPLETED",
          score: result.score,
          tier: result.tier,
          decision: parsed.data.decision,
          decisionNotes: parsed.data.decisionNotes || null,
          completedBy: reviewer,
          completedAt: new Date(),
        },
      }),
      prisma.vendorProfile.update({
        where: { id: assessment.vendorProfileId },
        data: { securityReviewStatus: parsed.data.decision },
      }),
    ]);

    await createAuditLog({
      userId: session.user.userId,
      action: "COMPLETE",
      entityType: "VendorAssessment",
      entityId: id,
      changes: { score: result.score, tier: result.tier, decision: parsed.data.decision },
    });

    return NextResponse.json(completed);
  });
}
