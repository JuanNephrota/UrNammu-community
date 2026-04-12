import test from "node:test";
import assert from "node:assert/strict";
import { getDynamicRiskQuestions } from "./risk-questionnaire";

test("branches to restricted-data, autonomy, and user-impact questions", () => {
  const questions = getDynamicRiskQuestions({
    dataSensitivity: "RESTRICTED",
    useCase: "Customer support agent for account approvals",
    agents: [
      {
        autonomyLevel: "SUPERVISED",
        humanReviewRequired: false,
      },
    ],
  });

  assert.equal(questions.some((question) => question.category === "data_sensitivity"), true);
  assert.equal(questions.some((question) => question.category === "autonomy"), true);
  assert.equal(questions.some((question) => question.category === "user_impact"), true);
});

test("uses lighter data-scope validation when sensitivity and impact are low", () => {
  const questions = getDynamicRiskQuestions({
    dataSensitivity: "INTERNAL",
    useCase: "Internal drafting helper for engineering notes",
    agents: [],
  });

  assert.equal(questions.some((question) => question.id === "data_scope_validation"), true);
  assert.equal(questions.some((question) => question.category === "autonomy"), false);
});
