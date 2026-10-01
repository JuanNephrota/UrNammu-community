import test from "node:test";
import assert from "node:assert/strict";
import {
  countHumanReviewTriggers,
  getAgentApprovalBlockers,
  getAgentApprovedStages,
  getAgentChecklist,
  getAgentRequiredStages,
  getAgentWorkflowSummary,
  getCharterStatus,
  isHardAgentBlocker,
  type AgentGovernanceInput,
} from "./agent-governance";
import { checklistProgress } from "./workflow";

const future = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
const past = new Date(Date.now() - 24 * 60 * 60 * 1000);

/** A fully governed HITL agent: no blockers at all. */
function governed(overrides: Partial<AgentGovernanceInput> = {}): AgentGovernanceInput {
  return {
    id: "agent_1",
    name: "Refund bot",
    status: "UNDER_REVIEW",
    riskLevel: "MEDIUM",
    autonomyLevel: "HUMAN_IN_THE_LOOP",
    humanReviewRequired: true,
    humanReviewTriggersCount: 2,
    enforceableTriggersCount: 2,
    humanReviewEnforcement: "enforce",
    purpose: "Issue refunds under policy",
    inScopeActions: ["lookup order", "issue refund <= $100"],
    outOfScopeActions: ["change shipping address"],
    decisionBoundaries: "Refunds above $100 go to a human",
    successCriteria: "90% of eligible refunds handled without escalation",
    aiSystemId: "sys_1",
    parentRiskAssessmentsCount: 1,
    riskReviewsCount: 0,
    mcpEnforcement: "monitor",
    mcpServerAllowlist: [],
    mcpToolAllowlist: [],
    unapprovedToolProfiles: 0,
    observedActivity: true,
    suspendedAt: null,
    requireOwnerApproval: true,
    requireSecurityApproval: true,
    requireLegalApproval: false,
    requireComplianceApproval: true,
    governanceReviews: [
      { stage: "OWNER", approved: true },
      { stage: "SECURITY", approved: true },
      { stage: "COMPLIANCE", approved: true },
    ],
    latestApprovalDecision: null,
    nextReviewDate: future,
    ...overrides,
  };
}

const categories = (input: AgentGovernanceInput, hardOnly = false) =>
  getAgentApprovalBlockers(input)
    .filter((b) => !hardOnly || isHardAgentBlocker(b))
    .map((b) => b.category);

// ── helpers ──────────────────────────────────────────────────────────

test("countHumanReviewTriggers handles list, string, object and null", () => {
  assert.equal(countHumanReviewTriggers(null), 0);
  assert.equal(countHumanReviewTriggers(["a", "", null]), 1);
  assert.equal(countHumanReviewTriggers("amount > 1000"), 1);
  assert.equal(countHumanReviewTriggers("   "), 0);
  assert.equal(countHumanReviewTriggers({ amount: 1000, pii: true }), 2);
});

test("required stages follow the four toggles", () => {
  assert.deepEqual(getAgentRequiredStages(governed()), ["OWNER", "SECURITY", "COMPLIANCE"]);
  assert.deepEqual(
    getAgentRequiredStages(governed({ requireLegalApproval: true, requireSecurityApproval: false })),
    ["OWNER", "LEGAL", "COMPLIANCE"]
  );
});

test("latest decision per stage wins (newest first)", () => {
  const approved = getAgentApprovedStages([
    { stage: "OWNER", approved: false },
    { stage: "OWNER", approved: true },
    { stage: "SECURITY", approved: true },
  ]);
  assert.deepEqual([...approved].sort(), ["SECURITY"]);
});

test("charter status distinguishes required from recommended", () => {
  const s = getCharterStatus({
    purpose: "",
    inScopeActions: ["  "],
    outOfScopeActions: [],
    decisionBoundaries: "x",
    successCriteria: null,
  });
  assert.equal(s.complete, false);
  assert.deepEqual(s.missing, ["purpose", "in-scope actions"]);
  assert.deepEqual(s.recommended, ["out-of-scope actions", "success criteria"]);
});

// ── blockers ─────────────────────────────────────────────────────────

test("a fully governed agent has no blockers", () => {
  assert.deepEqual(getAgentApprovalBlockers(governed()), []);
});

test("incomplete charter is a hard blocker; optional fields only a soft one", () => {
  assert.deepEqual(categories(governed({ purpose: null }), true), ["charter"]);
  const soft = getAgentApprovalBlockers(governed({ successCriteria: null }));
  assert.equal(soft.length, 1);
  assert.equal(soft[0].category, "charter");
  assert.equal(soft[0].soft, true);
});

test("suspended agents cannot be approved", () => {
  const blockers = getAgentApprovalBlockers(governed({ suspendedAt: new Date() }));
  assert.ok(blockers.some((b) => b.category === "suspended" && !b.soft));
});

test("FULL_AUTONOMY requires enforce mode with an allowlist; SUPERVISED only recommends it", () => {
  const full = governed({ autonomyLevel: "FULL_AUTONOMY", humanReviewRequired: false });
  assert.deepEqual(categories(full, true), ["autonomy_controls"]);
  const enforced = governed({
    autonomyLevel: "FULL_AUTONOMY",
    humanReviewRequired: false,
    mcpEnforcement: "enforce",
    mcpServerAllowlist: ["payments"],
  });
  assert.deepEqual(getAgentApprovalBlockers(enforced), []);
  // enforce mode with an EMPTY allowlist is not enforcement
  const emptyList = governed({ autonomyLevel: "FULL_AUTONOMY", humanReviewRequired: false, mcpEnforcement: "enforce" });
  assert.deepEqual(categories(emptyList, true), ["autonomy_controls"]);
  const supervised = getAgentApprovalBlockers(governed({ autonomyLevel: "SUPERVISED", humanReviewRequired: false }));
  assert.equal(supervised.length, 1);
  assert.equal(supervised[0].category, "autonomy_controls");
  assert.equal(supervised[0].soft, true);
});

test("human-review inconsistencies are soft", () => {
  const contradiction = getAgentApprovalBlockers(governed({ humanReviewRequired: false }));
  assert.deepEqual(contradiction.map((b) => [b.category, b.soft]), [["human_review", true]]);
  const noTriggers = getAgentApprovalBlockers(governed({ humanReviewTriggersCount: 0, enforceableTriggersCount: 0 }));
  assert.deepEqual(noTriggers.map((b) => [b.category, b.soft]), [["human_review", true]]);
  assert.match(noTriggers[0].message, /no triggers are declared/);
  const notesOnly = getAgentApprovalBlockers(governed({ humanReviewTriggersCount: 2, enforceableTriggersCount: 0 }));
  assert.match(notesOnly[0].message, /notes only/);
  const monitored = getAgentApprovalBlockers(governed({ humanReviewEnforcement: "monitor" }));
  assert.deepEqual(monitored.map((b) => [b.category, b.soft]), [["human_review", true]]);
  assert.match(monitored[0].message, /only monitored/);
  // FULL_AUTONOMY has no human loop, so monitor-only triggers are not flagged there.
  const full = getAgentApprovalBlockers(
    governed({ autonomyLevel: "FULL_AUTONOMY", humanReviewRequired: false, humanReviewEnforcement: "monitor", mcpEnforcement: "enforce", mcpServerAllowlist: ["x"] })
  );
  assert.deepEqual(full, []);
});

test("risk basis: HIGH/CRITICAL hard-block without one; MEDIUM is only nudged; an agent risk review counts", () => {
  const high = governed({ riskLevel: "HIGH", parentRiskAssessmentsCount: 0 });
  assert.deepEqual(categories(high, true), ["risk"]);
  assert.match(getAgentApprovalBlockers(high)[0].href ?? "", /systemId=sys_1/);
  const medium = getAgentApprovalBlockers(governed({ parentRiskAssessmentsCount: 0 }));
  assert.deepEqual(medium.map((b) => [b.category, b.soft]), [["risk", true]]);
  const reviewed = governed({ riskLevel: "CRITICAL", parentRiskAssessmentsCount: 0, riskReviewsCount: 1 });
  assert.deepEqual(getAgentApprovalBlockers(reviewed), []);
  const orphanHigh = getAgentApprovalBlockers(
    governed({ riskLevel: "HIGH", aiSystemId: null, parentRiskAssessmentsCount: 0 })
  );
  assert.deepEqual(orphanHigh.map((b) => b.category).sort(), ["parent_system", "risk"]);
  assert.match(orphanHigh.find((b) => b.category === "risk")?.href ?? "", /#risk$/);
});

test("missing stage reviews hard-block and name the stages", () => {
  const blockers = getAgentApprovalBlockers(
    governed({ governanceReviews: [{ stage: "OWNER", approved: true }, { stage: "SECURITY", approved: false }] })
  );
  assert.equal(blockers.length, 1);
  assert.equal(blockers[0].category, "stage_review");
  assert.equal(blockers[0].soft, false);
  assert.match(blockers[0].message, /Security, Compliance/);
});

test("review date: missing and overdue are both hard", () => {
  assert.deepEqual(categories(governed({ nextReviewDate: null }), true), ["review_date"]);
  assert.deepEqual(categories(governed({ nextReviewDate: past }), true), ["review_date"]);
});

test("unapproved observed tools are a soft nudge", () => {
  const blockers = getAgentApprovalBlockers(governed({ unapprovedToolProfiles: 3 }));
  assert.deepEqual(blockers.map((b) => [b.category, b.soft]), [["mcp_unapproved", true]]);
  assert.match(blockers[0].message, /3 observed MCP servers or tools are/);
});

// ── workflow summary ────────────────────────────────────────────────

test("workflow: ready → record approval; approved+deployed → monitored", () => {
  const ready = getAgentWorkflowSummary(governed());
  assert.equal(ready.readiness, "ready");
  assert.equal(ready.stage, "Approval Review");
  assert.equal(ready.actions[0].label, "Record approval decision");

  const monitored = getAgentWorkflowSummary(
    governed({ status: "DEPLOYED", latestApprovalDecision: "APPROVED", unapprovedToolProfiles: 1 })
  );
  assert.equal(monitored.readiness, "monitored");
  assert.deepEqual(
    monitored.actions.map((a) => a.label),
    ["Review MCP activity and denials", "Triage unapproved tools"]
  );
});

test("workflow: blocked states take precedence in order", () => {
  assert.equal(getAgentWorkflowSummary(governed({ latestApprovalDecision: "CHANGES_REQUESTED" })).stage, "Changes Requested");
  assert.equal(getAgentWorkflowSummary(governed({ latestApprovalDecision: "REVOKED" })).stage, "Approval Revoked");
  assert.equal(getAgentWorkflowSummary(governed({ suspendedAt: new Date() })).stage, "Suspended");
  assert.equal(getAgentWorkflowSummary(governed({ nextReviewDate: past })).stage, "Review Overdue");
  const intake = getAgentWorkflowSummary(governed({ status: "DRAFT", purpose: null }));
  assert.equal(intake.stage, "Intake");
  assert.equal(intake.readiness, "in_progress");
  assert.match(intake.message, /1 item must be resolved/);
});

// ── checklist ────────────────────────────────────────────────────────

test("checklist reflects blockers and approval; optional items don't count", () => {
  const items = getAgentChecklist(governed({ aiSystemId: null, parentRiskAssessmentsCount: 0, riskReviewsCount: 1 }));
  const byId = Object.fromEntries(items.map((i) => [i.id, i]));
  assert.equal(byId.charter.done, true);
  assert.equal(byId.parent.done, false);
  assert.equal(byId.parent.optional, true);
  assert.equal(byId.risk.done, true);
  assert.equal(byId.stages.done, true);
  assert.equal(byId.approval.done, false);
  const progress = checklistProgress(items);
  assert.equal(progress.total, 5);
  assert.equal(progress.done, 4);
  assert.equal(progress.next?.id, "approval");

  const done = getAgentChecklist(governed({ latestApprovalDecision: "APPROVED", status: "APPROVED" }));
  assert.equal(checklistProgress(done).complete, true);
});
