import test from "node:test";
import assert from "node:assert/strict";
import { buildComplianceIssues } from "./compliance-issues";

test("builds separate compliance issues from AI gap findings", () => {
  const issues = buildComplianceIssues({
    complianceStatus: "NON_COMPLIANT",
    gaps: [
      {
        requirement: "Human oversight",
        finding: "No documented approval checkpoint exists before external release.",
        priority: "HIGH",
      },
      {
        requirement: "Transparency",
        finding: "User disclosure language is missing from the current workflow.",
        priority: "MEDIUM",
      },
    ],
    evidence: "Assessment found multiple policy gaps.",
  });

  assert.equal(issues.length, 2);
  assert.equal(issues[0]?.severity, "HIGH");
  assert.equal(issues[1]?.requirement, "Transparency");
});

test("creates a fallback issue when analysis is non-compliant without structured gaps", () => {
  const issues = buildComplianceIssues({
    complianceStatus: "PARTIALLY_COMPLIANT",
    gaps: [],
    evidence: "Additional evidence is required to validate retention controls.",
  });

  assert.equal(issues.length, 1);
  assert.equal(issues[0]?.title, "Compliance follow-up required");
});
