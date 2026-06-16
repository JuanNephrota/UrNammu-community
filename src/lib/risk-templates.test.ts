import test from "node:test";
import assert from "node:assert/strict";
import { getRiskAssessmentTemplates } from "./risk-templates";

test("recommends autonomous agent template when linked agents have elevated autonomy", () => {
  const templates = getRiskAssessmentTemplates({
    useCase: "Internal workflow automation",
    vendor: "OpenAI",
    dataSensitivity: "CONFIDENTIAL",
    agents: [
      {
        autonomyLevel: "SUPERVISED",
        humanReviewRequired: false,
      },
    ],
  });

  const autonomousTemplate = templates.find((template) => template.id === "autonomous_agent");
  assert.equal(autonomousTemplate?.recommended, true);
});

test("recommends customer-facing AI template for external support use cases", () => {
  const templates = getRiskAssessmentTemplates({
    useCase: "Customer support chatbot for account help",
    vendor: "Anthropic",
    dataSensitivity: "INTERNAL",
    agents: [],
  });

  const customerTemplate = templates.find((template) => template.id === "customer_facing_ai");
  assert.equal(customerTemplate?.recommended, true);
});
