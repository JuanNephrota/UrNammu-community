import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withAuth, withRole } from "@/lib/auth-guard";
import { z } from "zod";

const createUsageSchema = z.object({
  provider: z.string().min(1),
  model: z.string().optional(),
  department: z.string().optional(),
  promptTokens: z.number().int().min(0).default(0),
  completionTokens: z.number().int().min(0).default(0),
  totalTokens: z.number().int().min(0).default(0),
  cost: z.number().min(0).default(0),
  promptMetadata: z.any().optional(),
  flagged: z.boolean().default(false),
  flagReason: z.string().optional(),
});

export async function GET(req: NextRequest) {
  return withAuth(async () => {
    const url = new URL(req.url);
    const provider = url.searchParams.get("provider");
    const department = url.searchParams.get("department");
    const model = url.searchParams.get("model");
    const flagged = url.searchParams.get("flagged");
    const take = Math.min(Math.max(parseInt(url.searchParams.get("take") ?? "50", 10) || 50, 1), 200);
    const skip = Math.max(parseInt(url.searchParams.get("skip") ?? "0", 10) || 0, 0);

    const where: Record<string, unknown> = {};
    if (provider) where.provider = provider;
    if (department) where.department = department;
    if (model) where.model = { contains: model, mode: "insensitive" };
    if (flagged === "true") where.flagged = true;

    const total = await prisma.aPIUsageLog.count({ where });
    const logs = await prisma.aPIUsageLog.findMany({
      where,
      skip,
      take,
      orderBy: { createdAt: "desc" },
      include: { user: { select: { name: true, email: true } } },
    });
    return NextResponse.json(logs, {
      headers: {
        "X-Total-Count": String(total),
        "X-Page-Size": String(take),
        "X-Page-Offset": String(skip),
      },
    });
  });
}

export async function POST(req: NextRequest) {
  // This endpoint accepts logs from external systems — requires at least COMPLIANCE_OFFICER
  return withRole(["ADMIN", "COMPLIANCE_OFFICER"], async (session) => {
    const body = await req.json();

    // Support batch inserts
    const entries = Array.isArray(body) ? body : [body];
    const results = [];

    for (const entry of entries) {
      const parsed = createUsageSchema.safeParse(entry);
      if (!parsed.success) continue;

      const log = await prisma.aPIUsageLog.create({
        data: {
          ...parsed.data,
          userId: session.user.userId,
        },
      });
      results.push(log);
    }

    return NextResponse.json(results, { status: 201 });
  });
}
