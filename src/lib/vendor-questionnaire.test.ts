import test from "node:test";
import assert from "node:assert/strict";
import {
  VENDOR_QUESTIONS,
  parseVendorAnswers,
  scoreVendorQuestionnaire,
  type VendorAnswers,
} from "./vendor-questionnaire";

function allSafe(): VendorAnswers {
  return Object.fromEntries(
    VENDOR_QUESTIONS.map((question) => [question.id, { value: question.safeAnswer }])
  );
}

test("all-safe answers score 0 and suggest approval", () => {
  const result = scoreVendorQuestionnaire(allSafe());
  assert.equal(result.score, 0);
  assert.equal(result.tier, "LOW");
  assert.equal(result.answered, VENDOR_QUESTIONS.length);
  assert.equal(result.findings.length, 0);
  assert.equal(result.suggestedDecision, "APPROVED");
});

test("an empty questionnaire is not treated as safe", () => {
  const result = scoreVendorQuestionnaire({});
  assert.equal(result.answered, 0);
  assert.equal(result.score, 75);
  assert.equal(result.tier, "CRITICAL");
  assert.equal(result.suggestedDecision, "REJECTED");
});

test("a single critical miss forces at least HIGH and is listed first", () => {
  const answers = allSafe();
  answers.trains_on_customer_data = { value: "yes" };
  answers.iso27001 = { value: "partial" };
  const result = scoreVendorQuestionnaire(answers);
  assert.ok(result.score < 45, `score ${result.score} should be below the HIGH threshold`);
  assert.equal(result.tier, "HIGH");
  assert.equal(result.findings[0].questionId, "trains_on_customer_data");
  assert.equal(result.findings[0].critical, true);
  assert.equal(result.suggestedDecision, "CONDITIONAL");
});

test("not applicable only removes questions that allow it", () => {
  const withBaaNa = allSafe();
  withBaaNa.baa = { value: "na" };
  assert.equal(scoreVendorQuestionnaire(withBaaNa).score, 0);

  const withSocNa = allSafe();
  withSocNa.soc2_type2 = { value: "na" };
  assert.ok(scoreVendorQuestionnaire(withSocNa).score > 0);
});

test("parseVendorAnswers drops unknown ids and malformed values", () => {
  const parsed = parseVendorAnswers({
    soc2_type2: { value: "yes", note: "  2026 report  " },
    made_up: { value: "yes" },
    pentest: { value: "maybe" },
    sso: "yes",
  });
  assert.deepEqual(parsed, { soc2_type2: { value: "yes", note: "2026 report" } });
  assert.deepEqual(parseVendorAnswers(null), {});
  assert.deepEqual(parseVendorAnswers([1, 2]), {});
});

test("not knowing a key control is no better than failing it", () => {
  for (const value of ["unknown", undefined] as const) {
    const answers = allSafe();
    if (value) answers.trains_on_customer_data = { value };
    else delete answers.trains_on_customer_data;
    const result = scoreVendorQuestionnaire(answers);
    assert.equal(result.tier, "HIGH", `answer ${value ?? "skipped"}`);
    assert.equal(result.findings[0].critical, true);
  }
});
