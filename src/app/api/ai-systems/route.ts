import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withAuth, withRole } from "@/lib/auth-guard";
import { createAISystemSchema } from "@/lib/validations/ai-system";
import { createAuditLog } from "@/lib/audit";

export async function GET(req: NextRequest) {
  return withAuth(async () => {
    const take = Math.min(Math.max(Number.parseInt(req.nextUrl.searchParams.get("take") ?? "50", 10) || 50, 1), 100);
    const skip = Math.max(Number.parseInt(req.nextUrl.searchParams.get("skip") ?? "0", 10) || 0, 0);
    const department = req.nextUrl.searchParams.get("department");
    const status = req.nextUrl.searchParams.get("status");
    const search = req.nextUrl.searchParams.get("search");

    const where = {
      ...(department ? { department } : {}),
      ...(status ? { status: status as never } : {}),
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: "insensitive" as const } },
              { vendor: { contains: search, mode: "insensitive" as const } },
              { department: { contains: search, mode: "insensitive" as const } },
            ],
          }
        : {}),
    };

    const systems = await prisma.aISystem.findMany({
      where,
      skip,
      take,
      orderBy: { createdAt: "desc" },
      include: {
        owner: { select: { id: true, name: true, email: true } },
        _count: {
          select: {
            agents: true,
            riskAssessments: true,
            policyAssignments: true,
          },
        },
      },
    });
    const total = await prisma.aISystem.count({ where });
    return NextResponse.json(systems, {
      headers: {
        "X-Total-Count": String(total),
        "X-Page-Size": String(take),
        "X-Page-Offset": String(skip),
      },
    });
  });
}

export async function POST(req: NextRequest) {
  return withRole(["ADMIN", "COMPLIANCE_OFFICER"], async (session) => {
    const body = await req.json();
    const { discoveredToolId, ...systemInput } = body as Record<string, unknown>;
    const parsed = createAISystemSchema.safeParse(systemInput);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    if (parsed.data.status === "APPROVED") {
      return NextResponse.json(
        {
          error:
            "New systems cannot be created directly as approved. Submit them for review instead.",
        },
        { status: 400 }
      );
    }

    const nextReviewDate = parsed.data.nextReviewDate
      ? new Date(parsed.data.nextReviewDate)
      : new Date(Date.now() + parsed.data.reviewIntervalDays * 24 * 60 * 60 * 1000);

    const system = await prisma.$transaction(async (tx) => {
      const created = await tx.aISystem.create({
        data: {
          ...parsed.data,
          nextReviewDate,
          ownerId: session.user.userId,
        },
        include: {
          owner: { select: { id: true, name: true, email: true } },
        },
      });

      if (typeof discoveredToolId === "string" && discoveredToolId.trim()) {
        await tx.discoveredAITool.update({
          where: { id: discoveredToolId },
          data: {
            status: "REGISTERED",
            linkedSystemId: created.id,
          },
        }).catch(() => null);
      }

      return created;
    });

    await createAuditLog({
      userId: session.user.userId,
      action: "CREATE",
      entityType: "AISystem",
      entityId: system.id,
      aiSystemId: system.id,
    });

    return NextResponse.json(system, { status: 201 });
  });
}
