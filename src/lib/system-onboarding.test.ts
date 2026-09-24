import test from "node:test";
import assert from "node:assert/strict";
import { getSystemChecklist, isExternalVendor, type SystemChecklistInput } from "./system-onboarding";
import { checklistProgress } from "./workflow";

const base: SystemChecklistInput = {
  id: "sys_1",
  description: null,
  useCase: null,
  vendor: null,
  modelType: null,
  dataInputs: null,
  dataOutputs: null,
  riskAssessmentsCount: 0,
  hasEuAiActClassification: false,
  policyAssignmentsCount: 0,
  evidenceCount: 0,
  requiredStages: ["OWNER", "SECURITY"],
  approvedStages: [],
  latestApprovalDecision: null,
  vendorProfile: null,
};

test("in-house vendors need no vendor profile", () => {
  assert.equal(isExternalVendor("Internal"), false);
  assert.equal(isExternalVendor(" in-house "), false);
  assert.equal(isExternalVendor(null), false);
  assert.equal(isExternalVendor("Anthropic"), true);
  const ids = getSystemChecklist({ ...base, vendor: "Internal" }).map((item) => item.id);
  assert.ok(!ids.includes("vendor"));
});

test("an external vendor without a profile links to Add vendor, prefilled", () => {
  const vendor = getSystemChecklist({ ...base, vendor: "Acme AI" }).find((item) => item.id === "vendor");
  assert.equal(vendor?.done, false);
  assert.equal(vendor?.href, "/oversight/vendors/new?vendor=Acme%20AI");
});

test("a rejected vendor keeps the vendor item open", () => {
  const vendor = getSystemChecklist({
    ...base,
    vendor: "Acme AI",
    vendorProfile: { id: "vp_1", securityReviewStatus: "REJECTED" },
  }).find((item) => item.id === "vendor");
  assert.equal(vendor?.done, false);
  assert.match(vendor?.detail ?? "", /rejected/);
  assert.equal(vendor?.href, "/oversight/vendors/vp_1");
});

test("a new system starts at describe and a fully governed one is complete", () => {
  assert.equal(checklistProgress(getSystemChecklist(base)).next?.id, "describe");

  const done = getSystemChecklist({
    ...base,
    description: "Support bot",
    useCase: "Answer tickets",
    vendor: "Acme AI",
    dataInputs: "Tickets",
    dataOutputs: "Draft replies",
    riskAssessmentsCount: 1,
    hasEuAiActClassification: true,
    policyAssignmentsCount: 2,
    evidenceCount: 1,
    approvedStages: ["OWNER", "SECURITY"],
    latestApprovalDecision: "APPROVED",
    vendorProfile: { id: "vp_1", securityReviewStatus: "CONDITIONAL" },
  });
  assert.equal(checklistProgress(done).complete, true);
});

test("the reviews item lists the stages still missing, and is omitted when none are required", () => {
  const reviews = getSystemChecklist({ ...base, approvedStages: ["OWNER"] }).find((i) => i.id === "reviews");
  assert.equal(reviews?.detail, "Waiting on: Security.");
  assert.ok(!getSystemChecklist({ ...base, requiredStages: [] }).some((i) => i.id === "reviews"));
});
