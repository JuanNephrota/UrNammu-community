import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withAuth } from "@/lib/auth-guard";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withAuth(async () => {
    const { id } = await params;
    const alert = await prisma.alert.findUnique({ where: { id } });
    if (!alert) {
      return NextResponse.json({ error: "Alert not found" }, { status: 404 });
    }

    // Find flagged usage logs within ±5 minutes of the alert
    const windowMs = 5 * 60 * 1000;
    const from = new Date(alert.createdAt.getTime() - windowMs);
    const to = new Date(alert.createdAt.getTime() + windowMs);

    const logs = await prisma.aPIUsageLog.findMany({
      where: {
        flagged: true,
        createdAt: { gte: from, lte: to },
      },
      take: 20,
      orderBy: { createdAt: "desc" },
      include: {
        user: { select: { name: true, email: true } },
      },
    });

    return NextResponse.json(logs);
  });
}
