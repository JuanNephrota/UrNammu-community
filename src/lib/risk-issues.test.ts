import test from "node:test";
import assert from "node:assert/strict";
import { generateAssessmentIssues } from "./risk-issues";

test("creates separate issues for each high-risk assessment dimension", () => {
  const issues = generateAssessmentIssues({
    scores: {
      biasScore: 25,
      securityScore: 78,
      privacyScore: 82,
      fairnessScore: 20,
      performanceScore: 30,
      transparencyScore: 61,
    },
    justifications: {
      securityScore: "The system lacks prompt-injection protections for external input.",
      privacyScore: "Restricted customer data is retained longer than documented.",
      transparencyScore: "Users do not get a clear explanation when the model declines or escalates.",
    },
  });

  assert.equal(issues.length, 3);
  assert.deepEqual(
    issues.map((issue) => issue.category),
    ["security", "privacy", "transparency"]
  );
  assert.equal(issues[0]?.severity, "HIGH");
  assert.equal(issues[1]?.severity, "CRITICAL");
});

test("falls back to notes when no high-score dimensions exist but follow-up is documented", () => {
  const issues = generateAssessmentIssues({
    scores: {
      biasScore: 20,
      securityScore: 25,
      privacyScore: 30,
      fairnessScore: 15,
      performanceScore: 35,
      transparencyScore: 20,
    },
    notes:
      "The system should add reviewer guidance before deployment. Monitoring needs a clearer escalation path.",
  });

  assert.equal(issues.length, 2);
  assert.equal(issues[0]?.category, "assessment_follow_up");
});
