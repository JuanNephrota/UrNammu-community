// MIRROR of src/lib/agent-runtime-gate.ts — the ai-proxy is a separate project and
// cannot import from the Next.js app. Keep byte-identical below this header.
/**
 * Agent runtime gate — the kill switch.
 *
 * Pure logic shared (by copy) between the Next.js app and the Azure Functions
 * proxy; `ai-proxy/src/lib/agent-runtime-gate.ts` is a byte-identical mirror
 * (guarded by scripts/check-mirror-drift.mjs).
 *
 * Both proxies resolve `x-agent-id` to a registered agent before forwarding a
 * request. This module decides whether that agent may send traffic at all:
 *
 * - **Suspended** (`suspendedAt` set): an operator pressed Suspend on the
 *   agent detail page. Traffic is refused until Resume.
 * - **Retired** (`status === "RETIRED"`): the agent has been decommissioned.
 *   Traffic is refused until the status is changed back.
 *
 * Every other status forwards — including DRAFT (agents registered from the
 * discovery queue start there and must be able to send `x-agent-id` so their
 * traffic is governed and attributed) and DEPRECATED (still running while
 * being phased out). The verdict applies regardless of `mcpEnforcement`: a
 * kill switch that only recorded would not be one.
 */

export const AGENT_SUSPENDED_RULE = "agent_suspended";
export const AGENT_RETIRED_RULE = "agent_retired";

export type AgentRuntimeState = {
  id: string;
  name: string;
  status: string;
  suspendedAt: Date | string | null;
};

export type AgentBlockedVerdict = {
  blocked: true;
  ruleKey: typeof AGENT_SUSPENDED_RULE | typeof AGENT_RETIRED_RULE;
  /** Human-readable reason; safe to return to the calling client. */
  message: string;
  policyName: string;
};

export type AgentRuntimeVerdict = { blocked: false } | AgentBlockedVerdict;

export function evaluateAgentRuntime(agent: AgentRuntimeState | null): AgentRuntimeVerdict {
  if (!agent) return { blocked: false };
  const policyName = `Agent kill switch: ${agent.name}`;
  if (agent.suspendedAt) {
    return {
      blocked: true,
      ruleKey: AGENT_SUSPENDED_RULE,
      message: `Agent "${agent.name}" is suspended; its traffic is refused until an administrator resumes it.`,
      policyName,
    };
  }
  if (agent.status === "RETIRED") {
    return {
      blocked: true,
      ruleKey: AGENT_RETIRED_RULE,
      message: `Agent "${agent.name}" is retired; its traffic is refused. Change its status to allow requests again.`,
      policyName,
    };
  }
  return { blocked: false };
}

/** One `PolicyDenial.reasons[]` entry for a blocked request. */
export function agentBlockedDenialReason(agent: AgentRuntimeState, verdict: AgentBlockedVerdict) {
  return {
    ruleKey: verdict.ruleKey,
    message: verdict.message,
    policyId: agent.id,
    policyName: verdict.policyName,
  };
}

/**
 * The 403 body both proxies return. Same shape as the MCP `policy_denied`
 * error so clients that already parse `violations` need no new handling.
 */
export function agentBlockedResponseBody(verdict: AgentBlockedVerdict) {
  return {
    error: {
      type: "agent_blocked",
      message: verdict.message,
      violations: [{ rule: verdict.ruleKey, message: verdict.message, policy: verdict.policyName }],
    },
  };
}
