import test from "node:test";
import assert from "node:assert/strict";
import { createAISystemSchema, updateAISystemSchema } from "./ai-system";

test("a partial update only carries the keys that were sent", () => {
  // Regression: `.partial()` of the create schema re-applied defaults, so this
  // update used to also reset riskLevel, status and every approval stage.
  assert.deepEqual(updateAISystemSchema.parse({ vendor: "Anthropic" }), { vendor: "Anthropic" });
});

test("an explicit empty string clears a nullable field on update", () => {
  assert.deepEqual(updateAISystemSchema.parse({ description: "  ", useCase: "Support" }), {
    description: null,
    useCase: "Support",
  });
  assert.equal(updateAISystemSchema.safeParse({ name: "" }).success, false);
});

test("create still applies defaults", () => {
  const parsed = createAISystemSchema.parse({ name: "Bot", department: "Ops" });
  assert.equal(parsed.riskLevel, "MEDIUM");
  assert.equal(parsed.status, "DRAFT");
  assert.equal(parsed.requireSecurityApproval, true);
  assert.equal(parsed.description, undefined);
});
