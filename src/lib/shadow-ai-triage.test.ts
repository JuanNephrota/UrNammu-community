import test from "node:test";
import assert from "node:assert/strict";
import { broadScopes, getTriageRecommendation, type TriageSignals } from "./shadow-ai-triage";

const quiet: TriageSignals = { riskHints: [], scopes: [], userCount: 2, vendorReviewStatus: null };

test("a rejected vendor is blocked whatever the answers", () => {
  const rec = getTriageRecommendation(
    { dataExposure: "none", businessNeed: "yes", approvedAlternative: "no" },
    { ...quiet, vendorReviewStatus: "REJECTED" }
  );
  assert.equal(rec.outcome, "block");
});

test("no business need, or an approved alternative with data exposure, means block", () => {
  assert.equal(getTriageRecommendation({ businessNeed: "no" }, quiet).outcome, "block");
  assert.equal(
    getTriageRecommendation(
      { dataExposure: "internal", businessNeed: "yes", approvedAlternative: "yes" },
      quiet
    ).outcome,
    "block"
  );
});

test("customer data in a tool that trains on prompts is blocked, not registered", () => {
  const rec = getTriageRecommendation(
    { dataExposure: "customer", businessNeed: "yes", approvedAlternative: "no" },
    { ...quiet, riskHints: ["trains_on_data"] }
  );
  assert.equal(rec.outcome, "block");
  assert.match(rec.reasons[0], /trains on prompts/);
});

test("customer data, unknown data or broad OAuth scopes mean register", () => {
  const needed = { businessNeed: "yes", approvedAlternative: "no" } as const;
  assert.equal(getTriageRecommendation({ ...needed, dataExposure: "customer" }, quiet).outcome, "register");
  assert.equal(getTriageRecommendation({ ...needed, dataExposure: "unknown" }, quiet).outcome, "register");
  const scoped = getTriageRecommendation(
    { ...needed, dataExposure: "none" },
    { ...quiet, scopes: ["https://www.googleapis.com/auth/drive.readonly", "openid"] }
  );
  assert.equal(scoped.outcome, "register");
  assert.ok(scoped.reasons.some((reason) => reason.includes("drive.readonly")));
});

test("a needed tool that sees no company data can be approved", () => {
  const rec = getTriageRecommendation(
    { dataExposure: "none", businessNeed: "yes", approvedAlternative: "no" },
    quiet
  );
  assert.equal(rec.outcome, "approve");
});

test("internal data with a need defaults to register", () => {
  const rec = getTriageRecommendation(
    { dataExposure: "internal", businessNeed: "yes", approvedAlternative: "no" },
    { ...quiet, userCount: 40 }
  );
  assert.equal(rec.outcome, "register");
  assert.ok(rec.reasons.some((reason) => reason.includes("40 people")));
});

test("broadScopes ignores sign-in-only scopes", () => {
  assert.deepEqual(broadScopes(["openid", "email", "profile"]), []);
  assert.deepEqual(broadScopes(["Mail.Read", "User.Read"]), ["Mail.Read"]);
});
