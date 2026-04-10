import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withAuth } from "@/lib/auth-guard";

export async function GET(req: NextRequest) {
  return withAuth(async () => {
    const url = new URL(req.url);
    const status = url.searchParams.get("status");
    const severity = url.searchParams.get("severity");

    const where: Record<string, unknown> = {};
    if (status) where.status = status;
    if (severity) where.severity = severity;

    const alerts = await prisma.alert.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    return NextResponse.json(alerts);
  });
}
