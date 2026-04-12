import type {
  AISystem,
  AISystemStatus,
  ComplianceStatus,
  DataSensitivity,
  GovernanceReviewStage,
  Prisma,
} from "@prisma/client";

export type PolicyRuleEnforcement = "ADVISORY" | "BLOCK";

export type PolicyRuleActions = {
  enforcement?: PolicyRuleEnforcement;
  allowException?: boolean;
  recommendedComplianceStatus?: Extract<
    ComplianceStatus,
    "PARTIALLY_COMPLIANT" | "NON_COMPLIANT"
  >;
};

export type PolicyRuleSet = {
  allowedVendors?: string[];
  blockedVendors?: string[];
  blockedDataSensitivities?: DataSensitivity[];
  maxDataSensitivity?: DataSensitivity;
  requiredStages?: GovernanceReviewStage[];
  maxReviewIntervalDays?: number;
  minimumRiskLevel?: "MINIMAL" | "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  allowedDepartments?: string[];
  blockedDepartments?: string[];
  allowedModelPatterns?: string[];
  blockedModelPatterns?: string[];
  allowedStatuses?: AISystemStatus[];
  actions?: PolicyRuleActions;
};

type NormalizeInput = {
  allowedVendors?: string;
  blockedVendors?: string;
  blockedDataSensitivities?: string[];
  maxDataSensitivity?: string;
  requiredStages?: string[];
  maxReviewIntervalDays?: number;
  minimumRiskLevel?: string;
  allowedDepartments?: string;
  blockedDepartments?: string;
  allowedModelPatterns?: string;
  blockedModelPatterns?: string;
  allowedStatuses?: string[];
  enforcement?: string;
  allowException?: boolean;
  recommendedComplianceStatus?: string;
};

type EvaluationInput = Pick<
  AISystem,
  | "vendor"
  | "dataSensitivity"
  | "reviewIntervalDays"
  | "riskLevel"
  | "requireOwnerApproval"
  | "requireSecurityApproval"
  | "requireLegalApproval"
  | "requireComplianceApproval"
  | "department"
  | "status"
  | "modelType"
> & {
  activeExceptionCount?: number;
};

type Issue = {
  message: string;
  recommendation?: string;
};

const riskRank: Record<NonNullable<PolicyRuleSet["minimumRiskLevel"]>, number> =
  {
    MINIMAL: 0,
    LOW: 1,
    MEDIUM: 2,
    HIGH: 3,
    CRITICAL: 4,
  };

const dataSensitivityRank: Record<DataSensitivity, number> = {
  PUBLIC: 0,
  INTERNAL: 1,
  CONFIDENTIAL: 2,
  RESTRICTED: 3,
};

const validStatuses = new Set<AISystemStatus>([
  "DRAFT",
  "UNDER_REVIEW",
  "APPROVED",
  "DEPLOYED",
  "DEPRECATED",
  "RETIRED",
]);

const validDataSensitivities = new Set<DataSensitivity>([
  "PUBLIC",
  "INTERNAL",
  "CONFIDENTIAL",
  "RESTRICTED",
]);

const validGovernanceStages = new Set<GovernanceReviewStage>([
  "OWNER",
  "SECURITY",
  "LEGAL",
  "COMPLIANCE",
]);

function parseCommaSeparatedList(input?: string): string[] | undefined {
  const values = input
    ?.split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  return values?.length ? values : undefined;
}

function normalizeActions(input: NormalizeInput): PolicyRuleActions | undefined {
  const actions: PolicyRuleActions = {};

  if (input.enforcement === "ADVISORY" || input.enforcement === "BLOCK") {
    actions.enforcement = input.enforcement;
  }

  if (typeof input.allowException === "boolean") {
    actions.allowException = input.allowException;
  }

  if (
    input.recommendedComplianceStatus === "PARTIALLY_COMPLIANT" ||
    input.recommendedComplianceStatus === "NON_COMPLIANT"
  ) {
    actions.recommendedComplianceStatus = input.recommendedComplianceStatus;
  }

  return Object.keys(actions).length ? actions : undefined;
}

export function normalizePolicyRules(input: NormalizeInput): PolicyRuleSet | null {
  const rules: PolicyRuleSet = {};

  const allowedVendors = parseCommaSeparatedList(input.allowedVendors);
  const blockedVendors = parseCommaSeparatedList(input.blockedVendors);
  const allowedDepartments = parseCommaSeparatedList(input.allowedDepartments);
  const blockedDepartments = parseCommaSeparatedList(input.blockedDepartments);
  const allowedModelPatterns = parseCommaSeparatedList(input.allowedModelPatterns);
  const blockedModelPatterns = parseCommaSeparatedList(input.blockedModelPatterns);

  if (allowedVendors) rules.allowedVendors = allowedVendors;
  if (blockedVendors) rules.blockedVendors = blockedVendors;
  if (allowedDepartments) rules.allowedDepartments = allowedDepartments;
  if (blockedDepartments) rules.blockedDepartments = blockedDepartments;
  if (allowedModelPatterns) rules.allowedModelPatterns = allowedModelPatterns;
  if (blockedModelPatterns) rules.blockedModelPatterns = blockedModelPatterns;

  const blockedDataSensitivities = input.blockedDataSensitivities?.filter((value) =>
    validDataSensitivities.has(value as DataSensitivity)
  ) as DataSensitivity[] | undefined;
  if (blockedDataSensitivities?.length) {
    rules.blockedDataSensitivities = blockedDataSensitivities;
  }

  if (
    input.maxDataSensitivity &&
    validDataSensitivities.has(input.maxDataSensitivity as DataSensitivity)
  ) {
    rules.maxDataSensitivity = input.maxDataSensitivity as DataSensitivity;
  }

  const requiredStages = input.requiredStages?.filter((value) =>
    validGovernanceStages.has(value as GovernanceReviewStage)
  ) as GovernanceReviewStage[] | undefined;
  if (requiredStages?.length) rules.requiredStages = requiredStages;

  const allowedStatuses = input.allowedStatuses?.filter((value) =>
    validStatuses.has(value as AISystemStatus)
  ) as AISystemStatus[] | undefined;
  if (allowedStatuses?.length) rules.allowedStatuses = allowedStatuses;

  if (input.maxReviewIntervalDays && input.maxReviewIntervalDays > 0) {
    rules.maxReviewIntervalDays = input.maxReviewIntervalDays;
  }

  if (input.minimumRiskLevel && input.minimumRiskLevel in riskRank) {
    rules.minimumRiskLevel =
      input.minimumRiskLevel as NonNullable<PolicyRuleSet["minimumRiskLevel"]>;
  }

  const actions = normalizeActions(input);
  if (actions) rules.actions = actions;

  return Object.keys(rules).length ? rules : null;
}

export function parsePolicyRules(value: Prisma.JsonValue | null | undefined): PolicyRuleSet {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const input = value as Record<string, unknown>;

  const rules: PolicyRuleSet = {};

  const copyStringArray = (key: keyof PolicyRuleSet) => {
    const candidate = input[key];
    if (Array.isArray(candidate)) {
      const values = candidate.filter(
        (entry): entry is string => typeof entry === "string" && entry.trim().length > 0
      );
      if (values.length) {
        (rules[key] as string[] | undefined) = values;
      }
    }
  };

  copyStringArray("allowedVendors");
  copyStringArray("blockedVendors");
  copyStringArray("allowedDepartments");
  copyStringArray("blockedDepartments");
  copyStringArray("allowedModelPatterns");
  copyStringArray("blockedModelPatterns");

  const blockedDataSensitivities = input.blockedDataSensitivities;
  if (Array.isArray(blockedDataSensitivities)) {
    const values = blockedDataSensitivities.filter((entry): entry is DataSensitivity =>
      typeof entry === "string" && validDataSensitivities.has(entry as DataSensitivity)
    );
    if (values.length) rules.blockedDataSensitivities = values;
  }

  if (
    typeof input.maxDataSensitivity === "string" &&
    validDataSensitivities.has(input.maxDataSensitivity as DataSensitivity)
  ) {
    rules.maxDataSensitivity = input.maxDataSensitivity as DataSensitivity;
  }

  const requiredStages = input.requiredStages;
  if (Array.isArray(requiredStages)) {
    const values = requiredStages.filter((entry): entry is GovernanceReviewStage =>
      typeof entry === "string" &&
      validGovernanceStages.has(entry as GovernanceReviewStage)
    );
    if (values.length) rules.requiredStages = values;
  }

  const allowedStatuses = input.allowedStatuses;
  if (Array.isArray(allowedStatuses)) {
    const values = allowedStatuses.filter((entry): entry is AISystemStatus =>
      typeof entry === "string" && validStatuses.has(entry as AISystemStatus)
    );
    if (values.length) rules.allowedStatuses = values;
  }

  if (
    typeof input.maxReviewIntervalDays === "number" &&
    Number.isFinite(input.maxReviewIntervalDays) &&
    input.maxReviewIntervalDays > 0
  ) {
    rules.maxReviewIntervalDays = input.maxReviewIntervalDays;
  }

  if (
    typeof input.minimumRiskLevel === "string" &&
    input.minimumRiskLevel in riskRank
  ) {
    rules.minimumRiskLevel =
      input.minimumRiskLevel as NonNullable<PolicyRuleSet["minimumRiskLevel"]>;
  }

  if (input.actions && typeof input.actions === "object" && !Array.isArray(input.actions)) {
    const actionsInput = input.actions as Record<string, unknown>;
    const actions: PolicyRuleActions = {};

    if (
      actionsInput.enforcement === "ADVISORY" ||
      actionsInput.enforcement === "BLOCK"
    ) {
      actions.enforcement = actionsInput.enforcement;
    }
    if (typeof actionsInput.allowException === "boolean") {
      actions.allowException = actionsInput.allowException;
    }
    if (
      actionsInput.recommendedComplianceStatus === "PARTIALLY_COMPLIANT" ||
      actionsInput.recommendedComplianceStatus === "NON_COMPLIANT"
    ) {
      actions.recommendedComplianceStatus =
        actionsInput.recommendedComplianceStatus;
    }

    if (Object.keys(actions).length) rules.actions = actions;
  }

  return rules;
}

function includesIgnoreCase(values: string[] | undefined, candidate: string | null | undefined) {
  if (!values?.length || !candidate) return false;
  const lower = candidate.toLowerCase();
  return values.some((value) => value.toLowerCase() === lower);
}

function patternMatch(
  patterns: string[] | undefined,
  candidate: string | null | undefined
) {
  if (!patterns?.length || !candidate) return false;
  const lower = candidate.toLowerCase();
  return patterns.some((pattern) => lower.includes(pattern.toLowerCase()));
}

function collectIssues(rules: PolicyRuleSet, system: EvaluationInput): Issue[] {
  const issues: Issue[] = [];

  if (
    rules.allowedVendors?.length &&
    (!system.vendor || !includesIgnoreCase(rules.allowedVendors, system.vendor))
  ) {
    issues.push({
      message: `Vendor ${system.vendor ?? "Unknown"} is not in the approved vendor list.`,
      recommendation: "Update the policy scope, switch vendors, or document an approved exception.",
    });
  }

  if (includesIgnoreCase(rules.blockedVendors, system.vendor)) {
    issues.push({
      message: `Vendor ${system.vendor ?? "Unknown"} is explicitly blocked by this policy.`,
      recommendation: "Use an approved vendor or create a time-bound governance exception.",
    });
  }

  if (rules.blockedDataSensitivities?.includes(system.dataSensitivity)) {
    issues.push({
      message: `Data sensitivity ${system.dataSensitivity} is blocked by this policy.`,
      recommendation: "Lower the data sensitivity in scope, add stronger controls, or request an exception.",
    });
  }

  if (
    rules.maxDataSensitivity &&
    dataSensitivityRank[system.dataSensitivity] >
      dataSensitivityRank[rules.maxDataSensitivity]
  ) {
    issues.push({
      message: `Data sensitivity ${system.dataSensitivity} exceeds the policy maximum of ${rules.maxDataSensitivity}.`,
      recommendation: "Reduce the sensitivity in scope or move the system to a stricter policy track.",
    });
  }

  if (
    rules.allowedDepartments?.length &&
    (!system.department ||
      !includesIgnoreCase(rules.allowedDepartments, system.department))
  ) {
    issues.push({
      message: `Department ${system.department ?? "Unknown"} is outside the allowed policy scope.`,
      recommendation: "Restrict usage to approved departments or update the policy scope.",
    });
  }

  if (includesIgnoreCase(rules.blockedDepartments, system.department)) {
    issues.push({
      message: `Department ${system.department ?? "Unknown"} is blocked by this policy.`,
      recommendation: "Reassign ownership or request an exception for this department.",
    });
  }

  if (
    rules.allowedModelPatterns?.length &&
    !patternMatch(rules.allowedModelPatterns, system.modelType)
  ) {
    issues.push({
      message: `Model ${system.modelType ?? "Unknown"} does not match the approved model patterns for this policy.`,
      recommendation: "Use an approved model family or document the deviation as an exception.",
    });
  }

  if (patternMatch(rules.blockedModelPatterns, system.modelType)) {
    issues.push({
      message: `Model ${system.modelType ?? "Unknown"} matches a blocked pattern in this policy.`,
      recommendation: "Move to an approved model family or seek an explicit exception.",
    });
  }

  if (
    rules.allowedStatuses?.length &&
    !rules.allowedStatuses.includes(system.status)
  ) {
    issues.push({
      message: `System status ${system.status} is outside the statuses allowed by this policy.`,
      recommendation: "Advance or retire the system before applying this policy scope.",
    });
  }

  if (
    rules.maxReviewIntervalDays &&
    system.reviewIntervalDays > rules.maxReviewIntervalDays
  ) {
    issues.push({
      message: `Review interval of ${system.reviewIntervalDays} days exceeds the policy maximum of ${rules.maxReviewIntervalDays} days.`,
      recommendation: `Reduce the review interval to ${rules.maxReviewIntervalDays} days or less.`,
    });
  }

  if (
    rules.minimumRiskLevel &&
    riskRank[system.riskLevel] < riskRank[rules.minimumRiskLevel]
  ) {
    issues.push({
      message: `Risk level ${system.riskLevel} is lower than the policy minimum of ${rules.minimumRiskLevel}.`,
      recommendation: `Increase the documented risk level to at least ${rules.minimumRiskLevel}.`,
    });
  }

  if (rules.requiredStages?.length) {
    const presentStages = new Set<GovernanceReviewStage>([
      ...(system.requireOwnerApproval ? ["OWNER" as const] : []),
      ...(system.requireSecurityApproval ? ["SECURITY" as const] : []),
      ...(system.requireLegalApproval ? ["LEGAL" as const] : []),
      ...(system.requireComplianceApproval ? ["COMPLIANCE" as const] : []),
    ]);
    const missingStages = rules.requiredStages.filter(
      (stage) => !presentStages.has(stage)
    );
    if (missingStages.length) {
      issues.push({
        message: `Missing required approval stages: ${missingStages.join(", ")}.`,
        recommendation: "Enable the missing governance stages before seeking approval.",
      });
    }
  }

  return issues;
}

export function evaluatePolicyRules(rules: PolicyRuleSet, system: EvaluationInput) {
  const issues = collectIssues(rules, system);
  const enforcement = rules.actions?.enforcement ?? "BLOCK";
  const canWaiveWithException = !!rules.actions?.allowException;
  const hasActiveException = (system.activeExceptionCount ?? 0) > 0;

  const blockingViolations: string[] = [];
  const waivedViolations: string[] = [];
  const advisories: string[] = [];
  const recommendations: string[] = [];

  for (const issue of issues) {
    if (issue.recommendation) recommendations.push(issue.recommendation);

    if (enforcement === "ADVISORY") {
      advisories.push(issue.message);
      continue;
    }

    if (canWaiveWithException && hasActiveException) {
      waivedViolations.push(issue.message);
      continue;
    }

    blockingViolations.push(issue.message);
  }

  if (waivedViolations.length > 0) {
    recommendations.push(
      "Active governance exceptions currently waive one or more blocking rule findings. Review those exceptions before renewal or deployment changes."
    );
  }

  if (advisories.length > 0 && enforcement === "ADVISORY") {
    recommendations.push(
      "This policy is configured as advisory, so these findings should be reviewed but do not automatically block approval."
    );
  }

  const recommendedComplianceStatus: ComplianceStatus =
    blockingViolations.length > 0
      ? rules.actions?.recommendedComplianceStatus ?? "NON_COMPLIANT"
      : waivedViolations.length > 0 || advisories.length > 0
        ? "PARTIALLY_COMPLIANT"
        : "COMPLIANT";

  return {
    compliant: blockingViolations.length === 0,
    violations: blockingViolations,
    blockingViolations,
    waivedViolations,
    advisories,
    recommendations: Array.from(new Set(recommendations)),
    recommendedComplianceStatus,
    enforcement,
    exceptionApplied:
      enforcement === "BLOCK" && canWaiveWithException && hasActiveException,
  };
}
