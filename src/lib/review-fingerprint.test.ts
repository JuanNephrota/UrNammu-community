import test from "node:test";
import assert from "node:assert/strict";
import {
  canonicalJson,
  describeWithheldCalls,
  reviewFingerprint,
  toolCallFingerprint,
  waiverCovers,
} from "./review-fingerprint";
import { humanReviewBlockedBody, type HumanReviewMatch } from "./human-review-triggers";

const match = (tool: string, input: unknown, trigger = "Refund over $1,000"): HumanReviewMatch => {
  const [serverName, toolName] = tool.includes("/") ? tool.split("/") : [null, tool];
  return {
    trigger: { kind: "tool_argument", tool: "*", path: "amount", op: "gt", value: 1000, label: trigger },
    triggerLabel: trigger,
    use: { kind: "mcp_tool_use", serverName, toolName, input },
    tool,
    detail: "amount = 5000",
  };
};

test("canonicalJson sorts keys recursively and is stable", () => {
  assert.equal(canonicalJson({ b: 1, a: { d: [3, { z: 1, y: 2 }], c: null } }), '{"a":{"c":null,"d":[3,{"y":2,"z":1}]},"b":1}');
  assert.equal(canonicalJson(undefined), "null");
  assert.equal(canonicalJson("x"), '"x"');
});

test("fingerprints ignore argument order and differ on values", () => {
  const a = toolCallFingerprint({ serverName: "payments", toolName: "refund", input: { amount: 5000, order: "o1" } });
  const b = toolCallFingerprint({ serverName: "payments", toolName: "refund", input: { order: "o1", amount: 5000 } });
  const c = toolCallFingerprint({ serverName: "payments", toolName: "refund", input: { order: "o1", amount: 5001 } });
  assert.equal(a, b);
  assert.notEqual(a, c);
  assert.equal(a.length, 64);
});

test("set fingerprint is order-independent and collapses duplicates", () => {
  const m1 = match("payments/refund", { amount: 5000 });
  const m2 = match("crm/update", { id: 1 });
  assert.equal(reviewFingerprint([m1, m2]), reviewFingerprint([m2, m1]));
  assert.equal(reviewFingerprint([m1, m1]), reviewFingerprint([m1]));
  assert.notEqual(reviewFingerprint([m1]), reviewFingerprint([m2]));
});

test("describeWithheldCalls keeps what a reviewer needs and truncates huge arguments", () => {
  const big = match("crm/update", { blob: "x".repeat(10_000) });
  const [row] = describeWithheldCalls([big]);
  assert.equal(row.tool, "crm/update");
  assert.equal(row.trigger, "Refund over $1,000");
  assert.ok(row.input.length <= 4000);
  assert.ok(row.input.endsWith("…"));
  assert.equal(row.fingerprint, toolCallFingerprint(big.use));
});

test("exact waivers match the same call or the whole set; trigger waivers match the label", () => {
  const m = match("payments/refund", { amount: 5000 });
  const other = match("payments/refund", { amount: 9000 });
  const set = reviewFingerprint([m]);
  const exact = { id: "w1", waiverScope: "exact", fingerprint: set, triggers: ["Refund over $1,000"], expiresAt: null, usesRemaining: 1 };
  assert.equal(waiverCovers(exact, m, set), true);
  assert.equal(waiverCovers(exact, other, reviewFingerprint([other])), false);
  const byTrigger = { ...exact, id: "w2", waiverScope: "trigger", fingerprint: "irrelevant" };
  assert.equal(waiverCovers(byTrigger, other, reviewFingerprint([other])), true);
  assert.equal(waiverCovers(byTrigger, match("x", {}, "Other trigger"), "fp"), false);
});

test("expired or exhausted waivers never cover", () => {
  const m = match("payments/refund", { amount: 5000 });
  const set = reviewFingerprint([m]);
  const base = { id: "w", waiverScope: "exact", fingerprint: set, triggers: [], expiresAt: null, usesRemaining: null };
  assert.equal(waiverCovers(base, m, set), true);
  assert.equal(waiverCovers({ ...base, usesRemaining: 0 }, m, set), false);
  assert.equal(waiverCovers({ ...base, expiresAt: new Date(Date.now() - 1000) }, m, set), false);
});

test("the 403 body names the pending review and how to resume", () => {
  const body = humanReviewBlockedBody({ id: "a", name: "Refund bot" }, [match("payments/refund", { amount: 5000 })], {
    id: "hr_1",
    url: "https://app.example.com/oversight/human-review?request=hr_1",
  });
  assert.equal(body.error.review?.id, "hr_1");
  assert.match(body.error.message, /Pending review hr_1 .*re-run the call/);
  const plain = humanReviewBlockedBody({ id: "a", name: "Refund bot" }, [match("payments/refund", { amount: 5000 })]);
  assert.equal("review" in plain.error, false);
});
