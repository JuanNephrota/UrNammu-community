import test from "node:test";
import assert from "node:assert/strict";
import {
  AGENT_RETIRED_RULE,
  AGENT_SUSPENDED_RULE,
  agentBlockedDenialReason,
  agentBlockedResponseBody,
  evaluateAgentRuntime,
} from "./agent-runtime-gate";

const base = { id: "agent_1", name: "Refund bot", status: "DEPLOYED", suspendedAt: null };

test("no agent attributed → forwards", () => {
  assert.deepEqual(evaluateAgentRuntime(null), { blocked: false });
});

test("live statuses forward, including DRAFT and DEPRECATED", () => {
  for (const status of ["DRAFT", "UNDER_REVIEW", "APPROVED", "DEPLOYED", "DEPRECATED"]) {
    assert.deepEqual(evaluateAgentRuntime({ ...base, status }), { blocked: false }, status);
  }
});

test("suspended agent is blocked with the suspended rule", () => {
  const verdict = evaluateAgentRuntime({ ...base, suspendedAt: new Date("2026-09-30T12:00:00Z") });
  assert.equal(verdict.blocked, true);
  if (!verdict.blocked) return;
  assert.equal(verdict.ruleKey, AGENT_SUSPENDED_RULE);
  assert.match(verdict.message, /Refund bot.*suspended/);
  assert.equal(verdict.policyName, "Agent kill switch: Refund bot");
});

test("suspendedAt as an ISO string (proxy JSON path) still blocks", () => {
  const verdict = evaluateAgentRuntime({ ...base, suspendedAt: "2026-09-30T12:00:00.000Z" });
  assert.equal(verdict.blocked, true);
});

test("retired agent is blocked with the retired rule", () => {
  const verdict = evaluateAgentRuntime({ ...base, status: "RETIRED" });
  assert.equal(verdict.blocked, true);
  if (!verdict.blocked) return;
  assert.equal(verdict.ruleKey, AGENT_RETIRED_RULE);
});

test("suspension wins over retirement so the operator action is what shows", () => {
  const verdict = evaluateAgentRuntime({ ...base, status: "RETIRED", suspendedAt: new Date() });
  assert.equal(verdict.blocked && verdict.ruleKey, AGENT_SUSPENDED_RULE);
});

test("denial reason and response body carry the agent id and rule", () => {
  const agent = { ...base, suspendedAt: new Date() };
  const verdict = evaluateAgentRuntime(agent);
  assert.equal(verdict.blocked, true);
  if (!verdict.blocked) return;
  assert.deepEqual(agentBlockedDenialReason(agent, verdict), {
    ruleKey: AGENT_SUSPENDED_RULE,
    message: verdict.message,
    policyId: "agent_1",
    policyName: "Agent kill switch: Refund bot",
  });
  const body = agentBlockedResponseBody(verdict);
  assert.equal(body.error.type, "agent_blocked");
  assert.equal(body.error.violations.length, 1);
  assert.equal(body.error.violations[0].rule, AGENT_SUSPENDED_RULE);
});
