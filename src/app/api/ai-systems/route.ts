import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withAuth, withRole } from "@/lib/auth-guard";
import { createAISystemSchema } from "@/lib/validations/ai-system";
import { createAuditLog } from "@/lib/audit";

class LinkedDiscoveryNotFoundError extends Error {
  constructor(public readonly discoveredToolId: string) {
    super(`Discovered tool ${discoveredToolId} not found`);
    this.name = "LinkedDiscoveryNotFoundError";
  }
}

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

    let system;
    try {
      system = await prisma.$transaction(async (tx) => {
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
        // Verify the discovered tool exists before updating, so a bad id
        // surfaces as a 400 rather than silently committing the AI system
        // without linking it. Errors from the update itself (FK violations,
        // etc.) abort the outer transaction — no `.catch` swallowing here.
        const discovered = await tx.discoveredAITool.findUnique({
          where: { id: discoveredToolId },
          select: { id: true },
        });
        if (!discovered) {
          throw new LinkedDiscoveryNotFoundError(discoveredToolId);
        }
        await tx.discoveredAITool.update({
          where: { id: discoveredToolId },
          data: {
            status: "REGISTERED",
            linkedSystemId: created.id,
          },
        });
      }

      // Suppress any unlinked shadow-AI discoveries that match this newly
      // governed system (case-insensitive match on toolName, narrowed by
      // vendor when available). This keeps previously-discovered tools from
      // lingering in the shadow-AI queue once the org decides to govern them.
      //
      // Values below are bound from the row just created by Prisma and are
      // guaranteed strings (validated by `createAISystemSchema` before insert
      // and typed as `string` / `string | null` on read). We build the where
      // clause explicitly — no spread, no dynamic keys — to keep the scanner
      // happy that this cannot smuggle Prisma operators from user input.
      const systemName: string = String(created.name);
      const systemVendor: string | null =
        typeof created.vendor === "string" ? created.vendor : null;
      if (systemVendor) {
        await tx.discoveredAITool.updateMany({
          where: {
            linkedSystemId: null,
            toolName: { equals: systemName, mode: "insensitive" },
            vendor: { equals: systemVendor, mode: "insensitive" },
          },
          data: { status: "REGISTERED", linkedSystemId: created.id },
        });
      } else {
        await tx.discoveredAITool.updateMany({
          where: {
            linkedSystemId: null,
            toolName: { equals: systemName, mode: "insensitive" },
          },
          data: { status: "REGISTERED", linkedSystemId: created.id },
        });
      }

      return created;
      });
    } catch (err) {
      if (err instanceof LinkedDiscoveryNotFoundError) {
        return NextResponse.json(
          {
            error: "Linked discovered tool was not found",
            discoveredToolId: err.discoveredToolId,
          },
          { status: 400 }
        );
      }
      throw err;
    }

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
