import { test } from "node:test";
import assert from "node:assert/strict";
import {
  EMPTY_ANSWERS,
  checkCompleteness,
  classifyEuAiAct,
  describeDeadline,
  normalizeAnswers,
  type EuAiActAnswers,
} from "./eu-ai-act";

function answers(overrides: Partial<EuAiActAnswers>): EuAiActAnswers {
  return { ...EMPTY_ANSWERS, role: "DEPLOYER", annexIProduct: false, usesGpai: false, providesGpai: false, ...overrides };
}

test("completeness requires role, Annex I answer, GPAI answer, and profiling when derogation is attempted", () => {
  assert.deepEqual(checkCompleteness(EMPTY_ANSWERS).missing, ["role", "annexIProduct", "usesGpai"]);
  assert.equal(checkCompleteness(answers({})).complete, true);
  const derog = answers({ annexIIICategories: ["employment"], derogationGrounds: ["narrow_procedural"] });
  assert.deepEqual(checkCompleteness(derog).missing, ["profiling"]);
  assert.equal(checkCompleteness({ ...derog, profiling: false }).complete, true);
});

test("any prohibited practice yields PROHIBITED and only Art. 4/5 obligations", () => {
  const r = classifyEuAiAct(
    answers({ role: "PROVIDER", prohibitedPractices: ["social_scoring"], annexIIICategories: ["employment"], transparencyTriggers: ["interacts_with_persons"] })
  );
  assert.equal(r.tier, "PROHIBITED");
  assert.deepEqual(r.applicableArticles, ["Art. 4", "Art. 5", "Art. 50"]);
  assert.equal(r.deadline?.date, "2025-02-02");
});

test("Annex I product is high-risk with no derogation and the 2027 deadline", () => {
  const r = classifyEuAiAct(
    answers({ role: "PROVIDER", annexIProduct: true, annexIIICategories: ["biometrics"], derogationGrounds: ["narrow_procedural"], profiling: false })
  );
  assert.equal(r.tier, "HIGH_RISK");
  assert.equal(r.derogationClaimed, false);
  assert.equal(r.deadline?.date, "2027-08-02");
  assert.ok(r.applicableArticles.includes("Art. 43"));
});

test("Annex III deployer is high-risk with deployer obligations and 2026 deadline", () => {
  const r = classifyEuAiAct(answers({ role: "DEPLOYER", annexIIICategories: ["essential_services"], friaTriggers: ["credit_scoring"] }));
  assert.equal(r.tier, "HIGH_RISK");
  assert.equal(r.friaRequired, true);
  assert.deepEqual(r.applicableArticles, ["Art. 4", "Art. 12", "Art. 14", "Art. 26", "Art. 27", "Art. 73"]);
  assert.equal(r.deadline?.date, "2026-08-02");
  // Provider-only articles are not imposed on a pure deployer.
  assert.equal(r.applicableArticles.includes("Art. 9"), false);
  assert.equal(r.applicableArticles.includes("Art. 17"), false);
});

test("provider-and-deployer of an Annex III system gets both obligation sets", () => {
  const r = classifyEuAiAct(answers({ role: "PROVIDER_AND_DEPLOYER", annexIIICategories: ["employment"] }));
  assert.equal(r.tier, "HIGH_RISK");
  for (const code of ["Art. 9", "Art. 10", "Art. 11", "Art. 12", "Art. 13", "Art. 14", "Art. 15", "Art. 16", "Art. 17", "Art. 26", "Art. 43", "Art. 49", "Art. 72", "Art. 73"]) {
    assert.ok(r.applicableArticles.includes(code), `missing ${code}`);
  }
  assert.equal(r.applicableArticles.includes("Art. 27"), false);
  assert.ok(r.warnings.some((w) => w.includes("FRIA")), "should nudge about FRIA triggers");
  // Articles are sorted numerically, not lexically.
  const nums = r.applicableArticles.map((c) => Number(c.replace(/\D/g, "")));
  assert.deepEqual(nums, [...nums].sort((a, b) => a - b));
});

test("Art. 6(3) derogation drops the tier, documents the claim, and keeps provider registration", () => {
  const r = classifyEuAiAct(
    answers({ role: "PROVIDER", annexIIICategories: ["employment"], derogationGrounds: ["preparatory_task"], profiling: false })
  );
  assert.equal(r.tier, "MINIMAL_RISK");
  assert.equal(r.derogationClaimed, true);
  assert.ok(r.applicableArticles.includes("Art. 49"));
  assert.ok(r.warnings.some((w) => w.includes("Art. 6(4)")));
  assert.equal(r.applicableArticles.includes("Art. 26"), false);
});

test("profiling defeats the derogation", () => {
  const r = classifyEuAiAct(
    answers({ role: "DEPLOYER", annexIIICategories: ["employment"], derogationGrounds: ["preparatory_task"], profiling: true })
  );
  assert.equal(r.tier, "HIGH_RISK");
  assert.equal(r.derogationClaimed, false);
  assert.ok(r.rationale.some((line) => line.includes("profiling")));
});

test("transparency triggers alone give LIMITED_RISK with Art. 50", () => {
  const r = classifyEuAiAct(answers({ transparencyTriggers: ["interacts_with_persons", "synthetic_content"] }));
  assert.equal(r.tier, "LIMITED_RISK");
  assert.equal(r.transparencyRequired, true);
  assert.deepEqual(r.applicableArticles, ["Art. 4", "Art. 50"]);
  assert.equal(r.deadline?.date, "2026-08-02");
});

test("Art. 50 stacks on top of high-risk", () => {
  const r = classifyEuAiAct(answers({ annexIIICategories: ["education"], transparencyTriggers: ["interacts_with_persons"] }));
  assert.equal(r.tier, "HIGH_RISK");
  assert.ok(r.applicableArticles.includes("Art. 50"));
  assert.ok(r.applicableArticles.includes("Art. 26"));
});

test("GPAI flags add Art. 53 for deployers and providers, with the GPAI deadline only for providers", () => {
  const deployer = classifyEuAiAct(answers({ usesGpai: true }));
  assert.equal(deployer.tier, "MINIMAL_RISK");
  assert.ok(deployer.applicableArticles.includes("Art. 53"));
  assert.equal(deployer.deadline?.date, "2025-02-02");
  const provider = classifyEuAiAct(answers({ role: "PROVIDER", providesGpai: true }));
  assert.ok(provider.applicableArticles.includes("Art. 53"));
  assert.equal(provider.deadline?.date, "2025-08-02");
  assert.ok(provider.obligations.find((o) => o.code === "Art. 53")!.why.includes("provider of a general-purpose"));
});

test("public-body deployer of a high-risk system also registers under Art. 49(3)", () => {
  const r = classifyEuAiAct(answers({ annexIIICategories: ["essential_services"], friaTriggers: ["public_body"] }));
  assert.ok(r.applicableArticles.includes("Art. 49"));
  assert.ok(r.applicableArticles.includes("Art. 27"));
});

test("minimal-risk baseline has only Art. 4", () => {
  const r = classifyEuAiAct(answers({}));
  assert.equal(r.tier, "MINIMAL_RISK");
  assert.deepEqual(r.applicableArticles, ["Art. 4"]);
});

test("describeDeadline distinguishes past and future dates", () => {
  const now = new Date("2026-09-11T00:00:00Z");
  assert.match(describeDeadline({ date: "2026-08-02", label: "X" }, now), /in force since 2 Aug 2026/);
  assert.match(describeDeadline({ date: "2027-08-02", label: "X" }, now), /applies from 2 Aug 2027/);
  assert.equal(describeDeadline(null, now), "");
});

test("normalizeAnswers tolerates junk and preserves valid values", () => {
  const n = normalizeAnswers({ role: "DEPLOYER", annexIIICategories: ["employment", 3], annexIProduct: "yes", usesGpai: true });
  assert.equal(n.role, "DEPLOYER");
  assert.deepEqual(n.annexIIICategories, ["employment"]);
  assert.equal(n.annexIProduct, null);
  assert.equal(n.usesGpai, true);
  assert.deepEqual(normalizeAnswers(null), EMPTY_ANSWERS);
  assert.equal(normalizeAnswers({ role: "WIZARD" }).role, null);
});
