import type { AutonomyLevel, DataSensitivity } from "@prisma/client";

export type RiskQuestionCategory = "data_sensitivity" | "autonomy" | "user_impact";

export type RiskQuestion = {
  id: string;
  category: RiskQuestionCategory;
  title: string;
  prompt: string;
  helper: string;
};

type Input = {
  dataSensitivity: DataSensitivity;
  useCase?: string | null;
  agents?: Array<{
    autonomyLevel: AutonomyLevel;
    humanReviewRequired: boolean;
  }>;
};

function includesAny(value: string | null | undefined, patterns: string[]) {
  if (!value) return false;
  const lower = value.toLowerCase();
  return patterns.some((pattern) => lower.includes(pattern));
}

function hasElevatedAutonomy(
  agents: Input["agents"]
) {
  return (agents ?? []).some(
    (agent) =>
      agent.autonomyLevel === "FULL_AUTONOMY" ||
      agent.autonomyLevel === "SUPERVISED" ||
      agent.autonomyLevel === "HUMAN_ON_THE_LOOP" ||
      !agent.humanReviewRequired
  );
}

function hasUserImpact(useCase?: string | null) {
  return includesAny(useCase, [
    "customer",
    "employee",
    "hiring",
    "approval",
    "finance",
    "health",
    "medical",
    "legal",
    "hr",
    "support",
    "decision",
  ]);
}

export function getDynamicRiskQuestions(input: Input): RiskQuestion[] {
  const questions: RiskQuestion[] = [];

  if (input.dataSensitivity === "RESTRICTED") {
    questions.push(
      {
        id: "restricted_data_controls",
        category: "data_sensitivity",
        title: "Restricted Data Controls",
        prompt:
          "What controls prevent restricted data from being exposed, retained too long, or used outside the intended scope?",
        helper:
          "Call out redaction, retention, approval gates, segregation, or monitoring controls.",
      },
      {
        id: "restricted_data_failure_mode",
        category: "data_sensitivity",
        title: "Restricted Data Failure Mode",
        prompt:
          "If the system mishandled restricted data, what would the likely impact be and how quickly would the team detect it?",
        helper:
          "Focus on detection paths, customer or employee impact, and incident response speed.",
      }
    );
  } else if (input.dataSensitivity === "CONFIDENTIAL") {
    questions.push({
      id: "confidential_data_scope",
      category: "data_sensitivity",
      title: "Confidential Data Scope",
      prompt:
        "What confidential data is in scope, and what keeps the system from expanding beyond that intended scope over time?",
      helper:
        "Describe scope boundaries, prompts or input constraints, and review points.",
    });
  } else {
    questions.push({
      id: "data_scope_validation",
      category: "data_sensitivity",
      title: "Data Scope Validation",
      prompt:
        "Why is the current data sensitivity classification still accurate for this system’s real inputs and outputs?",
      helper:
        "Use this to confirm the system is not quietly handling more sensitive content than documented.",
    });
  }

  if (hasElevatedAutonomy(input.agents)) {
    questions.push(
      {
        id: "autonomy_guardrails",
        category: "autonomy",
        title: "Autonomy Guardrails",
        prompt:
          "What human-review checkpoints, execution limits, or escalation rules keep higher-autonomy behavior inside acceptable bounds?",
        helper:
          "Mention approval steps, kill switches, rate limits, or rollback paths.",
      },
      {
        id: "autonomy_blast_radius",
        category: "autonomy",
        title: "Autonomy Blast Radius",
        prompt:
          "If an autonomous or semi-autonomous agent made the wrong decision, what systems or users would be affected first?",
        helper:
          "Describe downstream systems, affected teams, and how the issue would be contained.",
      }
    );
  }

  if (hasUserImpact(input.useCase)) {
    questions.push(
      {
        id: "user_impact_harm",
        category: "user_impact",
        title: "User Impact and Harm",
        prompt:
          "Which users or groups could be harmed by incorrect, biased, or delayed outputs, and what protects them today?",
        helper:
          "Think about customers, employees, applicants, or any people affected by the system’s decisions or guidance.",
      },
      {
        id: "user_impact_override",
        category: "user_impact",
        title: "Human Override",
        prompt:
          "When the system’s output affects people, what override or appeal path exists if the output is wrong?",
        helper:
          "Describe reviewer intervention, escalation, or user recourse mechanisms.",
      }
    );
  }

  return questions;
}
