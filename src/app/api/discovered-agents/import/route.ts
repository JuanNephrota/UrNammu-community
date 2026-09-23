import { NextResponse } from "next/server";
import { withRole } from "@/lib/auth-guard";
import { createAuditLog } from "@/lib/audit";
import {
  executeAgentPlatformScan,
  isAgentPlatformImportConfigured,
} from "@/lib/agent-platform-imports";

export const runtime = "nodejs";
export const maxDuration = 120;

// POST /api/discovered-agents/import — run the agent platform importers now
// (Anthropic Managed Agents, Microsoft Copilot agents, Salesforce
// Agentforce). Ignores the auto-import schedule; unconfigured platforms are
// skipped.
export async function POST() {
  return withRole(["ADMIN"], async (session) => {
    if (!(await isAgentPlatformImportConfigured())) {
      return NextResponse.json(
        { error: "No agent platform is configured. Add credentials in Settings → Shadow AI → Agent platforms." },
        { status: 400 }
      );
    }
    const result = await executeAgentPlatformScan(session.user.userId);
    await createAuditLog({
      userId: session.user.userId,
      action: "SCAN",
      entityType: "DiscoveredAgent",
      entityId: result.scanId,
      changes: {
        source: "agent_platforms",
        found: result.toolsFound,
        created: result.newToolsAdded,
        updated: result.updatedTools,
        status: result.status,
      },
    });
    return NextResponse.json(result);
  });
}
