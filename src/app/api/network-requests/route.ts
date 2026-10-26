import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withAuth } from "@/lib/auth-guard";

const ACTIONS = new Set(["forwarded", "blocked", "monitored", "error"]);

/**
 * Recent rows from the network proxy request log, newest first.
 * `?action=blocked|monitored|forwarded|error`, `?host=`, `?limit=` (≤ 200).
 */
export async function GET(req: NextRequest) {
  return withAuth(async () => {
    const params = new URL(req.url).searchParams;
    const action = params.get("action");
    const host = params.get("host")?.trim().toLowerCase();
    const limit = Math.min(Math.max(Number(params.get("limit") ?? 50) || 50, 1), 200);

    const rows = await prisma.networkRequestLog.findMany({
      where: {
        ...(action && ACTIONS.has(action) ? { action } : {}),
        ...(host ? { host: { contains: host } } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: limit,
    });
    return NextResponse.json(rows);
  });
}
