// Steps of the guided risk assessment. Unlike the vendor wizards, a risk
// assessment is only saved on submit: posting one immediately recalculates the
// system's risk level, so a half-finished draft must not reach the record.
export const RISK_ASSESSMENT_STEPS = [
  { id: "system", label: "System", description: "Pick and set a starting point" },
  { id: "context", label: "Context", description: "Focus areas and questions" },
  { id: "scores", label: "Scores", description: "Six risk dimensions" },
  { id: "mitigation", label: "Mitigation", description: "Residual risk and issues" },
  { id: "review", label: "Review", description: "Check and submit" },
] as const;

export type RiskAssessmentStepId = (typeof RISK_ASSESSMENT_STEPS)[number]["id"];
