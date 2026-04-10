import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withAuth, withRole } from "@/lib/auth-guard";
import { updatePolicySchema, assignPolicySchema } from "@/lib/validations/policy";
import { createAuditLog } from "@/lib/audit";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withAuth(async () => {
    const { id } = await params;
    const policy = await prisma.policy.findUnique({
      where: { id },
      include: {
        assignments: {
          include: { aiSystem: { select: { id: true, name: true } } },
        },
      },
    });
    if (!policy) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(policy);
  });
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withRole(["ADMIN", "COMPLIANCE_OFFICER"], async (session) => {
    const { id } = await params;
    const body = await req.json();

    // Check if this is a policy assignment
    if (body.policyId && body.aiSystemId) {
      const parsed = assignPolicySchema.safeParse(body);
      if (!parsed.success) {
        return NextResponse.json({ error: "Validation failed" }, { status: 400 });
      }

      const assignment = await prisma.policyAssignment.upsert({
        where: {
          policyId_aiSystemId: {
            policyId: parsed.data.policyId,
            aiSystemId: parsed.data.aiSystemId,
          },
        },
        update: {
          complianceStatus: parsed.data.complianceStatus,
          evidence: parsed.data.evidence,
          assessedAt: new Date(),
          nextReviewDate: parsed.data.nextReviewDate ? new Date(parsed.data.nextReviewDate) : undefined,
        },
        create: {
          policyId: parsed.data.policyId,
          aiSystemId: parsed.data.aiSystemId,
          complianceStatus: parsed.data.complianceStatus,
          evidence: parsed.data.evidence,
          assessedAt: new Date(),
          nextReviewDate: parsed.data.nextReviewDate ? new Date(parsed.data.nextReviewDate) : undefined,
        },
      });

      return NextResponse.json(assignment);
    }

    // Regular policy update
    const parsed = updatePolicySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Validation failed" }, { status: 400 });
    }

    const policy = await prisma.policy.update({
      where: { id },
      data: parsed.data,
    });

    await createAuditLog({
      userId: session.user.userId,
      action: "UPDATE",
      entityType: "Policy",
      entityId: policy.id,
    });

    return NextResponse.json(policy);
  });
}
