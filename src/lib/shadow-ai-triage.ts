import type { AIToolRiskHint } from "@/lib/ai-tools-registry";

// Guided triage of a discovered (shadow AI) tool. The reviewer answers three
// questions; together with what discovery observed they produce a suggested
// outcome. The reviewer always makes the final call.

export const TRIAGE_STEPS = [
  { id: "understand", label: "Understand", description: "What was found" },
  { id: "assess", label: "Assess", description: "Three questions" },
  { id: "decide", label: "Decide", description: "Register, approve or block" },
] as const;

export type TriageStepId = (typeof TRIAGE_STEPS)[number]["id"];

export type TriageOutcome = "register" | "approve" | "block" | "dismiss";

export type TriageAnswers = {
  /** The most sensitive data people put into it. */
  dataExposure?: "none" | "internal" | "customer" | "unknown";
  businessNeed?: "yes" | "no" | "unknown";
  /** Is there an already-approved tool that does the same job? */
  approvedAlternative?: "yes" | "no" | "unknown";
};

export const RISK_HINT_LABELS: Record<AIToolRiskHint, string> = {
  trains_on_data: "The consumer tier trains on prompts",
  consumer_grade: "Consumer-grade product (no admin controls)",
  china_hosted: "Data is processed in China",
  no_enterprise_tier: "No enterprise tier available",
};

// OAuth scope fragments that grant broad access to company data.
const BROAD_SCOPE_PATTERNS = [
  "gmail",
  "mail.",
  "/auth/drive",
  "files.read",
  "files.readwrite",
  "sites.read",
  "calendar",
  "contacts",
  "directory",
  "admin.",
  "cloud-platform",
];

export function broadScopes(scopes: string[]): string[] {
  return scopes.filter((scope) => {
    const value = scope.toLowerCase();
    return BROAD_SCOPE_PATTERNS.some((pattern) => value.includes(pattern));
  });
}

export type TriageSignals = {
  riskHints: AIToolRiskHint[];
  scopes: string[];
  userCount: number;
  /** Security review status of the vendor's governance profile, if any. */
  vendorReviewStatus: string | null;
};

export type TriageRecommendation = {
  outcome: TriageOutcome;
  reasons: string[];
};

export function getTriageRecommendation(
  answers: TriageAnswers,
  signals: TriageSignals
): TriageRecommendation {
  const reasons: string[] = [];
  const broad = broadScopes(signals.scopes);
  const riskyHints = signals.riskHints.filter((hint) => hint === "trains_on_data" || hint === "china_hosted");

  if (signals.vendorReviewStatus === "REJECTED") {
    return { outcome: "block", reasons: ["The vendor's security review was rejected."] };
  }

  if (answers.businessNeed === "no") {
    reasons.push("There is no business need for it.");
    if (answers.approvedAlternative === "yes") reasons.push("An approved tool already covers this job.");
    return { outcome: "block", reasons };
  }

  if (answers.approvedAlternative === "yes" && answers.dataExposure !== "none") {
    return {
      outcome: "block",
      reasons: [
        "An approved tool already covers this job, so point people to it.",
        "Company data is going into an unreviewed tool in the meantime.",
      ],
    };
  }

  if (riskyHints.length > 0 && answers.dataExposure === "customer") {
    return {
      outcome: "block",
      reasons: [
        `Customer data is going into a tool flagged: ${riskyHints.map((h) => RISK_HINT_LABELS[h].toLowerCase()).join("; ")}.`,
        "Block it until an enterprise agreement is in place, then register it.",
      ],
    };
  }

  if (answers.dataExposure === "customer" || answers.dataExposure === "unknown" || broad.length > 0) {
    if (answers.dataExposure === "customer") reasons.push("It handles customer or regulated data.");
    if (answers.dataExposure === "unknown") reasons.push("Nobody knows yet what data goes into it.");
    if (broad.length > 0) reasons.push(`It was granted broad access: ${broad.slice(0, 3).join(", ")}.`);
    reasons.push("Register it so it gets a risk assessment, policies and an owner.");
    return { outcome: "register", reasons };
  }

  if (answers.businessNeed === "yes" && answers.dataExposure === "none") {
    reasons.push("There is a business need and no company data goes into it.");
    if (signals.riskHints.length > 0) {
      reasons.push("Note the registry flags on the first step before approving.");
    }
    return { outcome: "approve", reasons };
  }

  reasons.push("It is in use with internal data. Register it so it is governed like any other AI system.");
  if (signals.userCount >= 10) reasons.push(`${signals.userCount} people already use it.`);
  return { outcome: "register", reasons };
}

export function isTriageComplete(answers: TriageAnswers) {
  return Boolean(answers.dataExposure && answers.businessNeed && answers.approvedAlternative);
}
