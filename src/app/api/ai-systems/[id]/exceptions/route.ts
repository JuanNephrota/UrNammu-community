import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withRole } from "@/lib/auth-guard";
import { prisma } from "@/lib/prisma";

const exceptionSchema = z.object({
  title: z.string().trim().min(1).max(200),
  rationale: z.string().trim().min(1).max(5000),
  expiresAt: z.string().min(1),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withRole(["ADMIN", "COMPLIANCE_OFFICER"], async (session) => {
    const { id } = await params;
    const body = await req.json();
    const parsed = exceptionSchema.safeParse(body);

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

    const expiresAt = new Date(parsed.data.expiresAt);
    if (Number.isNaN(expiresAt.getTime())) {
      return NextResponse.json({ error: "Invalid exception expiry date" }, { status: 400 });
    }

    const exception = await prisma.$transaction(async (tx) => {
      const created = await tx.governanceException.create({
        data: {
          aiSystemId: id,
          approvedByUserId: session.user.userId,
          title: parsed.data.title,
          rationale: parsed.data.rationale,
          expiresAt,
        },
        include: {
          approvedByUser: { select: { name: true, email: true } },
        },
      });

      await tx.auditLog.create({
        data: {
          userId: session.user.userId,
          action: "CREATE",
          entityType: "GovernanceException",
          entityId: created.id,
          aiSystemId: id,
          changes: {
            title: parsed.data.title,
            expiresAt: expiresAt.toISOString(),
          },
        },
      });

      return created;
    });

    return NextResponse.json(exception, { status: 201 });
  });
}
