import test from "node:test";
import assert from "node:assert/strict";
import { buildWorkflowNotifications } from "./workflow-notifications";

test("builds workflow notifications across approvals, drift, and overdue reviews", () => {
  const notifications = buildWorkflowNotifications({
    recentApprovals: [
      {
        id: "approval-1",
        systemName: "Payroll Copilot",
        decision: "APPROVED",
        createdAt: new Date("2026-04-12T12:00:00Z"),
      },
    ],
    expiringExceptions: [],
    driftAlerts: [
      {
        id: "alert-1",
        title: "System drift detected",
        createdAt: new Date("2026-04-12T13:00:00Z"),
      },
    ],
    openIncidents: [],
    overdueReviews: [
      {
        id: "sys-1",
        systemName: "Expense Assistant",
        nextReviewDate: new Date("2026-04-10T00:00:00Z"),
      },
    ],
    investigations: [],
  });

  assert.equal(notifications.length, 3);
  assert.equal(notifications[0]?.category, "drift");
  assert.equal(notifications.some((item) => item.category === "overdue"), true);
});
