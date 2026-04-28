import test from "node:test";
import assert from "node:assert/strict";
import { evaluatePolicyRules, normalizePolicyRules, parsePolicyRules } from "./policy-rules";

test("normalizes richer policy rule inputs", () => {
  const rules = normalizePolicyRules({
    allowedVendors: "OpenAI, Anthropic",
    blockedVendors: "Personal GPT",
    allowedDepartments: "Engineering, Legal",
    blockedDepartments: "Interns",
    allowedModelPatterns: "gpt-4, claude-sonnet",
    blockedModelPatterns: "preview",
    allowedStatuses: ["UNDER_REVIEW", "APPROVED"],
    maxDataSensitivity: "CONFIDENTIAL",
    blockedDataSensitivities: ["RESTRICTED"],
    requiredStages: ["OWNER", "SECURITY"],
    maxReviewIntervalDays: 180,
    minimumRiskLevel: "MEDIUM",
    enforcement: "BLOCK",
    allowException: true,
    recommendedComplianceStatus: "NON_COMPLIANT",
  });

  assert.deepEqual(rules, parsePolicyRules(rules));
});

test("normalizes runtime rules and round-trips through parsePolicyRules", () => {
  const rules = normalizePolicyRules({
    allowedModelsRuntime: "claude-sonnet-4, claude-opus-4",
    blockedModelsRuntime: "preview",
    maxOutputTokens: 4096,
    maxRequestsPerMinute: 60,
    maxCostPerDay: 50.0,
    blockedPromptPatterns: "sk-[a-z0-9]{20,}\npassword\\s*=",
  });

  assert.ok(rules);
  assert.ok(rules?.runtime);
  assert.deepEqual(rules?.runtime?.allowedModelsRuntime, [
    "claude-sonnet-4",
    "claude-opus-4",
  ]);
  assert.equal(rules?.runtime?.maxOutputTokens, 4096);
  assert.equal(rules?.runtime?.maxRequestsPerMinute, 60);
  assert.equal(rules?.runtime?.maxCostPerDay, 50.0);
  assert.deepEqual(rules?.runtime?.blockedPromptPatterns, [
    "sk-[a-z0-9]{20,}",
    "password\\s*=",
  ]);

  assert.deepEqual(rules, parsePolicyRules(rules));
});

test("drops invalid regex patterns from blockedPromptPatterns", () => {
  const rules = normalizePolicyRules({
    blockedPromptPatterns: "valid\\d+\n[unterminated\nalso-valid",
  });

  assert.deepEqual(rules?.runtime?.blockedPromptPatterns, [
    "valid\\d+",
    "also-valid",
  ]);
});

test("ignores non-positive numeric runtime bounds", () => {
  const rules = normalizePolicyRules({
    maxOutputTokens: 0,
    maxRequestsPerMinute: -1,
    maxCostPerDay: 0,
  });

  assert.equal(rules, null);
});

test("waives blocking findings when policy allows exceptions and system has one", () => {
  const evaluation = evaluatePolicyRules(
    parsePolicyRules({
      blockedVendors: ["OpenAI"],
      actions: { enforcement: "BLOCK", allowException: true },
    }),
    {
      vendor: "OpenAI",
      department: "Engineering",
      status: "UNDER_REVIEW",
      modelType: "gpt-4.1",
      dataSensitivity: "INTERNAL",
      reviewIntervalDays: 90,
      riskLevel: "MEDIUM",
      requireOwnerApproval: true,
      requireSecurityApproval: true,
      requireLegalApproval: false,
      requireComplianceApproval: true,
      activeExceptionCount: 1,
    }
  );

  assert.equal(evaluation.blockingViolations.length, 0);
  assert.equal(evaluation.waivedViolations.length, 1);
  assert.equal(evaluation.recommendedComplianceStatus, "PARTIALLY_COMPLIANT");
});

test("advisory policies do not create blocking violations", () => {
  const evaluation = evaluatePolicyRules(
    parsePolicyRules({
      allowedModelPatterns: ["claude-sonnet"],
      actions: { enforcement: "ADVISORY" },
    }),
    {
      vendor: "Anthropic",
      department: "Engineering",
      status: "APPROVED",
      modelType: "claude-haiku",
      dataSensitivity: "INTERNAL",
      reviewIntervalDays: 90,
      riskLevel: "MEDIUM",
      requireOwnerApproval: true,
      requireSecurityApproval: true,
      requireLegalApproval: false,
      requireComplianceApproval: true,
      activeExceptionCount: 0,
    }
  );

  assert.equal(evaluation.blockingViolations.length, 0);
  assert.equal(evaluation.advisories.length, 1);
  assert.equal(evaluation.recommendedComplianceStatus, "PARTIALLY_COMPLIANT");
});
