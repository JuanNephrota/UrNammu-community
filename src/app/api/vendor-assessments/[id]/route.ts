import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { withRole } from "@/lib/auth-guard";
import { prisma } from "@/lib/prisma";
import { createAuditLog } from "@/lib/audit";
import { saveVendorAssessmentAnswersSchema } from "@/lib/validations/vendor-assessment";
import { parseVendorAnswers } from "@/lib/vendor-questionnaire";

// Saves one questionnaire section. Answers are merged into what's stored.
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withRole(["ADMIN", "COMPLIANCE_OFFICER"], async (session) => {
    const { id } = await params;
    const parsed = saveVendorAssessmentAnswersSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const assessment = await prisma.vendorAssessment.findUnique({ where: { id } });
    if (!assessment) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (assessment.status !== "IN_PROGRESS") {
      return NextResponse.json(
        { error: "This questionnaire is already completed. Start a new one to re-assess." },
        { status: 409 }
      );
    }

    // parseVendorAnswers drops unknown question ids.
    const answers = {
      ...parseVendorAnswers(assessment.answers),
      ...parseVendorAnswers(parsed.data.answers),
    };

    const updated = await prisma.vendorAssessment.update({
      where: { id },
      data: { answers: answers as Prisma.InputJsonValue },
    });

    await createAuditLog({
      userId: session.user.userId,
      action: "UPDATE",
      entityType: "VendorAssessment",
      entityId: id,
      changes: { questions: Object.keys(parsed.data.answers) },
    });

    return NextResponse.json(updated);
  });
}
