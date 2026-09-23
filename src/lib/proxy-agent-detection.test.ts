import { test } from "node:test";
import assert from "node:assert/strict";
import {
  callerDisplayName,
  callerExternalId,
  DETECTION_THRESHOLD,
  scoreCaller,
  type CallerActivity,
} from "./proxy-agent-detection";

const base: CallerActivity = {
  provider: "claude",
  keyHash: "abcd1234abcd1234",
  userId: null,
  userEmail: null,
  aiSystemId: null,
  framework: null,
  sdk: "anthropic-python 0.49.0",
  models: ["claude-sonnet-5"],
  department: null,
  requests: 50,
  activeHours: 3,
  firstSeen: new Date("2026-09-20T00:00:00Z"),
  lastSeen: new Date("2026-09-21T00:00:00Z"),
  toolCalls: 0,
  mcpToolCalls: 0,
  tools: [],
  mcpServers: [],
};

test("a plain SDK caller with no tool use stays below threshold", () => {
  const { score, excluded } = scoreCaller(base);
  assert.equal(excluded, null);
  assert.ok(score < DETECTION_THRESHOLD, `score ${score}`);
});

test("an agent framework alone is enough to flag", () => {
  const { score, signals } = scoreCaller({ ...base, framework: "openai_agents" });
  assert.ok(score >= DETECTION_THRESHOLD);
  assert.ok(signals.some((s) => s.key === "agent_framework"));
});

test("tool loops on a service key flag without a framework header", () => {
  const { score, signals } = scoreCaller({
    ...base,
    toolCalls: 40,
    mcpToolCalls: 10,
    mcpServers: ["github"],
    activeHours: 30,
  });
  assert.equal(score, 30 + 15 + 10 + 10 + 5);
  assert.deepEqual(
    signals.map((s) => s.key),
    ["tool_use", "mcp_tools", "heavy_tool_use", "always_on", "service_identity"]
  );
});

test("interactive assistants, anonymous and one-off callers are excluded", () => {
  assert.equal(scoreCaller({ ...base, framework: "claude_code", toolCalls: 500 }).excluded, "assistant");
  assert.equal(scoreCaller({ ...base, keyHash: null }).excluded, "anonymous");
  assert.equal(scoreCaller({ ...base, requests: 2, framework: "crewai" }).excluded, "too_few_requests");
});

test("score is capped at 100", () => {
  const { score } = scoreCaller({
    ...base,
    framework: "langgraph",
    toolCalls: 100,
    mcpToolCalls: 50,
    activeHours: 100,
  });
  assert.equal(score, 100);
});

test("externalId is stable per caller and differs across identities", () => {
  const id = callerExternalId(base);
  assert.equal(id, callerExternalId({ ...base }));
  assert.notEqual(id, callerExternalId({ ...base, keyHash: "other" }));
  assert.notEqual(id, callerExternalId({ ...base, provider: "chatgpt" }));
  assert.equal(id.length, 32);
});

test("display name prefers email, then key prefix, and names the framework", () => {
  assert.equal(callerDisplayName({ ...base, framework: "crewai" }), "CrewAI agent (key abcd1234)");
  assert.equal(callerDisplayName({ ...base, userEmail: "a@x.com" }), "Claude agent (a@x.com)");
});
