import test from "node:test";
import assert from "node:assert/strict";
import { getVendorChecklist, type VendorChecklistInput } from "./vendor-onboarding";
import { checklistProgress, resolveStepId } from "./workflow";
import { patchVendorProfileSchema } from "./validations/vendor-profile";

const now = new Date("2026-09-23T12:00:00Z");

const empty: VendorChecklistInput = {
  id: "vp_1",
  website: null,
  description: null,
  contractOwner: null,
  contractStatus: "UNKNOWN",
  contractRenewalDate: null,
  dataResidency: [],
  subprocessors: [],
  approvedUseCases: [],
  securityReviewStatus: "NOT_REVIEWED",
  lastAssessmentCompletedAt: null,
  assessmentInProgress: false,
};

test("a new vendor starts with nothing done and points at identity first", () => {
  const items = getVendorChecklist(empty, now);
  const progress = checklistProgress(items);
  assert.equal(progress.done, 0);
  assert.equal(progress.next?.id, "identity");
  assert.equal(progress.next?.href, "/oversight/vendors/vp_1/setup?step=identity");
});

test("a fully documented vendor with a recent questionnaire is complete", () => {
  const items = getVendorChecklist(
    {
      ...empty,
      website: "https://example.ai/",
      description: "LLM API",
      contractOwner: "Legal",
      contractStatus: "ACTIVE",
      contractRenewalDate: new Date("2027-01-01"),
      dataResidency: ["US"],
      subprocessors: ["AWS"],
      approvedUseCases: ["Code generation"],
      securityReviewStatus: "APPROVED",
      lastAssessmentCompletedAt: new Date("2026-09-01"),
    },
    now
  );
  assert.equal(checklistProgress(items).complete, true);
});

test("a questionnaire older than a year is stale, and an in-progress one is not done", () => {
  const stale = getVendorChecklist(
    { ...empty, lastAssessmentCompletedAt: new Date("2025-06-01") },
    now
  ).find((item) => item.id === "questionnaire");
  assert.equal(stale?.done, false);
  assert.match(stale?.detail ?? "", /Re-assess/);

  const inProgress = getVendorChecklist(
    { ...empty, assessmentInProgress: true },
    now
  ).find((item) => item.id === "questionnaire");
  assert.equal(inProgress?.done, false);
  assert.match(inProgress?.detail ?? "", /in progress/);
});

test("starting a re-assessment keeps a current completed questionnaire ticked", () => {
  const item = getVendorChecklist(
    { ...empty, lastAssessmentCompletedAt: new Date("2026-09-01"), assessmentInProgress: true },
    now
  ).find((entry) => entry.id === "questionnaire");
  assert.equal(item?.done, true);
  assert.match(item?.detail ?? "", /re-assessment is in progress/);
});

test("resolveStepId falls back to the first step for unknown values", () => {
  const steps = [{ id: "a" }, { id: "b" }] as const;
  assert.equal(resolveStepId(steps, "b"), "b");
  assert.equal(resolveStepId(steps, "zzz"), "a");
  assert.equal(resolveStepId(steps, undefined), "a");
  assert.equal(resolveStepId(steps, ["b", "a"]), "b");
});

test("patch schema only emits keys that were sent", () => {
  const parsed = patchVendorProfileSchema.parse({ contractOwner: "Legal", dataResidency: ["US", " EU "] });
  assert.deepEqual(Object.keys(parsed).sort(), ["contractOwner", "dataResidency"]);
  assert.deepEqual(parsed.dataResidency, ["US", "EU"]);

  const cleared = patchVendorProfileSchema.parse({ contractRenewalDate: "", website: "example.ai" });
  assert.equal(cleared.contractRenewalDate, null);
  assert.equal(cleared.website, "https://example.ai/");

  assert.equal(patchVendorProfileSchema.safeParse({ vendor: "Renamed" }).success, false);
  assert.equal(patchVendorProfileSchema.safeParse({ contractStartDate: "not a date" }).success, false);
});
