import test from "node:test";
import assert from "node:assert/strict";
import {
  canonicalize,
  contentHash,
  nanoKey,
  metricDedupeKey,
  eventDedupeKey,
  spanDedupeKey,
} from "./otel-dedupe";

test("canonicalize sorts object keys recursively and drops undefined", () => {
  const a = canonicalize({ b: 1, a: { z: true, y: undefined, x: [3, { k: 1, j: 2 }] } });
  const b = canonicalize({ a: { x: [3, { j: 2, k: 1 }], z: true }, b: 1 });
  assert.equal(JSON.stringify(a), JSON.stringify(b));
  assert.equal(JSON.stringify(a), '{"a":{"x":[3,{"j":2,"k":1}],"z":true},"b":1}');
});

test("canonicalize preserves array order", () => {
  assert.notEqual(
    JSON.stringify(canonicalize({ a: [1, 2] })),
    JSON.stringify(canonicalize({ a: [2, 1] })),
  );
});

test("contentHash is a 40-char hex string and deterministic", () => {
  const h1 = contentHash({ x: 1, y: "two" });
  const h2 = contentHash({ y: "two", x: 1 });
  assert.match(h1, /^[0-9a-f]{40}$/);
  assert.equal(h1, h2);
  assert.notEqual(h1, contentHash({ x: 2, y: "two" }));
});

test("nanoKey uses the raw string, stringifies numbers, and falls back to the resolved date", () => {
  const fallback = new Date(1_700_000_000_000);
  assert.equal(nanoKey("1700000000000000000", fallback), "1700000000000000000");
  assert.equal(nanoKey(1700000000000000000, fallback), "1700000000000000000");
  assert.equal(nanoKey(undefined, fallback), "ms:1700000000000");
  assert.equal(nanoKey("", fallback), "ms:1700000000000");
});

const baseMetric = {
  timeUnixNano: "1700000000000000000",
  timestamp: new Date(1_700_000_000_000),
  metricName: "claude_code.token.usage",
  value: 42,
  unit: "tokens",
  attributes: { "user.id": "u1", model: "claude-sonnet-4-6", type: "input" },
};

test("metricDedupeKey: same record twice → same key", () => {
  assert.equal(metricDedupeKey(baseMetric), metricDedupeKey({ ...baseMetric }));
});

test("metricDedupeKey: attribute order is irrelevant", () => {
  const reordered = {
    ...baseMetric,
    attributes: { type: "input", model: "claude-sonnet-4-6", "user.id": "u1" },
  };
  assert.equal(metricDedupeKey(baseMetric), metricDedupeKey(reordered));
});

test("metricDedupeKey: changing timestamp or value → different key", () => {
  const k = metricDedupeKey(baseMetric);
  assert.notEqual(
    k,
    metricDedupeKey({ ...baseMetric, timeUnixNano: "1700000001000000000" }),
  );
  assert.notEqual(k, metricDedupeKey({ ...baseMetric, value: 43 }));
  assert.notEqual(
    k,
    metricDedupeKey({ ...baseMetric, metricName: "claude_code.cost.usage" }),
  );
  assert.notEqual(k, metricDedupeKey({ ...baseMetric, unit: null }));
});

test("eventDedupeKey: sequence and prompt id participate in the key", () => {
  const base = {
    timeUnixNano: "1700000000000000000",
    timestamp: new Date(1_700_000_000_000),
    eventName: "tool_result",
    sessionId: "s1",
    promptId: "p1",
    eventSequence: 3,
    attributes: { tool_name: "Bash", success: true },
  };
  assert.equal(eventDedupeKey(base), eventDedupeKey({ ...base }));
  assert.notEqual(eventDedupeKey(base), eventDedupeKey({ ...base, eventSequence: 4 }));
  assert.notEqual(eventDedupeKey(base), eventDedupeKey({ ...base, promptId: "p2" }));
  assert.notEqual(eventDedupeKey(base), eventDedupeKey({ ...base, sessionId: "s2" }));
});

test("spanDedupeKey: derived from traceId+spanId alone when both present", () => {
  const base = {
    traceId: "abc",
    spanId: "def",
    startTimeUnixNano: "1700000000000000000",
    endTimeUnixNano: "1700000000500000000",
    timestamp: new Date(1_700_000_000_000),
    spanName: "tool.read_file",
    parentSpanId: null,
    statusCode: 1,
    attributes: { "gen_ai.tool.name": "read_file" },
  };
  const k = spanDedupeKey(base);
  // Content differences don't matter once the ids are set.
  assert.equal(
    k,
    spanDedupeKey({ ...base, spanName: "other", attributes: {}, statusCode: 2 }),
  );
  assert.equal(k, contentHash({ traceId: "abc", spanId: "def" }));
  assert.notEqual(k, spanDedupeKey({ ...base, spanId: "xyz" }));
});

test("spanDedupeKey: falls back to a content hash when ids are missing", () => {
  const base = {
    traceId: null,
    spanId: null,
    startTimeUnixNano: "1700000000000000000",
    endTimeUnixNano: "1700000000500000000",
    timestamp: new Date(1_700_000_000_000),
    spanName: "tool.read_file",
    parentSpanId: null,
    statusCode: 1,
    attributes: { b: 2, a: 1 },
  };
  assert.equal(spanDedupeKey(base), spanDedupeKey({ ...base, attributes: { a: 1, b: 2 } }));
  assert.notEqual(spanDedupeKey(base), spanDedupeKey({ ...base, spanName: "other" }));
  assert.notEqual(
    spanDedupeKey(base),
    spanDedupeKey({ ...base, startTimeUnixNano: "1700000001000000000" }),
  );
  // Only one id present → still the content path (no half-key collisions).
  assert.notEqual(
    spanDedupeKey({ ...base, traceId: "abc" }),
    contentHash({ traceId: "abc", spanId: null }),
  );
});
