import type { RiskLevel } from "@prisma/client";

type GapInput = {
  requirement?: string;
  finding?: string;
  priority?: string;
};

type ComplianceIssueInput = {
  requirement: string;
  title: string;
  detail: string;
  remediation?: string | null;
  severity: RiskLevel;
  status?: "OPEN" | "IN_PROGRESS" | "RESOLVED" | "ACCEPTED";
  source?: string;
};

function normalizeSeverity(priority?: string): RiskLevel {
  const value = (priority ?? "").toUpperCase();
  if (value === "HIGH") return "HIGH";
  if (value === "LOW") return "LOW";
  return "MEDIUM";
}

export function buildComplianceIssues(input: {
  complianceStatus: string;
  gaps?: GapInput[];
  evidence?: string | null;
}): ComplianceIssueInput[] {
  const issues: ComplianceIssueInput[] = [];

  for (const gap of input.gaps ?? []) {
    const requirement = gap.requirement?.trim();
    const finding = gap.finding?.trim();
    if (!requirement || !finding) continue;

    issues.push({
      requirement,
      title: requirement,
      detail: finding,
      remediation: `Address the gap for "${requirement}" and rerun compliance analysis to confirm remediation.`,
      severity: normalizeSeverity(gap.priority),
      status: "OPEN",
      source: "ai_assessment",
    });
  }

  if (issues.length === 0 && input.complianceStatus !== "COMPLIANT" && input.evidence?.trim()) {
    issues.push({
      requirement: "Compliance follow-up",
      title: "Compliance follow-up required",
      detail: input.evidence.trim(),
      remediation: "Review the assessment narrative and capture the missing controls or evidence as discrete remediation work.",
      severity: input.complianceStatus === "NON_COMPLIANT" ? "HIGH" : "MEDIUM",
      status: "OPEN",
      source: "ai_assessment",
    });
  }

  return issues;
}
