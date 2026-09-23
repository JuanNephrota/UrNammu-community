import { NextRequest, NextResponse } from "next/server";
import { runProxyAgentDetection } from "@/lib/proxy-agent-detection";
import { unauthorizedCronResponse } from "@/lib/cron-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

// GET /api/cron/agent-discovery — invoked hourly by Vercel Cron. Scores the
// last 7 days of unattributed proxy traffic per caller and upserts agent-like
// callers into the Discovered Agents queue. Failures report ok: false (207)
// rather than a 500 so they show in the cron log.
export async function GET(req: NextRequest) {
  const unauthorized = unauthorizedCronResponse(req);
  if (unauthorized) return unauthorized;

  const result = await runProxyAgentDetection();
  return NextResponse.json(result, { status: result.ok ? 200 : 207 });
}
