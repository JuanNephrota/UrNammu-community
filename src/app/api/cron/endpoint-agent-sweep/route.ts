import { NextRequest, NextResponse } from "next/server";
import { markStaleDevices } from "@/lib/endpoint-agent";
import { unauthorizedCronResponse } from "@/lib/cron-auth";
import { logger } from "@/lib/observability";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Marks endpoint agents that have stopped reporting as STALE.
 *
 * This exists because the failure mode it catches is the dangerous one: a fleet
 * where agents quietly die reads in the console as "no AI activity" rather than
 * "no data", and a governance platform that confidently reports nothing is
 * worse than one that reports nothing at all. Devices past the staleness window
 * get flagged so coverage gaps are visible instead of silent.
 *
 * A stale device is not revoked — its token still works, and a laptop that
 * comes back from a long holiday flips itself back to ACTIVE on its next
 * accepted report.
 */
export async function GET(req: NextRequest) {
  const unauthorized = unauthorizedCronResponse(req);
  if (unauthorized) return unauthorized;

  try {
    const marked = await markStaleDevices();
    return NextResponse.json({ ok: true, markedStale: marked });
  } catch (error) {
    logger.error("endpoint_agent.sweep.failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "Sweep failed" }, { status: 500 });
  }
}
