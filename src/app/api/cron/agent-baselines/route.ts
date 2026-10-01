import { NextRequest, NextResponse } from "next/server";
import { runAgentBaselines } from "@/lib/agent-baseline-data";
import { expireHumanReviews } from "@/lib/human-review-queue";
import { unauthorizedCronResponse } from "@/lib/cron-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// GET /api/cron/agent-baselines — daily. Recomputes every attributed agent's
// 28-day behavioural baseline, judges the last 24 hours against it, stores
// the result on AgentBehaviorBaseline and raises agent_behavior_drift alerts.
// Reports ok: false (207) on partial failure so it shows in the cron log.
export async function GET(req: NextRequest) {
  const unauthorized = unauthorizedCronResponse(req);
  if (unauthorized) return unauthorized;

  const result = await runAgentBaselines();
  // Housekeeping for the review queue rides along: stale pending requests and
  // lapsed waivers become EXPIRED.
  const expired = await expireHumanReviews().catch((err) => {
    console.error("expireHumanReviews failed:", err);
    return null;
  });
  return NextResponse.json({ ...result, humanReviews: expired }, { status: result.ok ? 200 : 207 });
}
