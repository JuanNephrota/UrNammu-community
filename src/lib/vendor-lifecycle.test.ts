import test from "node:test";
import assert from "node:assert/strict";
import { getVendorLifecycleSummary } from "./vendor-lifecycle";

test("marks active vendors inside notice window as renewal soon", () => {
  const summary = getVendorLifecycleSummary({
    contractStatus: "ACTIVE",
    contractStartDate: new Date("2026-01-01T00:00:00.000Z"),
    contractRenewalDate: new Date(Date.now() + 45 * 86400000),
    renewalNoticeDays: 60,
  });

  assert.equal(summary.phase, "RENEWAL_SOON");
  assert.equal(summary.badgeTone, "warning");
});

test("marks past-due renewal dates as overdue", () => {
  const summary = getVendorLifecycleSummary({
    contractStatus: "ACTIVE",
    contractStartDate: new Date("2025-01-01T00:00:00.000Z"),
    contractRenewalDate: new Date(Date.now() - 5 * 86400000),
    renewalNoticeDays: 60,
  });

  assert.equal(summary.phase, "OVERDUE");
  assert.equal(summary.badgeTone, "critical");
});
