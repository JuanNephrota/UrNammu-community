import type { AISystem, GovernanceReviewStage, Prisma } from "@prisma/client";

export type PolicyRuleSet = {
  allowedVendors?: string[];
  blockedDataSensitivities?: string[];
  requiredStages?: GovernanceReviewStage[];
  maxReviewIntervalDays?: number;
  minimumRiskLevel?: "MINIMAL" | "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
};

const riskRank: Record<NonNullable<PolicyRuleSet["minimumRiskLevel"]>, number> = {
  MINIMAL: 0,
  LOW: 1,
  MEDIUM: 2,
  HIGH: 3,
  CRITICAL: 4,
};

export function normalizePolicyRules(input: {
  allowedVendors?: string;
  blockedDataSensitivities?: string[];
  requiredStages?: string[];
  maxReviewIntervalDays?: number;
  minimumRiskLevel?: string;
}): PolicyRuleSet | null {
  const rules: PolicyRuleSet = {};
  const vendors = input.allowedVendors
    ?.split(",")
    .map((vendor) => vendor.trim())
    .filter(Boolean);
  if (vendors?.length) rules.allowedVendors = vendors;
  if (input.blockedDataSensitivities?.length) rules.blockedDataSensitivities = input.blockedDataSensitivities;
  if (input.requiredStages?.length) rules.requiredStages = input.requiredStages as GovernanceReviewStage[];
  if (input.maxReviewIntervalDays) rules.maxReviewIntervalDays = input.maxReviewIntervalDays;
  if (input.minimumRiskLevel && input.minimumRiskLevel in riskRank) {
    rules.minimumRiskLevel = input.minimumRiskLevel as NonNullable<PolicyRuleSet["minimumRiskLevel"]>;
  }
  return Object.keys(rules).length ? rules : null;
}

export function parsePolicyRules(value: Prisma.JsonValue | null | undefined): PolicyRuleSet {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as unknown as PolicyRuleSet;
}

export function evaluatePolicyRules(
  rules: PolicyRuleSet,
  system: Pick<AISystem, "vendor" | "dataSensitivity" | "reviewIntervalDays" | "riskLevel" | "requireOwnerApproval" | "requireSecurityApproval" | "requireLegalApproval" | "requireComplianceApproval">
) {
  const violations: string[] = [];
  const recommendations: string[] = [];

  if (rules.allowedVendors?.length && (!system.vendor || !rules.allowedVendors.includes(system.vendor))) {
    violations.push(`Vendor ${system.vendor ?? "Unknown"} is not in the approved vendor list.`);
  }

  if (rules.blockedDataSensitivities?.includes(system.dataSensitivity)) {
    violations.push(`Data sensitivity ${system.dataSensitivity} is blocked by this policy.`);
  }

  if (rules.maxReviewIntervalDays && system.reviewIntervalDays > rules.maxReviewIntervalDays) {
    violations.push(`Review interval of ${system.reviewIntervalDays} days exceeds the policy maximum of ${rules.maxReviewIntervalDays} days.`);
  }

  if (rules.minimumRiskLevel && riskRank[system.riskLevel] < riskRank[rules.minimumRiskLevel]) {
    recommendations.push(`Increase the documented risk level to at least ${rules.minimumRiskLevel} for this policy scope.`);
  }

  if (rules.requiredStages?.length) {
    const presentStages = new Set<GovernanceReviewStage>([
      ...(system.requireOwnerApproval ? ["OWNER" as const] : []),
      ...(system.requireSecurityApproval ? ["SECURITY" as const] : []),
      ...(system.requireLegalApproval ? ["LEGAL" as const] : []),
      ...(system.requireComplianceApproval ? ["COMPLIANCE" as const] : []),
    ]);
    const missingStages = rules.requiredStages.filter((stage) => !presentStages.has(stage));
    if (missingStages.length) {
      violations.push(`Missing required approval stages: ${missingStages.join(", ")}.`);
    }
  }

  return {
    compliant: violations.length === 0,
    violations,
    recommendations,
  };
}
