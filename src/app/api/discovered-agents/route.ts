import { NextRequest, NextResponse } from "next/server";
import type { DiscoveryStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { withAuth } from "@/lib/auth-guard";
import { REVIEW_STATUSES, isAgentDiscoverySource } from "@/lib/agent-discovery";

// GET /api/discovered-agents?status=DISCOVERED&source=proxy_traffic
export async function GET(req: NextRequest) {
  return withAuth(async () => {
    const status = req.nextUrl.searchParams.get("status");
    const source = req.nextUrl.searchParams.get("source");
    const where: Prisma.DiscoveredAgentWhereInput = {};
    if (status) {
      if (!REVIEW_STATUSES.includes(status as DiscoveryStatus)) {
        return NextResponse.json({ error: `Unknown status "${status}"` }, { status: 400 });
      }
      where.status = status as DiscoveryStatus;
    }
    if (source) {
      if (!isAgentDiscoverySource(source)) {
        return NextResponse.json({ error: `Unknown source "${source}"` }, { status: 400 });
      }
      where.source = source;
    }
    const agents = await prisma.discoveredAgent.findMany({
      where,
      orderBy: [{ lastSeenAt: "desc" }, { createdAt: "desc" }],
      take: 500,
      include: { linkedAgent: { select: { id: true, name: true } } },
    });
    return NextResponse.json(agents);
  });
}
