import test from "node:test";
import assert from "node:assert/strict";
import { getVendorRiskSummary } from "./vendor-risk";

test("vendor risk scoring escalates with weak contract and security posture plus incidents", () => {
  const summary = getVendorRiskSummary({
    vendor: "Example AI",
    systems: 3,
    openAlerts: 4,
    incidents: 2,
    exceptions: 1,
    highRisk: 2,
    discovered: 5,
    unapprovedUseCases: 2,
    contractStatus: "EXPIRED",
    securityReviewStatus: "CONDITIONAL",
    contractRenewalDate: new Date(Date.now() - 86400000),
  });

  assert.equal(summary.tier, "CRITICAL");
  assert.equal(summary.score >= 80, true);
  assert.equal(summary.factors.some((factor) => factor.label === "Contract expired"), true);
  assert.equal(summary.factors.some((factor) => factor.label === "Open incidents"), true);
});

test("vendor risk scoring stays low when posture is healthy", () => {
  const summary = getVendorRiskSummary({
    vendor: "Stable AI",
    systems: 2,
    openAlerts: 0,
    incidents: 0,
    exceptions: 0,
    highRisk: 0,
    discovered: 1,
    unapprovedUseCases: 0,
    contractStatus: "ACTIVE",
    securityReviewStatus: "APPROVED",
    contractRenewalDate: new Date(Date.now() + 90 * 86400000),
  });

  assert.equal(summary.tier, "LOW");
  assert.equal(summary.factors.length, 0);
});
