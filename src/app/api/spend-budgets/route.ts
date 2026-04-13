import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { withAuth, withRole } from "@/lib/auth-guard";
import { prisma } from "@/lib/prisma";
import { createAuditLog } from "@/lib/audit";
import { z } from "zod";

const budgetSchema = z.object({
  id: z.string().optional(),
  scopeType: z.enum(["PROVIDER", "AI_SYSTEM", "DEPARTMENT"]),
  scopeKey: z.string().min(1),
  label: z.string().min(1),
  monthlyBudget: z.number().positive(),
  warningThresholdPct: z.number().int().min(1).max(100).default(80),
});

type SpendBudgetListItem = Prisma.SpendBudgetGetPayload<{
  include: {
    ownerUser: { select: { id: true; name: true; email: true } };
  };
}>;

type SpendBudgetRecord = {
  id: string;
};

type SpendBudgetRouteClient = {
  spendBudget: {
    findMany: (
      args: Prisma.SpendBudgetFindManyArgs
    ) => Promise<SpendBudgetListItem[]>;
    upsert: (args: Prisma.SpendBudgetUpsertArgs) => Promise<SpendBudgetRecord>;
  };
};

export async function GET() {
  return withAuth(async () => {
    const prismaClient = prisma as unknown as SpendBudgetRouteClient;
    const budgets = await prismaClient.spendBudget.findMany({
      orderBy: [{ scopeType: "asc" }, { label: "asc" }],
      include: {
        ownerUser: { select: { id: true, name: true, email: true } },
      },
    });
    return NextResponse.json(budgets);
  });
}

export async function POST(req: NextRequest) {
  return withRole(["ADMIN", "COMPLIANCE_OFFICER"], async (session) => {
    const prismaClient = prisma as unknown as SpendBudgetRouteClient;
    const parsed = budgetSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "Validation failed" }, { status: 400 });
    }

    const budget = await prismaClient.spendBudget.upsert({
      where: {
        scopeType_scopeKey: {
          scopeType: parsed.data.scopeType,
          scopeKey: parsed.data.scopeKey,
        },
      },
      update: {
        label: parsed.data.label,
        monthlyBudget: parsed.data.monthlyBudget,
        warningThresholdPct: parsed.data.warningThresholdPct,
      },
      create: {
        scopeType: parsed.data.scopeType,
        scopeKey: parsed.data.scopeKey,
        label: parsed.data.label,
        monthlyBudget: parsed.data.monthlyBudget,
        warningThresholdPct: parsed.data.warningThresholdPct,
        ownerUserId: session.user.userId,
      },
    });

    await createAuditLog({
      userId: session.user.userId,
      action: "UPSERT",
      entityType: "SpendBudget",
      entityId: budget.id,
      changes: parsed.data,
    });

    return NextResponse.json(budget);
  });
}
