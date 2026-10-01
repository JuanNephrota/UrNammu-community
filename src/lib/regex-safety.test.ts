import test from "node:test";
import assert from "node:assert/strict";
import { isSafeRuntimePattern } from "./regex-safety";
import { parsePolicyRules } from "./policy-rules";

// The catastrophic patterns are built at runtime: isSafeRuntimePattern rejects
// them by shape before anything compiles or runs them, but CodeQL's js/redos
// flags the literals as if they were executed.
const nested = (atom: string, inner: string, outer: string) => `(${atom}${inner})${outer}`;
const NESTED_PLUS = nested("a", "+", "+") + "$";
const NESTED_DOTSTAR = nested(".", "*", "+") + "x";
const NESTED_WORD = nested("\\w", "*", "*");
const NESTED_ALT = nested("a|a", "", "+");

test("nested-quantifier and oversized patterns are unsafe", () => {
  for (const p of [NESTED_PLUS, NESTED_DOTSTAR, NESTED_WORD, NESTED_ALT, "x".repeat(501), "[unclosed", ""]) {
    assert.equal(isSafeRuntimePattern(p), false, p);
  }
});

test("ordinary patterns are safe", () => {
  for (const p of ["password\\s*[:=]", "\\b\\d{3}-\\d{2}-\\d{4}\\b", "secret|token"]) {
    assert.equal(isSafeRuntimePattern(p), true, p);
  }
});

test("policy save drops a catastrophic blocked pattern", () => {
  const rules = parsePolicyRules({ runtime: { blockedPromptPatterns: [NESTED_PLUS, "secret"] } } as never);
  assert.deepEqual(rules?.runtime?.blockedPromptPatterns, ["secret"]);
});
