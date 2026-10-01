import test from "node:test";
import assert from "node:assert/strict";
import {
  compareArgument,
  describeTrigger,
  evaluateHumanReviewTriggers,
  getArgument,
  humanReviewBlockedBody,
  humanReviewDenialReasons,
  normalizeHumanReviewTriggers,
  toolMatches,
  type HumanReviewTrigger,
} from "./human-review-triggers";
import {
  collectAnthropicToolUsesFromSse,
  collectOpenAIToolUsesFromSse,
  createAnthropicToolUseAccumulator,
  createOpenAIToolUseAccumulator,
  extractAnthropicToolUses,
  extractOpenAIToolUses,
  type ObservedToolUse,
} from "./mcp-tool-governance";

const refund: ObservedToolUse = {
  kind: "mcp_tool_use",
  serverName: "payments",
  toolName: "issue_refund",
  input: { order_id: "o_123", amount: 5000, currency: "USD", customer: { email: "a@b.co" } },
  id: "toolu_1",
};
const lookup: ObservedToolUse = { kind: "tool_use", serverName: null, toolName: "lookup_order", input: { id: "o_1" } };

// ── normalisation ────────────────────────────────────────────────────

test("legacy free text becomes notes; JSON strings are parsed", () => {
  assert.deepEqual(normalizeHumanReviewTriggers("amount > 1000"), [{ kind: "note", text: "amount > 1000" }]);
  assert.deepEqual(normalizeHumanReviewTriggers(["contains PII", "new vendor"]), [
    { kind: "note", text: "contains PII" },
    { kind: "note", text: "new vendor" },
  ]);
  assert.deepEqual(normalizeHumanReviewTriggers({ amount: 1000, pii: true }), [
    { kind: "note", text: "amount: 1000" },
    { kind: "note", text: "pii: true" },
  ]);
  assert.deepEqual(normalizeHumanReviewTriggers('[{"kind":"tool","tool":"payments/*"}]'), [
    { kind: "tool", tool: "payments/*" },
  ]);
  assert.deepEqual(normalizeHumanReviewTriggers(null), []);
});

test("structured triggers are validated; invalid ones dropped, unknown objects noted", () => {
  const out = normalizeHumanReviewTriggers([
    { kind: "tool_argument", tool: "payments/issue_refund", path: "amount", op: "gt", value: "1000", label: "Big refund" },
    { kind: "tool_argument", path: "x", op: "bogus" },
    { kind: "tool_argument", path: "flag", op: "exists", value: "" },
    { kind: "sensitive_data", categories: ["pii", 3] },
    { kind: "tool", tool: "  " },
    { note: "legacy shaped" },
    { something: "else" },
  ]);
  assert.deepEqual(out, [
    { kind: "tool_argument", tool: "payments/issue_refund", path: "amount", op: "gt", value: "1000", label: "Big refund" },
    { kind: "tool_argument", tool: "*", path: "flag", op: "exists" },
    { kind: "sensitive_data", categories: ["pii"] },
    { kind: "note", text: "legacy shaped" },
    { kind: "note", text: '{"something":"else"}' },
  ]);
});

test("describeTrigger reads naturally", () => {
  assert.equal(describeTrigger({ kind: "tool", tool: "payments/*" }), "any call to payments/*");
  assert.equal(
    describeTrigger({ kind: "tool_argument", tool: "issue_refund", path: "amount", op: "gt", value: 1000 }),
    "issue_refund: amount > 1000"
  );
  assert.equal(describeTrigger({ kind: "sensitive_data" }), "any tool: arguments contain sensitive data");
});

// ── matching primitives ──────────────────────────────────────────────

test("tool patterns: bare name matches any server, slash patterns match labels, * matches all", () => {
  assert.equal(toolMatches("issue_refund", refund), true);
  assert.equal(toolMatches("payments/*", refund), true);
  assert.equal(toolMatches("payments/issue_*", refund), true);
  assert.equal(toolMatches("billing/*", refund), false);
  assert.equal(toolMatches("*", lookup), true);
  assert.equal(toolMatches(undefined, lookup), true);
  assert.equal(toolMatches("ISSUE_REFUND", refund), true);
});

test("getArgument walks dot paths and array indexes", () => {
  assert.equal(getArgument(refund.input, "amount"), 5000);
  assert.equal(getArgument(refund.input, "customer.email"), "a@b.co");
  assert.equal(getArgument({ items: [{ sku: "A" }, { sku: "B" }] }, "items.1.sku"), "B");
  assert.equal(getArgument(refund.input, "missing.deep"), undefined);
  assert.equal(getArgument("not an object", "amount"), undefined);
});

test("compareArgument coerces numbers (including currency strings) and handles each op", () => {
  assert.equal(compareArgument("gt", 5000, "1000"), true);
  assert.equal(compareArgument("gt", "$1,200.50", 1000), true);
  assert.equal(compareArgument("lte", "999", 1000), true);
  assert.equal(compareArgument("gt", "not a number", 1000), false);
  assert.equal(compareArgument("eq", "USD", "usd"), true);
  assert.equal(compareArgument("eq", 10, "10.0"), true);
  assert.equal(compareArgument("neq", "wire", "card"), true);
  assert.equal(compareArgument("contains", "Send to external vendor", "external"), true);
  assert.equal(compareArgument("contains", ["admin", "billing"], "admin"), true);
  assert.equal(compareArgument("matches", "acct-998877", "^acct-\\d+$"), true);
  assert.equal(compareArgument("matches", "x", "[unclosed"), false);
  assert.equal(compareArgument("exists", 0, undefined), true);
  assert.equal(compareArgument("exists", "", undefined), false);
  assert.equal(compareArgument("exists", undefined, undefined), false);
});

// ── evaluation ───────────────────────────────────────────────────────

const triggers: HumanReviewTrigger[] = [
  { kind: "tool_argument", tool: "payments/*", path: "amount", op: "gt", value: 1000, label: "Refund over $1,000" },
  { kind: "tool", tool: "delete_*" },
  { kind: "sensitive_data", tool: "*", categories: ["pii"] },
  { kind: "note", text: "call a human when unsure" },
];

test("evaluate matches argument thresholds and tool globs; notes never match", () => {
  const matches = evaluateHumanReviewTriggers(triggers, [refund, lookup]);
  assert.equal(matches.length, 1);
  assert.equal(matches[0].tool, "payments/issue_refund");
  assert.equal(matches[0].triggerLabel, "Refund over $1,000");
  assert.equal(matches[0].detail, "amount = 5000");

  const small = { ...refund, input: { ...(refund.input as object), amount: 250 } };
  assert.deepEqual(evaluateHumanReviewTriggers(triggers, [small]), []);

  const del: ObservedToolUse = { kind: "tool_use", serverName: null, toolName: "delete_customer", input: {} };
  assert.equal(evaluateHumanReviewTriggers(triggers, [del])[0]?.detail, "tool invoked");
});

test("sensitive_data triggers use the categories supplied by the IO layer", () => {
  assert.deepEqual(evaluateHumanReviewTriggers(triggers, [lookup]), []);
  const matches = evaluateHumanReviewTriggers(triggers, [lookup], { sensitiveCategories: [["pii", "credentials"]] });
  assert.equal(matches.length, 1);
  assert.equal(matches[0].detail, "arguments contain pii");
  const other = evaluateHumanReviewTriggers(triggers, [lookup], { sensitiveCategories: [["secrets"]] });
  assert.deepEqual(other, []);
});

test("denial reasons and the 403 body name the agent, tool and trigger; digits are masked", () => {
  const big = { ...refund, input: { amount: 5000, account: "12345678901" } };
  const matches = evaluateHumanReviewTriggers(
    [{ kind: "tool_argument", tool: "*", path: "account", op: "exists" }],
    [big]
  );
  assert.equal(matches[0].detail, "account = …8901");
  const reasons = humanReviewDenialReasons({ id: "agent_1", name: "Refund bot" }, matches);
  assert.equal(reasons[0].ruleKey, "human_review_required");
  assert.match(reasons[0].message, /Refund bot.*payments\/issue_refund/);
  const body = humanReviewBlockedBody({ id: "agent_1", name: "Refund bot" }, matches);
  assert.equal(body.error.type, "human_review_required");
  assert.equal(body.error.violations[0].tool, "payments/issue_refund");
});

// ── argument extraction ──────────────────────────────────────────────

test("non-streaming extractors carry arguments and ids", () => {
  const anthropic = extractAnthropicToolUses([
    { type: "text", text: "ok" },
    { type: "tool_use", id: "toolu_9", name: "issue_refund", input: { amount: 12 } },
  ]);
  assert.deepEqual(anthropic, [{ kind: "tool_use", toolName: "issue_refund", serverName: null, input: { amount: 12 }, id: "toolu_9" }]);

  const chat = extractOpenAIToolUses({
    choices: [{ message: { tool_calls: [{ id: "call_1", function: { name: "lookup", arguments: '{"id":"o_1"}' } }] } }],
  });
  assert.deepEqual(chat, [{ kind: "tool_use", toolName: "lookup", serverName: null, input: { id: "o_1" }, id: "call_1" }]);

  const responses = extractOpenAIToolUses({
    output: [
      { type: "function_call", call_id: "c_2", name: "wire", arguments: "{\"amount\": 9}" },
      { type: "mcp_call", id: "m_1", server_label: "crm", name: "update", arguments: "not json" },
    ],
  });
  assert.equal(responses.length, 2);
  assert.deepEqual(responses[0].input, { amount: 9 });
  assert.equal(responses[1].input, "not json");
});

test("Anthropic stream accumulator assembles input_json_delta fragments", () => {
  const acc = createAnthropicToolUseAccumulator();
  assert.equal(acc.push({ type: "message_start" }), null);
  assert.equal(acc.push({ type: "content_block_start", index: 1, content_block: { type: "tool_use", id: "t1", name: "issue_refund", input: {} } }), null);
  assert.equal(acc.push({ type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: '{"amou' } }), null);
  assert.equal(acc.push({ type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: 'nt": 5000}' } }), null);
  const done = acc.push({ type: "content_block_stop", index: 1 });
  assert.deepEqual(done, { kind: "tool_use", toolName: "issue_refund", serverName: null, input: { amount: 5000 }, id: "t1" });
  assert.deepEqual(acc.flush(), []);
});

test("SSE collectors read buffered bodies for both dialects", () => {
  const anthropicSse = [
    'data: {"type":"message_start"}',
    'data: {"type":"content_block_start","index":0,"content_block":{"type":"mcp_tool_use","id":"m1","name":"issue_refund","server_name":"payments","input":{}}}',
    'data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\\"amount\\":7500}"}}',
    'data: {"type":"content_block_stop","index":0}',
    'data: {"type":"message_stop"}',
  ].join("\n");
  const uses = collectAnthropicToolUsesFromSse(anthropicSse);
  assert.equal(uses.length, 1);
  assert.deepEqual(uses[0].input, { amount: 7500 });
  assert.equal(uses[0].serverName, "payments");

  const chatSse = [
    'data: {"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"wire","arguments":""}}]}}]}',
    'data: {"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"amount\\""}}]}}]}',
    'data: {"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":": 42}"}}]}}]}',
    'data: {"choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}]}',
    "data: [DONE]",
  ].join("\r\n");
  const chat = collectOpenAIToolUsesFromSse(chatSse, "chat_completions");
  assert.deepEqual(chat, [{ kind: "tool_use", toolName: "wire", serverName: null, input: { amount: 42 }, id: "call_1" }]);

  const responsesSse = [
    'data: {"type":"response.output_item.added","item":{"type":"function_call","name":"wire"}}',
    'data: {"type":"response.output_item.done","item":{"type":"function_call","call_id":"c9","name":"wire","arguments":"{\\"amount\\":1}"}}',
  ].join("\n");
  const responses = collectOpenAIToolUsesFromSse(responsesSse, "responses");
  assert.deepEqual(responses, [{ kind: "tool_use", toolName: "wire", serverName: null, input: { amount: 1 }, id: "c9" }]);

  // A cut-off chat stream still yields the partial call on flush.
  const acc = createOpenAIToolUseAccumulator("chat_completions");
  acc.push({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { name: "wire", arguments: "{}" } }] } }] });
  assert.equal(acc.flush()[0]?.toolName, "wire");
});
