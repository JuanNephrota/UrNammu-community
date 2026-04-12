export type VendorRiskInput = {
  vendor: string;
  systems: number;
  openAlerts: number;
  incidents: number;
  exceptions: number;
  highRisk: number;
  discovered: number;
  unapprovedUseCases: number;
  contractStatus: string;
  securityReviewStatus: string;
  contractRenewalDate: Date | null;
};

export type VendorRiskFactor = {
  label: string;
  points: number;
  detail: string;
};

export type VendorRiskSummary = {
  score: number;
  tier: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  factors: VendorRiskFactor[];
};

function tierFromScore(score: number): VendorRiskSummary["tier"] {
  if (score >= 80) return "CRITICAL";
  if (score >= 60) return "HIGH";
  if (score >= 35) return "MEDIUM";
  return "LOW";
}

export function getVendorRiskSummary(input: VendorRiskInput): VendorRiskSummary {
  const factors: VendorRiskFactor[] = [];
  let score = 0;

  if (input.contractStatus === "EXPIRED") {
    score += 26;
    factors.push({
      label: "Contract expired",
      points: 26,
      detail: "This vendor has governed usage but the contract posture is expired.",
    });
  } else if (input.contractStatus === "TERMINATED") {
    score += 35;
    factors.push({
      label: "Contract terminated",
      points: 35,
      detail: "Governed usage is still associated with a terminated vendor relationship.",
    });
  } else if (input.contractStatus === "IN_REVIEW") {
    score += 12;
    factors.push({
      label: "Contract still in review",
      points: 12,
      detail: "Commercial posture is not fully settled yet.",
    });
  } else if (input.contractStatus === "UNKNOWN") {
    score += 16;
    factors.push({
      label: "Unknown contract posture",
      points: 16,
      detail: "The vendor is in use but no contract state is documented.",
    });
  }

  if (input.securityReviewStatus === "REJECTED") {
    score += 35;
    factors.push({
      label: "Security review rejected",
      points: 35,
      detail: "Security review status is explicitly rejected.",
    });
  } else if (input.securityReviewStatus === "CONDITIONAL") {
    score += 18;
    factors.push({
      label: "Conditional security approval",
      points: 18,
      detail: "The vendor is approved only with conditions or carve-outs.",
    });
  } else if (input.securityReviewStatus === "IN_PROGRESS") {
    score += 10;
    factors.push({
      label: "Security review in progress",
      points: 10,
      detail: "Security review is not complete yet.",
    });
  } else if (input.securityReviewStatus === "NOT_REVIEWED") {
    score += 16;
    factors.push({
      label: "No security review on file",
      points: 16,
      detail: "The vendor has governed usage but no documented security review.",
    });
  }

  if (input.contractRenewalDate) {
    const daysUntilRenewal = Math.ceil(
      (input.contractRenewalDate.getTime() - Date.now()) / 86400000
    );
    if (daysUntilRenewal < 0) {
      score += 18;
      factors.push({
        label: "Renewal overdue",
        points: 18,
        detail: "The recorded renewal date is already in the past.",
      });
    } else if (daysUntilRenewal <= 30) {
      score += 10;
      factors.push({
        label: "Renewal approaching",
        points: 10,
        detail: "The contract renewal date is within the next 30 days.",
      });
    }
  }

  if (input.incidents > 0) {
    const points = Math.min(24, input.incidents * 8);
    score += points;
    factors.push({
      label: "Open incidents",
      points,
      detail:
        input.incidents === 1
          ? "There is an open governance incident involving this vendor."
          : `There are ${input.incidents} open governance incidents involving this vendor.`,
    });
  }

  if (input.openAlerts > 0) {
    const points = Math.min(15, input.openAlerts * 3);
    score += points;
    factors.push({
      label: "Open alerts",
      points,
      detail:
        input.openAlerts === 1
          ? "There is 1 open alert tied to systems using this vendor."
          : `There are ${input.openAlerts} open alerts tied to systems using this vendor.`,
    });
  }

  if (input.exceptions > 0) {
    const points = Math.min(12, input.exceptions * 3);
    score += points;
    factors.push({
      label: "Active exceptions",
      points,
      detail:
        input.exceptions === 1
          ? "This vendor currently relies on 1 active governance exception."
          : `This vendor currently relies on ${input.exceptions} active governance exceptions.`,
    });
  }

  if (input.highRisk > 0) {
    const points = Math.min(20, input.highRisk * 5);
    score += points;
    factors.push({
      label: "High-risk systems",
      points,
      detail:
        input.highRisk === 1
          ? "One governed system using this vendor is high risk."
          : `${input.highRisk} governed systems using this vendor are high risk.`,
    });
  }

  if (input.unapprovedUseCases > 0) {
    const points = Math.min(15, input.unapprovedUseCases * 4);
    score += points;
    factors.push({
      label: "Unapproved use cases",
      points,
      detail:
        input.unapprovedUseCases === 1
          ? "There is 1 live use case not covered by the approved list."
          : `There are ${input.unapprovedUseCases} live use cases not covered by the approved list.`,
    });
  }

  if (input.discovered > input.systems) {
    score += 6;
    factors.push({
      label: "Shadow AI exposure",
      points: 6,
      detail: "Shadow AI discoveries exceed governed systems for this vendor.",
    });
  }

  const normalized = Math.min(100, score);
  return {
    score: normalized,
    tier: tierFromScore(normalized),
    factors: factors.sort((a, b) => b.points - a.points),
  };
}
