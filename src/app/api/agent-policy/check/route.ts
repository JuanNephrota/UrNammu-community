import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { authenticateProxyRequest } from "@/lib/proxy-common";
import {
  adjudicateHumanReview,
  agentWithholdsResponses,
  evaluateAgentToolPolicy,
  loadAgentGovernance,
  logAgentBlockedDenial,
  logMcpToolDenials,
  recordHumanReviewMatches,
  recordToolActivity,
} from "@/lib/mcp-tool-activity";
import { agentBlockedResponseBody, evaluateAgentRuntime } from "@/lib/agent-runtime-gate";
import { evaluateToolUses, isServerAllowed, toolLabel, type ObservedToolUse } from "@/lib/mcp-tool-governance";
import { classifyTool } from "@/lib/agent-scope";
import { isScopeMatch, matchRuleKey, type HumanReviewMatch } from "@/lib/human-review-triggers";

export const POLICY_CHECK_PROVIDER = "policy-check";

const callSchema = z.object({
  tool: z.string().trim().min(1).max(200),
  /** MCP server the tool belongs to; omit for the agent's own (client-side) tools. */
  server: z.string().trim().min(1).max(200).nullish(),
  arguments: z.unknown().optional(),
  /** Provider call id, echoed back. */
  id: z.string().trim().max(200).nullish(),
});

const bodySchema = z.union([
  z.object({ calls: z.array(callSchema).min(1).max(50) }),
  callSchema.transform((call) => ({ calls: [call] })),
]);

type Decision = "allow" | "review" | "deny";
type Reason = { rule: string; message: string; policy: string };

const worst = (a: Decision, b: Decision): Decision => {
  const rank: Record<Decision, number> = { allow: 0, review: 1, deny: 2 };
  return rank[b] > rank[a] ? b : a;
};

/**
 * POST /api/agent-policy/check
 * Headers: x-proxy-key, x-agent-id, optional x-user-email / x-department
 * Body:    { tool, server?, arguments?, id? }  or  { calls: [ …same… ] }
 *
 * The proxy can only govern tools it sees execute (MCP connector and provider
 * tools). An agent runtime that executes its own tools asks here BEFORE
 * running one and gets the same verdict the proxy would give: the kill
 * switch, the MCP allowlists, the charter scope and the human-review triggers
 * (waivers honoured, pending requests queued). Everything is recorded exactly
 * as proxy traffic is — AgentToolCall rows, profiles, denials and alerts — so
 * client-side tools show up on the agent's MCP card.
 *
 * Always 200 with a `decision` per call ("allow" | "review" | "deny") and an
 * overall `decision` (the worst of them); monitor-mode dimensions report what
 * they would have done under `advisories` and still allow. 403 only for a
 * suspended or retired agent, matching the proxy.
 */
export async function POST(req: NextRequest) {
  const authError = await authenticateProxyRequest(req);
  if (authError) return authError;
  const agentId = req.headers.get("x-agent-id");
  if (!agentId) {
    return NextResponse.json({ error: { type: "agent_required", message: "Send x-agent-id." } }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: { type: "invalid_request", details: parsed.error.flatten() } }, { status: 400 });
  }
  const agent = await loadAgentGovernance(agentId);
  if (!agent) {
    return NextResponse.json({ error: { type: "agent_not_found", message: `No agent with id ${agentId}.` } }, { status: 404 });
  }
  const userEmail = req.headers.get("x-user-email");
  const department = req.headers.get("x-department");
  const aiSystemId = agent.aiSystemId;

  const runtime = evaluateAgentRuntime(agent);
  if (runtime.blocked) {
    await logAgentBlockedDenial({ provider: POLICY_CHECK_PROVIDER, agent, verdict: runtime, aiSystemId, userEmail, department });
    return NextResponse.json(agentBlockedResponseBody(runtime), { status: 403 });
  }

  const uses: ObservedToolUse[] = parsed.data.calls.map((call) => ({
    kind: call.server ? "mcp_tool_use" : "tool_use",
    toolName: call.tool,
    serverName: call.server ?? null,
    ...(call.arguments !== undefined ? { input: call.arguments } : {}),
    ...(call.id ? { id: call.id } : {}),
  }));

  // 1. MCP allowlists (server, then tool). Enforce denies; monitor advises.
  const mcpEnforced = agent.config.enforcement === "enforce";
  const serverDenied = new Set<string>();
  for (const use of uses) {
    if (use.serverName && !isServerAllowed({ name: use.serverName, host: null }, agent.config.serverAllowlist)) {
      serverDenied.add(use.serverName);
    }
  }
  const toolVerdicts = evaluateToolUses(uses, agent.config);

  // 2. Charter scope + human-review triggers, adjudicated like a proxy response.
  const matches = await evaluateAgentToolPolicy(agent, uses);
  const adjudication =
    matches.length > 0 && agentWithholdsResponses(agent)
      ? await adjudicateHumanReview({ agent, matches, provider: POLICY_CHECK_PROVIDER, model: POLICY_CHECK_PROVIDER, userEmail, department })
      : null;
  const withheld = adjudication?.withheld ?? [];
  const withheldKeys = new Set(withheld.map(matchKey));
  const waivedKeys = new Set((adjudication?.waived ?? []).map(matchKey));

  // 3. Record exactly as the proxies do.
  await recordToolActivity({
    agent,
    aiSystemId,
    provider: POLICY_CHECK_PROVIDER,
    model: POLICY_CHECK_PROVIDER,
    userEmail,
    department,
    declaredServers: [],
    toolUses: uses,
    reviewMatches: matches,
  });
  if (matches.length > 0 && (!adjudication || withheld.length > 0)) {
    await recordHumanReviewMatches({
      agent,
      matches: adjudication ? withheld : matches,
      blocked: withheld.length > 0,
      reviewRequestId: adjudication?.request?.id ?? null,
      provider: POLICY_CHECK_PROVIDER,
      model: POLICY_CHECK_PROVIDER,
      aiSystemId,
      userEmail,
      department,
      isStreaming: false,
    });
  }
  const deniedByAllowlist = toolVerdicts.filter((v) => !v.allowed || (v.use.serverName !== null && serverDenied.has(v.use.serverName)));
  if (deniedByAllowlist.length > 0) {
    await logMcpToolDenials({
      provider: POLICY_CHECK_PROVIDER,
      agent,
      aiSystemId,
      userEmail,
      department,
      uses: deniedByAllowlist.map((v) => v.use),
      serverDenied: Array.from(serverDenied),
    });
  }

  // 4. Per-call verdicts.
  let overall: Decision = "allow";
  const calls = uses.map((use, index) => {
    const verdict = toolVerdicts[index];
    const label = toolLabel(use);
    const classification = classifyTool(use, agent.scope.rules);
    const reasons: Reason[] = [];
    const advisories: Reason[] = [];
    let decision: Decision = "allow";

    const serverBlocked = use.serverName !== null && serverDenied.has(use.serverName);
    if (serverBlocked || !verdict.allowed) {
      const reason: Reason = serverBlocked
        ? { rule: "mcp_server_not_allowed", message: `MCP server "${use.serverName}" is not allowlisted for agent "${agent.name}".`, policy: `Agent MCP allowlist: ${agent.name}` }
        : { rule: "mcp_tool_not_allowed", message: `Tool ${label} is not on the MCP allowlist for agent "${agent.name}".`, policy: `Agent MCP allowlist: ${agent.name}` };
      if (mcpEnforced) {
        decision = "deny";
        reasons.push(reason);
      } else {
        advisories.push(reason);
      }
    }

    for (const match of matches.filter((m) => m.use === use)) {
      const reason: Reason = {
        rule: matchRuleKey(match),
        message: `${match.triggerLabel}: ${match.detail}`,
        policy: isScopeMatch(match) ? `Agent charter scope: ${agent.name}` : `Human review trigger: ${match.triggerLabel}`,
      };
      const key = matchKey(match);
      if (withheldKeys.has(key)) {
        decision = worst(decision, isScopeMatch(match) ? "deny" : "review");
        reasons.push(reason);
      } else if (waivedKeys.has(key)) {
        advisories.push({ ...reason, rule: "human_review_waived", message: `${reason.message} (covered by an approved waiver)` });
      } else {
        advisories.push(reason);
      }
    }

    overall = worst(overall, decision);
    return {
      tool: label,
      ...(use.id ? { id: use.id } : {}),
      decision,
      classification: { access: classification.access, system: classification.system, source: classification.source },
      reasons,
      advisories,
    };
  });

  return NextResponse.json({
    decision: overall,
    agent: { id: agent.id, name: agent.name },
    ...(adjudication?.request
      ? { review: { id: adjudication.request.id, url: adjudication.request.url, status: "PENDING" } }
      : {}),
    calls,
  });
}

function matchKey(match: HumanReviewMatch): string {
  return `${match.trigger.kind}|${match.triggerLabel}|${match.tool}|${match.detail}|${match.use.id ?? ""}`;
}
