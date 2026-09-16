import { NextRequest, NextResponse } from "next/server";
import { runGovernanceAutomationJob } from "@/lib/background-jobs";
import { unauthorizedCronResponse } from "@/lib/cron-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// GET /api/cron/governance-automation — invoked hourly by Vercel Cron.
// Raises and resolves review-renewal, exception-renewal, and ownership
// escalation alerts from the notice windows in Settings → Provider Admin APIs.
export async function GET(req: NextRequest) {
  const unauthorized = unauthorizedCronResponse(req);
  if (unauthorized) return unauthorized;

  const result = await runGovernanceAutomationJob();
  return NextResponse.json(result);
}
