import { NextRequest, NextResponse } from "next/server";
import { authenticateProxyRequest } from "@/lib/proxy-common";
import { loadAgentGovernance } from "@/lib/mcp-tool-activity";
import { evaluateAgentRuntime } from "@/lib/agent-runtime-gate";
import { summarizeScopeForEffectivePolicy } from "@/lib/agent-scope";
import { describeTrigger, isEnforceableTrigger } from "@/lib/human-review-triggers";

/**
 * GET /api/agent-policy
 * Headers: x-proxy-key, x-agent-id
 *
 * The agent's effective tool policy, for runtimes that want to hide or
 * pre-filter tools before the model ever sees them: kill-switch state, MCP
 * allowlists (catalog merged), charter scope (access level, connected
 * systems, classification rules, the unknown-tool default) and the review
 * triggers the proxy evaluates. Pair with POST /api/agent-policy/check for a
 * per-call verdict.
 */
export async function GET(req: NextRequest) {
  const authError = await authenticateProxyRequest(req);
  if (authError) return authError;
  const agentId = req.headers.get("x-agent-id");
  if (!agentId) {
    return NextResponse.json({ error: { type: "agent_required", message: "Send x-agent-id." } }, { status: 400 });
  }
  const agent = await loadAgentGovernance(agentId);
  if (!agent) {
    return NextResponse.json({ error: { type: "agent_not_found", message: `No agent with id ${agentId}.` } }, { status: 404 });
  }
  const runtime = evaluateAgentRuntime(agent);
  return NextResponse.json({
    agent: { id: agent.id, name: agent.name, status: agent.status, aiSystemId: agent.aiSystemId },
    runtime: runtime.blocked ? { blocked: true, rule: runtime.ruleKey, message: runtime.message } : { blocked: false },
    mcp: {
      serverAllowlist: agent.config.serverAllowlist,
      toolAllowlist: agent.config.toolAllowlist,
      enforcement: agent.config.enforcement,
    },
    scope: summarizeScopeForEffectivePolicy(agent.scope),
    review: {
      enforcement: agent.review.enforcement,
      triggers: agent.review.triggers.filter(isEnforceableTrigger).map((t) => ({ kind: t.kind, description: describeTrigger(t) })),
    },
  });
}
