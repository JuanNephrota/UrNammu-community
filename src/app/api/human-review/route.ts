import { NextRequest, NextResponse } from "next/server";
import type { HumanReviewStatus } from "@prisma/client";
import { withAuth } from "@/lib/auth-guard";
import { listHumanReviews } from "@/lib/human-review-queue";

const STATUSES: HumanReviewStatus[] = ["PENDING", "APPROVED", "REJECTED", "EXPIRED", "CONSUMED"];

/** GET /api/human-review?status=PENDING,APPROVED&agentId=… — the review queue. */
export async function GET(req: NextRequest) {
  return withAuth(async () => {
    const params = req.nextUrl.searchParams;
    const status = (params.get("status") ?? "PENDING")
      .split(",")
      .map((s) => s.trim().toUpperCase())
      .filter((s): s is HumanReviewStatus => (STATUSES as string[]).includes(s));
    const agentId = params.get("agentId") ?? undefined;
    const rows = await listHumanReviews({ status: status.length ? status : undefined, agentId, take: 200 });
    return NextResponse.json(rows);
  });
}
