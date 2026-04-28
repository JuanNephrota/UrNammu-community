import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withRole } from "@/lib/auth-guard";
import { prisma } from "@/lib/prisma";

const governanceReviewSchema = z.object({
  stage: z.enum(["OWNER", "SECURITY", "LEGAL", "COMPLIANCE"]),
  approved: z.boolean(),
  rationale: z.string().trim().max(5000).optional(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withRole(["ADMIN", "COMPLIANCE_OFFICER"], async (session) => {
    const { id } = await params;
    const body = await req.json();
    const parsed = governanceReviewSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const system = await prisma.aISystem.findUnique({ where: { id } });
    if (!system) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const review = await prisma.$transaction(async (tx) => {
      const created = await tx.governanceReview.create({
        data: {
          aiSystemId: id,
          decidedByUserId: session.user.userId,
          stage: parsed.data.stage,
          approved: parsed.data.approved,
          rationale: parsed.data.rationale,
        },
        include: {
          decidedByUser: { select: { name: true, email: true } },
        },
      });

      await tx.auditLog.create({
        data: {
          userId: session.user.userId,
          action: parsed.data.approved ? "APPROVED" : "CHANGES_REQUESTED",
          entityType: "GovernanceReview",
          entityId: created.id,
          aiSystemId: id,
          changes: {
            stage: parsed.data.stage,
            approved: parsed.data.approved,
            rationale: parsed.data.rationale ?? null,
          },
        },
      });

      return created;
    });

    return NextResponse.json(review, { status: 201 });
  });
}
