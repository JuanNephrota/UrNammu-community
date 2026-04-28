import type { RiskLevel } from "@prisma/client";
import type { RiskDimensionKey, RiskScores } from "./risk-center";

export type RiskAssessmentIssueInput = {
  category: string;
  title: string;
  detail: string;
  remediation?: string | null;
  severity: RiskLevel;
  status?: "OPEN" | "IN_PROGRESS" | "RESOLVED" | "ACCEPTED";
  source?: string;
};

const dimensionMeta: Record<
  RiskDimensionKey,
  { category: string; label: string; remediation: string }
> = {
  biasScore: {
    category: "bias",
    label: "Bias controls",
    remediation: "Document bias mitigations, targeted testing, and escalation paths for affected users.",
  },
  securityScore: {
    category: "security",
    label: "Security controls",
    remediation: "Add prompt-injection safeguards, access controls, and incident response coverage before deployment.",
  },
  privacyScore: {
    category: "privacy",
    label: "Privacy controls",
    remediation: "Tighten data minimization, retention, and restricted-data handling controls for this workflow.",
  },
  fairnessScore: {
    category: "fairness",
    label: "Fairness validation",
    remediation: "Run fairness testing across affected groups and document remediation if results differ materially.",
  },
  performanceScore: {
    category: "performance",
    label: "Reliability safeguards",
    remediation: "Add monitoring, fallback behavior, and acceptance thresholds for low-confidence outputs.",
  },
  transparencyScore: {
    category: "transparency",
    label: "Transparency and explainability",
    remediation: "Clarify user disclosures, decision rationale, and reviewer visibility into model behavior.",
  },
};

function scoreToSeverity(score: number): RiskLevel {
  if (score >= 80) return "CRITICAL";
  if (score >= 60) return "HIGH";
  if (score >= 40) return "MEDIUM";
  if (score >= 20) return "LOW";
  return "MINIMAL";
}

export function generateAssessmentIssues(input: {
  scores: RiskScores;
  justifications?: Partial<Record<RiskDimensionKey, string>>;
  notes?: string | null;
}): RiskAssessmentIssueInput[] {
  const issues: RiskAssessmentIssueInput[] = [];

  (Object.entries(input.scores) as Array<[RiskDimensionKey, number]>).forEach(([key, score]) => {
    if (score < 60) return;

    const meta = dimensionMeta[key];
    const severity = scoreToSeverity(score);
    const justification = input.justifications?.[key]?.trim();

    issues.push({
      category: meta.category,
      title: `${meta.label} need follow-up`,
      detail:
        justification ||
        `${meta.label} scored ${score}, which indicates a ${severity.toLowerCase()} issue that should be addressed separately.`,
      remediation: meta.remediation,
      severity,
      status: "OPEN",
      source: "assessment",
    });
  });

  const noteText = input.notes?.trim() ?? "";
  if (issues.length === 0 && noteText) {
    const sentences = noteText
      .split(/\n+/)
      .flatMap((line) => line.split(/(?<=[.!?])\s+/))
      .map((entry) => entry.trim())
      .filter(Boolean);

    const highSignal = sentences.filter((entry) =>
      /(must|should|needs?|gap|risk|issue|control|review|mitigation|monitor)/i.test(entry)
    );

    for (const sentence of highSignal.slice(0, 3)) {
      issues.push({
        category: "assessment_follow_up",
        title: "Assessment follow-up item",
        detail: sentence,
        remediation: "Address this item in the relevant governance, compliance, or control workflow.",
        severity: "MEDIUM",
        status: "OPEN",
        source: "assessment",
      });
    }
  }

  return issues;
}
