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

test("agent approvals, overdue agent reviews, review-trigger alerts and agent incidents link to the agent", () => {
  const notifications = buildWorkflowNotifications({
    recentApprovals: [],
    expiringExceptions: [],
    driftAlerts: [],
    openIncidents: [
      { id: "inc-1", systemName: "Refund bot", title: "Refunded outside policy", openedAt: new Date("2026-09-30T10:00:00Z"), href: "/agents/a1#incidents" },
    ],
    overdueReviews: [],
    investigations: [],
    agentApprovals: [{ id: "ap-1", agentId: "a1", agentName: "Refund bot", decision: "CHANGES_REQUESTED", createdAt: new Date("2026-09-30T09:00:00Z") }],
    agentOverdueReviews: [{ id: "a2", agentName: "SOC bot", nextReviewDate: new Date("2026-09-01T00:00:00Z") }],
    reviewAlerts: [{ id: "al-1", title: "Human review required: Refund bot — Refund over $1,000", createdAt: new Date("2026-09-30T11:00:00Z") }],
  });
  const byId = Object.fromEntries(notifications.map((n) => [n.id, n]));
  assert.equal(byId["agent-approval-ap-1"].href, "/agents/a1#approval");
  assert.equal(byId["agent-approval-ap-1"].tone, "warning");
  assert.equal(byId["agent-overdue-a2"].href, "/agents/a2#approval");
  assert.equal(byId["review-al-1"].category, "incident");
  assert.equal(byId["review-al-1"].tone, "critical");
  assert.equal(byId["incident-inc-1"].href, "/agents/a1#incidents");
  // newest first
  assert.equal(notifications[0].id, "review-al-1");
});
