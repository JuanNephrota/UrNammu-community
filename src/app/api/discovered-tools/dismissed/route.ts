import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withAuth } from "@/lib/auth-guard";

export async function GET() {
  return withAuth(async () => {
    const dismissed = await prisma.dismissedCandidate.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        dismissedByUser: { select: { name: true, email: true } },
      },
    });
    return NextResponse.json(dismissed);
  });
}
