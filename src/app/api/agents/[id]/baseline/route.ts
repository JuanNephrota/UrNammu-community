import { NextRequest, NextResponse } from "next/server";
import { withRole } from "@/lib/auth-guard";
import { createAuditLog } from "@/lib/audit";
import { recomputeAgentBaseline } from "@/lib/agent-baseline-data";

/**
 * POST /api/agents/[id]/baseline — recompute this agent's behavioural
 * baseline now and re-evaluate the last 24 hours against it. Use after a
 * known, deliberate change in how the agent runs so the next drift alerts
 * compare against the new normal.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withRole(["ADMIN", "COMPLIANCE_OFFICER"], async (session) => {
    const { id } = await params;
    const result = await recomputeAgentBaseline(id);
    if (!result) return NextResponse.json({ error: "Not found" }, { status: 404 });

    await createAuditLog({
      userId: session.user.userId,
      action: "RECOMPUTE_BASELINE",
      entityType: "AIAgent",
      entityId: id,
      agentId: id,
      changes: { activeDays: result.stats.activeDays, findings: result.findings.length },
    });

    return NextResponse.json({ stats: result.stats, findings: result.findings });
  });
}
