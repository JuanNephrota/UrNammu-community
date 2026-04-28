/**
 * Unit tests for the proxy's runtime policy evaluator.
 *
 * Covers the pure synchronous paths: parseRuntimeRules, extractPromptText,
 * and evaluateRequest's rule types that don't hit Postgres (model allow/block,
 * maxOutputTokens, blockedPromptPatterns).
 *
 * Rate-limit and cost-cap rules are not covered here — they run
 * prisma.aPIUsageLog.count / aggregate queries. Those are thin Prisma wrappers
 * whose correctness would require integration tests with a real DB or a
 * significant prisma-mocking refactor. Flagged in the final `test.skip`.
 *
 * Run: `npx tsx --test ai-proxy/src/lib/policy-enforcement.test.ts`
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  evaluateRequest,
  extractPromptText,
  parseRuntimeRules,
} from "./policy-enforcement";
import type { LoadedPolicy } from "./policy-loader";

// ── parseRuntimeRules ─────────────────────────────────────────────────

test("parseRuntimeRules extracts the runtime sub-object", () => {
  const out = parseRuntimeRules({
    runtime: {
      allowedModelsRuntime: ["claude-sonnet-4"],
      maxOutputTokens: 4096,
    },
  });

  assert.deepEqual(out, {
    allowedModelsRuntime: ["claude-sonnet-4"],
    maxOutputTokens: 4096,
  });
});

test("parseRuntimeRules returns null when rules has no runtime block", () => {
  assert.equal(parseRuntimeRules({ allowedVendors: ["OpenAI"] }), null);
  assert.equal(parseRuntimeRules(null), null);
  assert.equal(parseRuntimeRules("string"), null);
  assert.equal(parseRuntimeRules([]), null);
});

test("parseRuntimeRules drops invalid regex sources", () => {
  const out = parseRuntimeRules({
    runtime: {
      blockedPromptPatterns: ["valid\\d+", "[unterminated", "also-valid"],
    },
  });

  assert.deepEqual(out?.blockedPromptPatterns, ["valid\\d+", "also-valid"]);
});

test("parseRuntimeRules drops non-positive numeric bounds", () => {
  const out = parseRuntimeRules({
    runtime: {
      maxOutputTokens: 0,
      maxRequestsPerMinute: -5,
      maxCostPerDay: 0,
    },
  });

  assert.equal(out, null);
});

test("parseRuntimeRules returns null when runtime block is empty after filtering", () => {
  const out = parseRuntimeRules({
    runtime: {
      allowedModelsRuntime: [],
      blockedPromptPatterns: ["[unterminated"],
    },
  });

  assert.equal(out, null);
});

// ── extractPromptText ─────────────────────────────────────────────────

test("extractPromptText joins Anthropic-style string messages", () => {
  const text = extractPromptText({
    system: "you are a helpful assistant",
    messages: [
      { role: "user", content: "hello" },
      { role: "assistant", content: "hi there" },
    ],
  });

  assert.equal(text, "you are a helpful assistant\nhello\nhi there");
});

test("extractPromptText flattens content-block arrays", () => {
  const text = extractPromptText({
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: "first block" },
          { type: "image", source: { data: "..." } }, // non-text block ignored
          { type: "text", text: "second block" },
        ],
      },
    ],
  });

  assert.equal(text, "first block\nsecond block");
});

test("extractPromptText handles OpenAI-style messages and bare prompt", () => {
  const text = extractPromptText({
    messages: [{ role: "user", content: "chat" }],
    prompt: "legacy completion prompt",
  });

  assert.equal(text, "chat\nlegacy completion prompt");
});

test("extractPromptText returns empty string for empty body", () => {
  assert.equal(extractPromptText(null), "");
  assert.equal(extractPromptText({}), "");
});

// ── evaluateRequest — synchronous rule paths ──────────────────────────

function policy(
  overrides: Partial<LoadedPolicy> & { runtime: LoadedPolicy["runtime"] }
): LoadedPolicy {
  return {
    policyId: overrides.policyId ?? "p1",
    policyName: overrides.policyName ?? "Test Policy",
    enforcement: overrides.enforcement ?? "BLOCK",
    runtime: overrides.runtime,
  };
}

test("evaluateRequest allows when no policies are loaded", async () => {
  const result = await evaluateRequest({
    policies: [],
    aiSystemId: null,
    model: "claude-sonnet-4",
    bodyJson: { messages: [] },
  });

  assert.equal(result.decision, "allow");
  assert.equal(result.violations.length, 0);
});

test("evaluateRequest denies on allowedModelsRuntime mismatch under BLOCK", async () => {
  const result = await evaluateRequest({
    policies: [policy({ runtime: { allowedModelsRuntime: ["claude-sonnet"] } })],
    aiSystemId: null,
    model: "gpt-4o",
    bodyJson: {},
  });

  assert.equal(result.decision, "deny");
  assert.equal(result.violations.length, 1);
  assert.equal(result.violations[0].ruleKey, "model_not_allowed");
});

test("evaluateRequest allows when model matches allowedModelsRuntime (case-insensitive substring)", async () => {
  const result = await evaluateRequest({
    policies: [policy({ runtime: { allowedModelsRuntime: ["CLAUDE-SONNET"] } })],
    aiSystemId: null,
    model: "claude-sonnet-4-20250514",
    bodyJson: {},
  });

  assert.equal(result.decision, "allow");
});

test("evaluateRequest denies on blockedModelsRuntime match", async () => {
  const result = await evaluateRequest({
    policies: [policy({ runtime: { blockedModelsRuntime: ["preview"] } })],
    aiSystemId: null,
    model: "claude-opus-4-preview",
    bodyJson: {},
  });

  assert.equal(result.decision, "deny");
  assert.equal(result.violations[0].ruleKey, "model_blocked");
});

test("evaluateRequest denies when max_tokens exceeds maxOutputTokens", async () => {
  const result = await evaluateRequest({
    policies: [policy({ runtime: { maxOutputTokens: 4096 } })],
    aiSystemId: null,
    model: "claude-sonnet-4",
    bodyJson: { max_tokens: 8192 },
  });

  assert.equal(result.decision, "deny");
  assert.equal(result.violations[0].ruleKey, "max_output_tokens_exceeded");
});

test("evaluateRequest allows when max_tokens is absent even with a cap set", async () => {
  const result = await evaluateRequest({
    policies: [policy({ runtime: { maxOutputTokens: 4096 } })],
    aiSystemId: null,
    model: "claude-sonnet-4",
    bodyJson: {},
  });

  assert.equal(result.decision, "allow");
});

test("evaluateRequest denies on blockedPromptPatterns match", async () => {
  const result = await evaluateRequest({
    policies: [
      policy({
        runtime: {
          blockedPromptPatterns: ["internal-token-\\d{10}", "password\\s*="],
        },
      }),
    ],
    aiSystemId: null,
    model: "claude-sonnet-4",
    bodyJson: {
      messages: [{ role: "user", content: "token: internal-token-0123456789" }],
    },
  });

  assert.equal(result.decision, "deny");
  assert.equal(result.violations[0].ruleKey, "prompt_pattern_blocked");
});

test("evaluateRequest allows when prompt matches no pattern", async () => {
  const result = await evaluateRequest({
    policies: [
      policy({ runtime: { blockedPromptPatterns: ["internal-token-\\d{10}"] } }),
    ],
    aiSystemId: null,
    model: "claude-sonnet-4",
    bodyJson: { messages: [{ role: "user", content: "hello there" }] },
  });

  assert.equal(result.decision, "allow");
});

test("evaluateRequest records ADVISORY violations without flipping decision to deny", async () => {
  const result = await evaluateRequest({
    policies: [
      policy({
        policyId: "p_advisory",
        policyName: "Advisory Policy",
        enforcement: "ADVISORY",
        runtime: { blockedModelsRuntime: ["preview"] },
      }),
    ],
    aiSystemId: null,
    model: "claude-opus-4-preview",
    bodyJson: {},
  });

  assert.equal(result.decision, "allow");
  assert.equal(result.violations.length, 1);
  assert.equal(result.violations[0].policyId, "p_advisory");
});

test("evaluateRequest denies when at least one BLOCK policy violates even if an ADVISORY also does", async () => {
  const result = await evaluateRequest({
    policies: [
      policy({
        policyId: "p_adv",
        enforcement: "ADVISORY",
        runtime: { blockedModelsRuntime: ["preview"] },
      }),
      policy({
        policyId: "p_block",
        enforcement: "BLOCK",
        runtime: { maxOutputTokens: 1000 },
      }),
    ],
    aiSystemId: null,
    model: "claude-opus-4-preview",
    bodyJson: { max_tokens: 5000 },
  });

  assert.equal(result.decision, "deny");
  assert.equal(result.violations.length, 2);
  const policyIds = result.violations.map((v) => v.policyId).sort();
  assert.deepEqual(policyIds, ["p_adv", "p_block"]);
});

test("evaluateRequest short-circuits rate/cost queries when no policy requires them", async () => {
  // If the lazy-query guard leaked, this would attempt a prisma.count() call
  // against an unreachable DB and throw. That it resolves proves the guard works.
  const result = await evaluateRequest({
    policies: [policy({ runtime: { allowedModelsRuntime: ["claude"] } })],
    aiSystemId: "sys_123",
    model: "claude-sonnet-4",
    bodyJson: {},
  });

  assert.equal(result.decision, "allow");
});

// ── Rate/cost window rules — deferred to integration tests ────────────

test.skip(
  "TODO: evaluateRequest rate/cost caps — need a DB or prisma mock to test",
  () => {}
);
