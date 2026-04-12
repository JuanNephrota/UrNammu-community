import type { AutonomyLevel, DataSensitivity } from "@prisma/client";
import type { RiskScores } from "@/lib/risk-center";

export type RiskAssessmentTemplateId =
  | "copilot"
  | "vendor_ai_saas"
  | "autonomous_agent"
  | "customer_facing_ai";

export type RiskAssessmentTemplate = {
  id: RiskAssessmentTemplateId;
  label: string;
  description: string;
  bestFor: string;
  recommended: boolean;
  defaults: {
    scores: RiskScores;
    justifications: Partial<Record<keyof RiskScores, string>>;
    notes: string;
  };
};

type Input = {
  useCase?: string | null;
  vendor?: string | null;
  dataSensitivity: DataSensitivity;
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

function hasElevatedAutonomy(agents: Input["agents"]) {
  return (agents ?? []).some(
    (agent) =>
      agent.autonomyLevel === "FULL_AUTONOMY" ||
      agent.autonomyLevel === "SUPERVISED" ||
      agent.autonomyLevel === "HUMAN_ON_THE_LOOP" ||
      !agent.humanReviewRequired
  );
}

export function getRiskAssessmentTemplates(input: Input): RiskAssessmentTemplate[] {
  const autonomous = hasElevatedAutonomy(input.agents);
  const customerFacing = includesAny(input.useCase, [
    "customer",
    "support",
    "chatbot",
    "public",
    "external",
    "self-service",
  ]);
  const copilot = includesAny(input.useCase, [
    "copilot",
    "assistant",
    "draft",
    "summar",
    "knowledge",
    "internal",
    "productivity",
  ]);
  const agentic = includesAny(input.useCase, [
    "agent",
    "autonom",
    "workflow",
    "automation",
    "orchestrat",
  ]);
  const vendorSaaS = !!input.vendor;

  return [
    {
      id: "copilot",
      label: "Copilot",
      description: "Internal assistant for drafting, summarization, knowledge help, or employee productivity.",
      bestFor: "Internal copilots, drafting assistants, search assistants, and knowledge tools.",
      recommended: copilot && !customerFacing,
      defaults: {
        scores: {
          biasScore: 28,
          securityScore: 42,
          privacyScore: input.dataSensitivity === "CONFIDENTIAL" || input.dataSensitivity === "RESTRICTED" ? 58 : 34,
          fairnessScore: 24,
          performanceScore: 38,
          transparencyScore: 46,
        },
        justifications: {
          securityScore: "Internal copilots often rely on broad document access and prompt-driven behavior, so access scoping and prompt-injection resilience need review.",
          transparencyScore: "Copilot outputs can look authoritative even when they are generated heuristically, which raises explainability and reviewer-trust concerns.",
        },
        notes: "Template: Copilot. Confirm document access boundaries, reviewer expectations, and fallback behavior when answers are low confidence.",
      },
    },
    {
      id: "vendor_ai_saas",
      label: "Vendor AI SaaS",
      description: "Third-party AI SaaS product adopted by the business rather than a deeply customized internal build.",
      bestFor: "External vendor tools such as ChatGPT Enterprise, Claude, Glean, or embedded AI SaaS features.",
      recommended: vendorSaaS && !autonomous,
      defaults: {
        scores: {
          biasScore: 34,
          securityScore: 55,
          privacyScore: input.dataSensitivity === "RESTRICTED" ? 72 : 52,
          fairnessScore: 30,
          performanceScore: 36,
          transparencyScore: 48,
        },
        justifications: {
          securityScore: "Vendor AI SaaS tools introduce third-party dependency, admin configuration, and service-change risk that should be reviewed before approval.",
          privacyScore: "The main risk is whether sensitive data can be exposed to a vendor workflow that the business does not fully control.",
        },
        notes: "Template: Vendor AI SaaS. Focus on vendor controls, contract posture, residency, subprocessors, and what business data is actually allowed into the tool.",
      },
    },
    {
      id: "autonomous_agent",
      label: "Autonomous Agent",
      description: "Agentic workflow with elevated execution authority, downstream actions, or multi-system coordination.",
      bestFor: "Autonomous and semi-autonomous agents, orchestration workflows, and action-taking assistants.",
      recommended: autonomous || agentic,
      defaults: {
        scores: {
          biasScore: 32,
          securityScore: 64,
          privacyScore: input.dataSensitivity === "RESTRICTED" ? 78 : 56,
          fairnessScore: 28,
          performanceScore: 67,
          transparencyScore: 62,
        },
        justifications: {
          securityScore: "Agentic systems create a larger attack and misuse surface because they can chain inputs, tools, and actions across multiple steps.",
          performanceScore: "Failure handling matters more for autonomous agents because wrong outputs can directly trigger downstream operational impact.",
          transparencyScore: "Multi-step agent behavior is harder to explain and audit than a single-response assistant flow.",
        },
        notes: "Template: Autonomous Agent. Verify execution guardrails, escalation paths, kill switches, and downstream blast radius before approval.",
      },
    },
    {
      id: "customer_facing_ai",
      label: "Customer-Facing AI",
      description: "AI that directly interacts with or materially affects customers, applicants, or other external users.",
      bestFor: "Support assistants, customer copilots, decision support, external-facing chat, and public AI experiences.",
      recommended: customerFacing,
      defaults: {
        scores: {
          biasScore: 52,
          securityScore: 54,
          privacyScore: input.dataSensitivity === "RESTRICTED" ? 76 : 58,
          fairnessScore: 56,
          performanceScore: 49,
          transparencyScore: 58,
        },
        justifications: {
          biasScore: "Customer-facing systems can produce uneven outcomes or advice at scale, so fairness review is materially more important.",
          fairnessScore: "External impact raises the need to understand who could be treated differently and what review path exists when that happens.",
          transparencyScore: "Users need clear understanding of when they are interacting with AI and how to escalate bad outcomes.",
        },
        notes: "Template: Customer-Facing AI. Focus on user harm scenarios, appeal paths, disclosure, and the safety net when outputs are wrong.",
      },
    },
  ];
}
