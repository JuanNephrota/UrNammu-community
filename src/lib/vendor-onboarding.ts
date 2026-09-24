import type { ChecklistItem } from "@/lib/workflow";
import { formatDateForInput } from "@/lib/utils";

// Profile setup steps, in wizard order. Step ids double as `?step=` values.
export const VENDOR_SETUP_STEPS = [
  { id: "identity", label: "Identity", description: "Who the vendor is" },
  { id: "contract", label: "Contract", description: "Owner, status and dates" },
  { id: "data", label: "Data", description: "Residency and subprocessors" },
  { id: "use-cases", label: "Use cases", description: "What it's approved for" },
  { id: "review", label: "Review", description: "Check and finish" },
] as const;

export type VendorSetupStepId = (typeof VENDOR_SETUP_STEPS)[number]["id"];

/** Questionnaires older than this are treated as stale and re-requested. */
export const VENDOR_ASSESSMENT_MAX_AGE_DAYS = 365;

export type VendorChecklistInput = {
  id: string;
  website: string | null;
  description: string | null;
  contractOwner: string | null;
  contractStatus: string;
  contractRenewalDate: Date | null;
  dataResidency: string[];
  subprocessors: string[];
  approvedUseCases: string[];
  securityReviewStatus: string;
  /** When the most recent completed questionnaire finished, if any. */
  lastAssessmentCompletedAt: Date | null;
  assessmentInProgress: boolean;
};

export function asStringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
}

export function getVendorChecklist(input: VendorChecklistInput, now = new Date()): ChecklistItem[] {
  const setup = (step: VendorSetupStepId) => `/oversight/vendors/${input.id}/setup?step=${step}`;
  const assessmentHref = `/oversight/vendors/${input.id}/assessment`;

  const assessmentAgeDays =
    input.lastAssessmentCompletedAt != null
      ? Math.floor((now.getTime() - input.lastAssessmentCompletedAt.getTime()) / 86400000)
      : null;
  // A re-assessment in progress doesn't undo a completed one that's still current.
  const assessmentCurrent =
    assessmentAgeDays !== null && assessmentAgeDays <= VENDOR_ASSESSMENT_MAX_AGE_DAYS;

  let assessmentDetail = "Answer the security and data-handling questionnaire.";
  if (assessmentCurrent) {
    assessmentDetail = `Completed ${assessmentAgeDays === 0 ? "today" : `${assessmentAgeDays} days ago`}.`;
    if (input.assessmentInProgress) assessmentDetail += " A re-assessment is in progress.";
  } else if (input.assessmentInProgress) {
    assessmentDetail = "A questionnaire is in progress. Pick up where you left off.";
  } else if (assessmentAgeDays !== null) {
    assessmentDetail = `Last completed ${assessmentAgeDays} days ago. Re-assess yearly.`;
  }

  const decided = ["APPROVED", "CONDITIONAL", "REJECTED"].includes(input.securityReviewStatus);

  return [
    {
      id: "identity",
      label: "Describe the vendor",
      detail: "Add a website and a short description of what the vendor provides.",
      done: Boolean(input.website?.trim() && input.description?.trim()),
      href: setup("identity"),
    },
    {
      id: "contract-owner",
      label: "Assign a contract owner",
      detail: "The person in legal or procurement accountable for this relationship.",
      done: Boolean(input.contractOwner?.trim()),
      href: setup("contract"),
    },
    {
      id: "contract-status",
      label: "Record contract status and renewal date",
      detail: "Drives the renewal queue and the vendor risk score.",
      done: input.contractStatus !== "UNKNOWN" && input.contractRenewalDate !== null,
      href: setup("contract"),
    },
    {
      id: "data",
      label: "Document data residency and subprocessors",
      detail: "Where data is processed and who else touches it.",
      done: input.dataResidency.length > 0 && input.subprocessors.length > 0,
      href: setup("data"),
    },
    {
      id: "use-cases",
      label: "List approved use cases",
      detail: "Live systems using this vendor outside these use cases are flagged.",
      done: input.approvedUseCases.length > 0,
      href: setup("use-cases"),
    },
    {
      id: "questionnaire",
      label: "Complete the vendor risk questionnaire",
      detail: assessmentDetail,
      done: assessmentCurrent,
      href: assessmentHref,
    },
    {
      id: "decision",
      label: "Record a security review decision",
      detail: decided
        ? `Decision on file: ${input.securityReviewStatus.replace(/_/g, " ").toLowerCase()}.`
        : "Approve, conditionally approve or reject. Set at the end of the questionnaire.",
      done: decided,
      href: assessmentHref,
    },
  ];
}

/** Form state for the setup wizard. Dates are yyyy-mm-dd strings. */
export type VendorSetupValues = {
  vendor: string;
  website: string;
  description: string;
  contractOwner: string;
  contractStatus: string;
  contractStartDate: string;
  contractRenewalDate: string;
  renewalNoticeDays: number;
  renewalNotes: string;
  dataResidency: string[];
  subprocessors: string[];
  approvedUseCases: string[];
  notes: string;
};


export function toVendorSetupValues(profile: {
  vendor: string;
  website: string | null;
  description: string | null;
  contractOwner: string | null;
  contractStatus: string;
  contractStartDate: Date | null;
  contractRenewalDate: Date | null;
  renewalNoticeDays: number;
  renewalNotes: string | null;
  dataResidency: string[];
  subprocessors: string[];
  approvedUseCases: string[];
  notes: string | null;
}): VendorSetupValues {
  return {
    vendor: profile.vendor,
    website: profile.website ?? "",
    description: profile.description ?? "",
    contractOwner: profile.contractOwner ?? "",
    contractStatus: profile.contractStatus,
    contractStartDate: formatDateForInput(profile.contractStartDate),
    contractRenewalDate: formatDateForInput(profile.contractRenewalDate),
    renewalNoticeDays: profile.renewalNoticeDays,
    renewalNotes: profile.renewalNotes ?? "",
    dataResidency: profile.dataResidency,
    subprocessors: profile.subprocessors,
    approvedUseCases: profile.approvedUseCases,
    notes: profile.notes ?? "",
  };
}
