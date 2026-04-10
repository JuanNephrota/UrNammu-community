import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withAuth, withRole } from "@/lib/auth-guard";
import { createPolicySchema } from "@/lib/validations/policy";
import { createAuditLog } from "@/lib/audit";

export async function GET() {
  return withAuth(async () => {
    const policies = await prisma.policy.findMany({
      orderBy: { createdAt: "desc" },
      include: { _count: { select: { assignments: true } } },
    });
    return NextResponse.json(policies);
  });
}

export async function POST(req: NextRequest) {
  return withRole(["ADMIN", "COMPLIANCE_OFFICER"], async (session) => {
    const body = await req.json();
    const parsed = createPolicySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Validation failed", details: parsed.error.flatten() }, { status: 400 });
    }

    const policy = await prisma.policy.create({ data: parsed.data });

    await createAuditLog({
      userId: session.user.userId,
      action: "CREATE",
      entityType: "Policy",
      entityId: policy.id,
    });

    return NextResponse.json(policy, { status: 201 });
  });
}
