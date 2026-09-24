import { NextRequest, NextResponse } from "next/server";
import { withRole } from "@/lib/auth-guard";
import { prisma } from "@/lib/prisma";
import { createAuditLog } from "@/lib/audit";
import { startVendorAssessmentSchema } from "@/lib/validations/vendor-assessment";

// Starts a vendor questionnaire, or returns the one already in progress so
// two reviewers (or two tabs) don't fork the answers.
export async function POST(req: NextRequest) {
  return withRole(["ADMIN", "COMPLIANCE_OFFICER"], async (session) => {
    const parsed = startVendorAssessmentSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: "Validation failed" }, { status: 400 });
    }

    const profile = await prisma.vendorProfile.findUnique({
      where: { id: parsed.data.vendorProfileId },
      select: { id: true },
    });
    if (!profile) return NextResponse.json({ error: "Vendor not found" }, { status: 404 });

    const inProgress = await prisma.vendorAssessment.findFirst({
      where: { vendorProfileId: profile.id, status: "IN_PROGRESS" },
      orderBy: { createdAt: "desc" },
    });
    if (inProgress) return NextResponse.json(inProgress);

    const assessment = await prisma.vendorAssessment.create({
      data: {
        vendorProfileId: profile.id,
        startedBy: session.user.name ?? session.user.email ?? "Unknown",
      },
    });

    // Starting a questionnaire moves a never-reviewed vendor to "in progress".
    await prisma.vendorProfile.updateMany({
      where: { id: profile.id, securityReviewStatus: "NOT_REVIEWED" },
      data: { securityReviewStatus: "IN_PROGRESS" },
    });

    await createAuditLog({
      userId: session.user.userId,
      action: "CREATE",
      entityType: "VendorAssessment",
      entityId: assessment.id,
    });

    return NextResponse.json(assessment, { status: 201 });
  });
}
