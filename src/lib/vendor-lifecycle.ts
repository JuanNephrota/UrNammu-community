export type VendorLifecycleSummary = {
  phase:
    | "UNKNOWN"
    | "IN_REVIEW"
    | "ACTIVE"
    | "RENEWAL_DUE"
    | "RENEWAL_SOON"
    | "OVERDUE"
    | "EXPIRED"
    | "TERMINATED";
  badgeTone: "outline" | "info" | "success" | "warning" | "critical";
  daysUntilRenewal: number | null;
  message: string;
};

export function getVendorLifecycleSummary(input: {
  contractStatus: string;
  contractStartDate: Date | null;
  contractRenewalDate: Date | null;
  renewalNoticeDays: number;
}) : VendorLifecycleSummary {
  const now = Date.now();

  if (input.contractStatus === "TERMINATED") {
    return {
      phase: "TERMINATED",
      badgeTone: "critical",
      daysUntilRenewal: null,
      message: "Vendor relationship is marked terminated.",
    };
  }

  if (input.contractStatus === "EXPIRED") {
    return {
      phase: "EXPIRED",
      badgeTone: "critical",
      daysUntilRenewal: input.contractRenewalDate
        ? Math.ceil((input.contractRenewalDate.getTime() - now) / 86400000)
        : null,
      message: "Contract posture is expired and should be renewed or retired.",
    };
  }

  if (input.contractStatus === "IN_REVIEW") {
    return {
      phase: "IN_REVIEW",
      badgeTone: "warning",
      daysUntilRenewal: null,
      message: "Vendor contract is still in procurement or review.",
    };
  }

  if (input.contractStatus === "UNKNOWN") {
    return {
      phase: "UNKNOWN",
      badgeTone: "outline",
      daysUntilRenewal: null,
      message: "No contract lifecycle is documented yet.",
    };
  }

  if (!input.contractRenewalDate) {
    return {
      phase: "ACTIVE",
      badgeTone: "success",
      daysUntilRenewal: null,
      message: input.contractStartDate
        ? "Contract is active, but no renewal date is documented."
        : "Contract is active.",
    };
  }

  const daysUntilRenewal = Math.ceil(
    (input.contractRenewalDate.getTime() - now) / 86400000
  );

  if (daysUntilRenewal < 0) {
    return {
      phase: "OVERDUE",
      badgeTone: "critical",
      daysUntilRenewal,
      message: "Renewal date has passed and follow-up is overdue.",
    };
  }

  if (daysUntilRenewal <= 30) {
    return {
      phase: "RENEWAL_DUE",
      badgeTone: "critical",
      daysUntilRenewal,
      message: `Renewal is due in ${daysUntilRenewal} day${daysUntilRenewal === 1 ? "" : "s"}.`,
    };
  }

  if (daysUntilRenewal <= input.renewalNoticeDays) {
    return {
      phase: "RENEWAL_SOON",
      badgeTone: "warning",
      daysUntilRenewal,
      message: `Renewal is inside the ${input.renewalNoticeDays}-day notice window.`,
    };
  }

  return {
    phase: "ACTIVE",
    badgeTone: "success",
    daysUntilRenewal,
    message: "Contract is active and outside the current renewal window.",
  };
}
