import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withAuth } from "@/lib/auth-guard";

const VALID_STATUSES = ["OPEN", "ACKNOWLEDGED", "RESOLVED", "DISMISSED"] as const;
const VALID_SEVERITIES = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"] as const;

export async function GET(req: NextRequest) {
  return withAuth(async () => {
    const url = new URL(req.url);
    const status = url.searchParams.get("status");
    const severity = url.searchParams.get("severity");

    if (status && !(VALID_STATUSES as readonly string[]).includes(status)) {
      return NextResponse.json({ error: `Invalid status. Must be one of: ${VALID_STATUSES.join(", ")}` }, { status: 400 });
    }
    if (severity && !(VALID_SEVERITIES as readonly string[]).includes(severity)) {
      return NextResponse.json({ error: `Invalid severity. Must be one of: ${VALID_SEVERITIES.join(", ")}` }, { status: 400 });
    }

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
