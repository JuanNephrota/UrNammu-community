import test from "node:test";
import assert from "node:assert/strict";
import { computeAgentPosture, summarizePostures, tierOf, type PostureInput } from "./agent-posture";

const future = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

function governed(overrides: Partial<PostureInput> = {}): PostureInput {
  return {
    id: "agent_1",
    name: "Refund bot",
    status: "DEPLOYED",
    riskLevel: "HIGH",
    autonomyLevel: "HUMAN_IN_THE_LOOP",
    humanReviewRequired: true,
    humanReviewTriggersCount: 3,
    enforceableTriggersCount: 2,
    humanReviewEnforcement: "enforce",
    purpose: "Issue refunds under policy",
    inScopeActions: ["issue refund <= $100"],
    outOfScopeActions: ["change shipping address"],
    decisionBoundaries: "Refunds above $100 go to a human",
    successCriteria: "90% handled without escalation",
    aiSystemId: "sys_1",
    parentRiskAssessmentsCount: 1,
    riskReviewsCount: 0,
    mcpEnforcement: "enforce",
    mcpServerAllowlist: ["payments"],
    mcpToolAllowlist: [],
    unapprovedToolProfiles: 0,
    observedActivity: true,
    suspendedAt: null,
    technicalOwnerId: "u_tech",
    riskOwnerId: "u_risk",
    escalationContact: "#refunds-oncall",
    openIncidentsCount: 0,
    requireOwnerApproval: true,
    requireSecurityApproval: true,
    requireLegalApproval: false,
    requireComplianceApproval: true,
    governanceReviews: [
      { stage: "OWNER", approved: true },
      { stage: "SECURITY", approved: true },
      { stage: "COMPLIANCE", approved: true },
    ],
    latestApprovalDecision: "APPROVED",
    nextReviewDate: future,
    connectedSystemsCount: 2,
    toolArgumentTriggersCount: 2,
    baseline: { mature: true, findingsCount: 0 },
    ...overrides,
  };
}

test("a fully governed agent scores 100 on every dimension", () => {
  const posture = computeAgentPosture(governed());
  assert.equal(posture.overall, 100);
  assert.equal(posture.tier, "strong");
  for (const d of posture.dimensions) {
    assert.equal(d.score, 100, d.key);
    assert.equal(d.status, "strong");
    assert.deepEqual(d.gaps, []);
  }
});

test("a bare agent is weak with gaps that link to where they are fixed", () => {
  const posture = computeAgentPosture(
    governed({
      technicalOwnerId: null,
      riskOwnerId: null,
      escalationContact: null,
      mcpEnforcement: "monitor",
      mcpServerAllowlist: [],
      enforceableTriggersCount: 0,
      humanReviewTriggersCount: 0,
      toolArgumentTriggersCount: 0,
      humanReviewEnforcement: "monitor",
      purpose: null,
      inScopeActions: [],
      outOfScopeActions: [],
      decisionBoundaries: null,
      successCriteria: null,
      aiSystemId: null,
      parentRiskAssessmentsCount: 0,
      connectedSystemsCount: 0,
      governanceReviews: [],
      latestApprovalDecision: null,
      nextReviewDate: null,
      baseline: null,
    })
  );
  assert.equal(posture.tier, "weak");
  const byKey = Object.fromEntries(posture.dimensions.map((d) => [d.key, d]));
  assert.equal(byKey.ownership.score, 25); // business owner only
  assert.equal(byKey.authority.score, 0);
  assert.equal(byKey.boundaries.score, 0);
  assert.equal(byKey.responsibilities.score, 0);
  assert.equal(byKey.control.score, 0);
  assert.equal(byKey.decision_making.score, 30 + 20); // consistent + no incidents
  assert.ok(byKey.ownership.gaps.some((g) => g.href === "/agents/agent_1/edit#accountability"));
  assert.ok(byKey.boundaries.gaps.some((g) => g.text.startsWith("Charter missing: purpose")));
  assert.equal(posture.weakest.score, 0);
});

test("partial credit: charter thirds, stage-review fraction", () => {
  const posture = computeAgentPosture(
    governed({
      purpose: null, // 2 of 3 charter pieces
      governanceReviews: [{ stage: "OWNER", approved: true }], // 1 of 3 stages
    })
  );
  const byKey = Object.fromEntries(posture.dimensions.map((d) => [d.key, d]));
  assert.equal(byKey.boundaries.score, Math.round(50 * (2 / 3)) + 10 + 10 + 15 + 15);
  assert.equal(byKey.responsibilities.score, 40 + 10 + 30);
  assert.match(byKey.responsibilities.gaps[0].text, /2 of 3 stage reviews outstanding/);
});

test("authority rewards enforcement, not just configuration", () => {
  const monitored = computeAgentPosture(governed({ mcpEnforcement: "monitor", humanReviewEnforcement: "monitor" }));
  const authority = monitored.dimensions.find((d) => d.key === "authority")!;
  assert.equal(authority.score, 30 + 25);
  assert.deepEqual(
    authority.gaps.map((g) => g.text),
    ["Switch MCP enforcement from Monitor to Enforce", "Switch human-review enforcement to Enforce"]
  );
});

test("decision making penalises inconsistency, open incidents and unaddressed drift", () => {
  const posture = computeAgentPosture(
    governed({ humanReviewRequired: false, openIncidentsCount: 1, baseline: { mature: true, findingsCount: 2 } })
  );
  const dm = posture.dimensions.find((d) => d.key === "decision_making")!;
  assert.equal(dm.score, 30 + 10); // triggers + mature baseline
  assert.equal(dm.status, "weak");
});

test("control needs real thresholds, a mature baseline and a current review date", () => {
  const past = new Date(Date.now() - 1000);
  const posture = computeAgentPosture(governed({ toolArgumentTriggersCount: 0, nextReviewDate: past }));
  const control = posture.dimensions.find((d) => d.key === "control")!;
  assert.equal(control.score, 30);
  assert.ok(control.gaps.some((g) => /re-review/.test(g.text) && g.href.endsWith("#approval")));
});

test("tiers and portfolio roll-up", () => {
  assert.equal(tierOf(80), "strong");
  assert.equal(tierOf(55), "developing");
  assert.equal(tierOf(54), "weak");
  const strong = computeAgentPosture(governed());
  const weak = computeAgentPosture(governed({ latestApprovalDecision: null, governanceReviews: [], mcpServerAllowlist: [], purpose: null, inScopeActions: [], decisionBoundaries: null, baseline: null, toolArgumentTriggersCount: 0 }));
  const summary = summarizePostures([
    { id: "a", name: "A", posture: strong },
    { id: "b", name: "B", posture: weak },
  ]);
  assert.equal(summary.agents, 2);
  assert.equal(summary.average, Math.round((strong.overall + weak.overall) / 2));
  assert.equal(summary.tiers.strong, 1);
  assert.equal(summary.weakestAgents[0].id, "b");
  assert.ok(summary.dimensions[0].average <= summary.dimensions[5].average);
});
