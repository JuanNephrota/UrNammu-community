import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { withAuth, withRole } from "@/lib/auth-guard";
import { updatePolicySchema, assignPolicySchema } from "@/lib/validations/policy";
import { createAuditLog } from "@/lib/audit";
import { parsePolicyRules } from "@/lib/policy-rules";
import { syncAssignment, syncAssignmentsForPolicy } from "@/lib/policy-sync";

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

      // Deterministic rule evaluation may override the user-supplied
      // complianceStatus if rules exist and are violated. Rule eval is the
      // source of truth for fields the policy formally constrains.
      await syncAssignment(assignment.id).catch((err) => {
        console.error("syncAssignment failed:", err);
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
      data: {
        ...parsed.data,
        ...(parsed.data.rules !== undefined
          ? { rules: parsed.data.rules ? (parsePolicyRules(parsed.data.rules) as unknown as Prisma.InputJsonValue) : Prisma.JsonNull }
          : {}),
      },
    });

    await createAuditLog({
      userId: session.user.userId,
      action: "UPDATE",
      entityType: "Policy",
      entityId: policy.id,
    });

    // Rules may have changed — re-evaluate every assignment of this policy.
    if (parsed.data.rules !== undefined) {
      await syncAssignmentsForPolicy(policy.id).catch((err) => {
        console.error("syncAssignmentsForPolicy failed:", err);
      });
    }

    return NextResponse.json(policy);
  });
}
