import type { ChecklistItem } from "@/lib/workflow";

// Registration wizard steps. Step ids double as `?step=` values.
export const SYSTEM_SETUP_STEPS = [
  { id: "basics", label: "Basics", description: "Name, owner team, purpose" },
  { id: "data", label: "Data & tech", description: "Vendor, model, data handled" },
  { id: "governance", label: "Governance", description: "Review cadence and approvals" },
  { id: "review", label: "Review", description: "Check and continue" },
] as const;

export type SystemSetupStepId = (typeof SYSTEM_SETUP_STEPS)[number]["id"];

/** Vendor values that mean "built in-house", which need no vendor profile. */
const IN_HOUSE_VENDORS = new Set(["internal", "in-house", "inhouse", "self", "none", "n/a"]);

export function isExternalVendor(vendor: string | null | undefined) {
  const value = vendor?.trim().toLowerCase();
  return Boolean(value && !IN_HOUSE_VENDORS.has(value));
}

export type SystemChecklistInput = {
  id: string;
  description: string | null;
  useCase: string | null;
  vendor: string | null;
  modelType: string | null;
  dataInputs: string | null;
  dataOutputs: string | null;
  riskAssessmentsCount: number;
  hasEuAiActClassification: boolean;
  policyAssignmentsCount: number;
  evidenceCount: number;
  requiredStages: string[];
  approvedStages: string[];
  latestApprovalDecision: string | null;
  /** The vendor's governance profile, when the system names an external vendor. */
  vendorProfile: { id: string; securityReviewStatus: string } | null;
};

export function getSystemChecklist(input: SystemChecklistInput): ChecklistItem[] {
  const setup = (step: SystemSetupStepId) => `/registry/${input.id}/setup?step=${step}`;
  const missingStages = input.requiredStages.filter((stage) => !input.approvedStages.includes(stage));
  const stageList = (stages: string[]) =>
    stages.map((stage) => stage.charAt(0) + stage.slice(1).toLowerCase()).join(", ");

  const items: ChecklistItem[] = [
    {
      id: "describe",
      label: "Describe the system and its use case",
      detail: "Reviewers and the AI assistant work from this description.",
      done: Boolean(input.description?.trim() && input.useCase?.trim()),
      href: setup("basics"),
    },
    {
      id: "data",
      label: "Document the vendor, model and data it handles",
      detail: "Data inputs and outputs drive the contextual risk questions.",
      done: Boolean(
        input.dataInputs?.trim() && input.dataOutputs?.trim() && (input.vendor?.trim() || input.modelType?.trim())
      ),
      href: setup("data"),
    },
  ];

  if (isExternalVendor(input.vendor)) {
    const profile = input.vendorProfile;
    const status = profile?.securityReviewStatus;
    const vendorDone = status === "APPROVED" || status === "CONDITIONAL";
    items.push({
      id: "vendor",
      label: `Clear the vendor (${input.vendor})`,
      detail: !profile
        ? "The vendor has no governance profile yet."
        : status === "REJECTED"
          ? "The vendor's security review was rejected."
          : vendorDone
            ? `Vendor security review: ${status === "APPROVED" ? "approved" : "approved with conditions"}.`
            : "The vendor's security review isn't finished.",
      done: vendorDone,
      href: profile
        ? `/oversight/vendors/${profile.id}`
        : `/oversight/vendors/new?vendor=${encodeURIComponent(input.vendor ?? "")}`,
    });
  }

  items.push(
    {
      id: "risk",
      label: "Complete a risk assessment",
      detail:
        input.riskAssessmentsCount > 0
          ? `${input.riskAssessmentsCount} assessment${input.riskAssessmentsCount === 1 ? "" : "s"} on file.`
          : "Score the six risk dimensions and record issues.",
      done: input.riskAssessmentsCount > 0,
      href: `/risk-center/assessments/new?systemId=${input.id}`,
    },
    {
      id: "eu-ai-act",
      label: "Classify under the EU AI Act",
      detail: "Records the risk tier and your role (provider, deployer, ...).",
      done: input.hasEuAiActClassification,
      href: `/registry/${input.id}/eu-ai-act`,
    },
    {
      id: "policy",
      label: "Assign governing policies",
      detail: "Policies bring framework controls and compliance status.",
      done: input.policyAssignmentsCount > 0,
      href: `/registry/${input.id}?tab=compliance`,
    },
    {
      id: "evidence",
      label: "Upload supporting evidence",
      detail: "For example a vendor SOC 2 report, DPIA or model card.",
      done: input.evidenceCount > 0,
      href: `/registry/${input.id}#evidence`,
    }
  );

  if (input.requiredStages.length > 0) {
    items.push({
      id: "reviews",
      label: "Complete the required governance reviews",
      detail:
        missingStages.length === 0
          ? `${stageList(input.requiredStages)} approved.`
          : `Waiting on: ${stageList(missingStages)}.`,
      done: missingStages.length === 0,
      href: `/registry/${input.id}#reviews`,
    });
  }

  items.push({
    id: "approval",
    label: "Record the approval decision",
    detail:
      input.latestApprovalDecision === "APPROVED"
        ? "Approved for use."
        : input.latestApprovalDecision
          ? `Latest decision: ${input.latestApprovalDecision.replace(/_/g, " ").toLowerCase()}.`
          : "The final sign-off once everything above is in place.",
    done: input.latestApprovalDecision === "APPROVED",
    href: `/registry/${input.id}#approval`,
  });

  return items;
}

/** Form state for the registration wizard. Dates are yyyy-mm-dd strings. */
export type SystemSetupValues = {
  name: string;
  department: string;
  description: string;
  useCase: string;
  version: string;
  vendor: string;
  modelType: string;
  dataSensitivity: string;
  dataInputs: string;
  dataOutputs: string;
  riskLevel: string;
  status: string;
  reviewIntervalDays: number;
  nextReviewDate: string;
  requireOwnerApproval: boolean;
  requireSecurityApproval: boolean;
  requireLegalApproval: boolean;
  requireComplianceApproval: boolean;
};

export const EMPTY_SYSTEM_VALUES: SystemSetupValues = {
  name: "",
  department: "",
  description: "",
  useCase: "",
  version: "",
  vendor: "",
  modelType: "",
  dataSensitivity: "INTERNAL",
  dataInputs: "",
  dataOutputs: "",
  riskLevel: "MEDIUM",
  status: "DRAFT",
  reviewIntervalDays: 365,
  nextReviewDate: "",
  requireOwnerApproval: true,
  requireSecurityApproval: true,
  requireLegalApproval: false,
  requireComplianceApproval: true,
};

export function toSystemSetupValues(system: {
  name: string;
  department: string;
  description: string | null;
  useCase: string | null;
  version: string | null;
  vendor: string | null;
  modelType: string | null;
  dataSensitivity: string;
  dataInputs: string | null;
  dataOutputs: string | null;
  riskLevel: string;
  status: string;
  reviewIntervalDays: number;
  nextReviewDate: Date | null;
  requireOwnerApproval: boolean;
  requireSecurityApproval: boolean;
  requireLegalApproval: boolean;
  requireComplianceApproval: boolean;
}): SystemSetupValues {
  return {
    name: system.name,
    department: system.department,
    description: system.description ?? "",
    useCase: system.useCase ?? "",
    version: system.version ?? "",
    vendor: system.vendor ?? "",
    modelType: system.modelType ?? "",
    dataSensitivity: system.dataSensitivity,
    dataInputs: system.dataInputs ?? "",
    dataOutputs: system.dataOutputs ?? "",
    riskLevel: system.riskLevel,
    status: system.status,
    reviewIntervalDays: system.reviewIntervalDays,
    nextReviewDate: system.nextReviewDate ? system.nextReviewDate.toISOString().slice(0, 10) : "",
    requireOwnerApproval: system.requireOwnerApproval,
    requireSecurityApproval: system.requireSecurityApproval,
    requireLegalApproval: system.requireLegalApproval,
    requireComplianceApproval: system.requireComplianceApproval,
  };
}
