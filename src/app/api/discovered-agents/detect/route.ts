import { NextResponse } from "next/server";
import { withRole } from "@/lib/auth-guard";
import { createAuditLog } from "@/lib/audit";
import { runProxyAgentDetection } from "@/lib/proxy-agent-detection";

export const maxDuration = 120;

// POST /api/discovered-agents/detect — run proxy agent detection now instead
// of waiting for the hourly cron.
export async function POST() {
  return withRole(["ADMIN", "COMPLIANCE_OFFICER"], async (session) => {
    const result = await runProxyAgentDetection();
    await createAuditLog({
      userId: session.user.userId,
      action: "RUN_AGENT_DETECTION",
      entityType: "DiscoveredAgent",
      entityId: "proxy_traffic",
      changes: { created: result.created, updated: result.updated, flagged: result.flagged, ok: result.ok },
    });
    return NextResponse.json(result, { status: result.ok ? 200 : 207 });
  });
}
