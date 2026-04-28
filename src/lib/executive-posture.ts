// Executive posture scoring, delta calculation, and narrative generation.
// All logic is template-driven — no AI calls required.

export type PostureMetrics = {
  // Governance coverage
  totalSystems: number;
  approvedOrDeployed: number;
  draftOrReview: number;

  // Compliance
  totalComplianceMappings: number;
  compliantMappings: number;

  // Risk
  avgRiskScore: number; // 0–100 (from risk assessments)
  highOrCriticalSystems: number;

  // Shadow AI
  discoveredTools: number;
  underReviewTools: number;
  totalDiscoveryTools: number; // all statuses

  // Incidents & alerts
  openIncidents: number;
  criticalAlerts: number;
  openAlerts: number;

  // Spend
  totalSpend: number;
  topProvider: string | null;
  topProviderSpend: number;
};

export type PostureDimension = {
  key: string;
  label: string;
  score: number; // 0–100
  weight: number;
  detail: string;
};

export type PostureScore = {
  score: number; // 0–100 composite
  delta: number; // vs prior period
  tier: "strong" | "moderate" | "needs_attention";
  dimensions: PostureDimension[];
};

export type BoardMetric = {
  label: string;
  value: string;
  delta: number | null; // positive = improvement
  deltaLabel: string;
  variant: "success" | "warning" | "danger" | "info" | "default";
};

export type ExecutivePosture = {
  score: PostureScore;
  boardMetrics: BoardMetric[];
  narrative: string[];
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function scoreTier(score: number): "strong" | "moderate" | "needs_attention" {
  if (score >= 75) return "strong";
  if (score >= 50) return "moderate";
  return "needs_attention";
}

function computeDimensionScores(m: PostureMetrics): PostureDimension[] {
  // 1. Compliance (25%)
  const complianceRate =
    m.totalComplianceMappings > 0
      ? (m.compliantMappings / m.totalComplianceMappings) * 100
      : 100; // no mappings = no gaps
  const complianceScore = clamp(Math.round(complianceRate), 0, 100);

  // 2. Risk (25%) — inverse of avg risk score
  // Risk assessments use 0-100 where higher = more risky
  const riskScore = clamp(Math.round(100 - m.avgRiskScore), 0, 100);

  // 3. Governance coverage (20%)
  const coverageRate =
    m.totalSystems > 0
      ? (m.approvedOrDeployed / m.totalSystems) * 100
      : 100;
  const coverageScore = clamp(Math.round(coverageRate), 0, 100);

  // 4. Shadow AI (15%) — fewer ungoverned = higher score
  const ungovernedRatio =
    m.totalDiscoveryTools > 0
      ? m.discoveredTools / m.totalDiscoveryTools
      : 0;
  const shadowScore = clamp(Math.round((1 - ungovernedRatio) * 100), 0, 100);

  // 5. Incident health (15%)
  // Scale: 0 incidents = 100, each open incident costs 10pts, each critical alert costs 15pts
  const incidentPenalty =
    m.openIncidents * 10 + m.criticalAlerts * 15 + m.openAlerts * 3;
  const maxPenalty = Math.max(m.totalSystems * 5, 50); // normalize to system count
  const incidentScore = clamp(
    Math.round(100 - (incidentPenalty / maxPenalty) * 100),
    0,
    100
  );

  return [
    {
      key: "compliance",
      label: "Compliance",
      score: complianceScore,
      weight: 0.25,
      detail: `${m.compliantMappings} of ${m.totalComplianceMappings} mappings compliant`,
    },
    {
      key: "risk",
      label: "Risk Posture",
      score: riskScore,
      weight: 0.25,
      detail: `Avg risk score: ${m.avgRiskScore.toFixed(0)}/100. ${m.highOrCriticalSystems} high/critical systems`,
    },
    {
      key: "coverage",
      label: "Governance Coverage",
      score: coverageScore,
      weight: 0.2,
      detail: `${m.approvedOrDeployed} of ${m.totalSystems} systems approved or deployed`,
    },
    {
      key: "shadow",
      label: "Shadow AI",
      score: shadowScore,
      weight: 0.15,
      detail: `${m.discoveredTools} ungoverned tools out of ${m.totalDiscoveryTools} discovered`,
    },
    {
      key: "incidents",
      label: "Incident Health",
      score: incidentScore,
      weight: 0.15,
      detail: `${m.openIncidents} open incidents, ${m.criticalAlerts} critical alerts`,
    },
  ];
}

function computeComposite(dimensions: PostureDimension[]): number {
  const weighted = dimensions.reduce(
    (sum, d) => sum + d.score * d.weight,
    0
  );
  return clamp(Math.round(weighted), 0, 100);
}

export function buildNarrative(
  current: PostureMetrics,
  prior: PostureMetrics | null,
  score: PostureScore
): string[] {
  const paragraphs: string[] = [];

  // Opening
  const tierLabel =
    score.tier === "strong"
      ? "Strong"
      : score.tier === "moderate"
        ? "Moderate"
        : "Needs Attention";
  const deltaDir = score.delta > 0 ? "up" : score.delta < 0 ? "down" : "unchanged";
  const deltaText =
    score.delta !== 0
      ? `, ${deltaDir} ${Math.abs(score.delta)} points from the prior period`
      : "";
  paragraphs.push(
    `Your AI governance posture is ${tierLabel} at ${score.score}/100${deltaText}.`
  );

  // Compliance
  const complianceRate =
    current.totalComplianceMappings > 0
      ? Math.round(
          (current.compliantMappings / current.totalComplianceMappings) * 100
        )
      : 100;
  let complianceText = `${current.compliantMappings} of ${current.totalComplianceMappings} compliance mappings are fully compliant (${complianceRate}%).`;
  if (prior && prior.totalComplianceMappings > 0) {
    const priorRate = Math.round(
      (prior.compliantMappings / prior.totalComplianceMappings) * 100
    );
    const rateDelta = complianceRate - priorRate;
    if (rateDelta < 0) {
      complianceText += ` Compliance dropped ${Math.abs(rateDelta)} percentage points since last period.`;
    } else if (rateDelta > 0) {
      complianceText += ` Compliance improved by ${rateDelta} percentage points.`;
    }
  }
  paragraphs.push(complianceText);

  // Risk
  let riskText = `Average risk score across assessed systems is ${current.avgRiskScore.toFixed(0)}/100. ${current.highOrCriticalSystems} system${current.highOrCriticalSystems !== 1 ? "s are" : " is"} rated HIGH or CRITICAL.`;
  if (prior) {
    const riskDelta = current.highOrCriticalSystems - prior.highOrCriticalSystems;
    if (riskDelta > 0) {
      riskText += ` High-risk systems increased by ${riskDelta} since last period.`;
    } else if (riskDelta < 0) {
      riskText += ` High-risk systems decreased by ${Math.abs(riskDelta)}.`;
    }
  }
  paragraphs.push(riskText);

  // Spend
  let spendText = `Total AI spend this period: $${current.totalSpend.toFixed(2)}.`;
  if (current.topProvider) {
    spendText += ` Top provider: ${current.topProvider} ($${current.topProviderSpend.toFixed(2)}).`;
  }
  if (prior && prior.totalSpend > 0) {
    const spendDelta = ((current.totalSpend - prior.totalSpend) / prior.totalSpend) * 100;
    if (Math.abs(spendDelta) >= 1) {
      spendText += ` Spend ${spendDelta > 0 ? "increased" : "decreased"} ${Math.abs(spendDelta).toFixed(0)}% vs prior period.`;
    }
  }
  paragraphs.push(spendText);

  // Shadow AI
  if (current.totalDiscoveryTools > 0) {
    let shadowText = `${current.discoveredTools} unregistered tool${current.discoveredTools !== 1 ? "s" : ""} discovered. ${current.underReviewTools} currently under review.`;
    if (prior && current.discoveredTools > prior.discoveredTools) {
      shadowText += ` New discoveries increased by ${current.discoveredTools - prior.discoveredTools}.`;
    }
    paragraphs.push(shadowText);
  }

  // Incidents
  let incidentText = `${current.openIncidents} open incident${current.openIncidents !== 1 ? "s" : ""} and ${current.criticalAlerts} critical alert${current.criticalAlerts !== 1 ? "s" : ""}.`;
  if (prior) {
    const incDelta = current.openIncidents - prior.openIncidents;
    if (incDelta > 0) {
      incidentText += ` Open incidents increased by ${incDelta} — review recommended.`;
    } else if (incDelta < 0) {
      incidentText += ` Open incidents decreased by ${Math.abs(incDelta)}.`;
    }
  }
  paragraphs.push(incidentText);

  return paragraphs;
}

function buildBoardMetrics(
  current: PostureMetrics,
  prior: PostureMetrics | null,
  score: PostureScore
): BoardMetric[] {
  const priorDimensions = prior
    ? computeDimensionScores(prior)
    : null;
  const priorComposite = priorDimensions
    ? computeComposite(priorDimensions)
    : null;

  const complianceRate =
    current.totalComplianceMappings > 0
      ? Math.round(
          (current.compliantMappings / current.totalComplianceMappings) * 100
        )
      : 100;
  const priorComplianceRate =
    prior && prior.totalComplianceMappings > 0
      ? Math.round(
          (prior.compliantMappings / prior.totalComplianceMappings) * 100
        )
      : null;

  return [
    {
      label: "Governance Score",
      value: `${score.score}/100`,
      delta: priorComposite !== null ? score.score - priorComposite : null,
      deltaLabel: "pts vs prior",
      variant:
        score.tier === "strong"
          ? "success"
          : score.tier === "moderate"
            ? "warning"
            : "danger",
    },
    {
      label: "Compliance Rate",
      value: `${complianceRate}%`,
      delta:
        priorComplianceRate !== null
          ? complianceRate - priorComplianceRate
          : null,
      deltaLabel: "pp vs prior",
      variant: complianceRate >= 90 ? "success" : complianceRate >= 70 ? "warning" : "danger",
    },
    {
      label: "Avg Risk Score",
      value: current.avgRiskScore.toFixed(0),
      delta: prior
        ? -Math.round(current.avgRiskScore - prior.avgRiskScore) // negative = improvement (lower risk)
        : null,
      deltaLabel: "pts improvement",
      variant:
        current.avgRiskScore <= 30
          ? "success"
          : current.avgRiskScore <= 60
            ? "warning"
            : "danger",
    },
    {
      label: "Monthly Spend",
      value: `$${current.totalSpend.toFixed(0)}`,
      delta:
        prior && prior.totalSpend > 0
          ? Math.round(
              ((current.totalSpend - prior.totalSpend) / prior.totalSpend) *
                100
            )
          : null,
      deltaLabel: "% vs prior",
      variant: "info",
    },
    {
      label: "Shadow AI Backlog",
      value: String(current.discoveredTools + current.underReviewTools),
      delta: prior
        ? -(
            current.discoveredTools +
            current.underReviewTools -
            (prior.discoveredTools + prior.underReviewTools)
          )
        : null,
      deltaLabel: "fewer pending",
      variant:
        current.discoveredTools + current.underReviewTools === 0
          ? "success"
          : current.discoveredTools > 5
            ? "danger"
            : "warning",
    },
    {
      label: "Open Incidents",
      value: String(current.openIncidents),
      delta: prior ? -(current.openIncidents - prior.openIncidents) : null,
      deltaLabel: "fewer open",
      variant:
        current.openIncidents === 0
          ? "success"
          : current.openIncidents >= 3
            ? "danger"
            : "warning",
    },
  ];
}

export function computeExecutivePosture(
  current: PostureMetrics,
  prior: PostureMetrics | null
): ExecutivePosture {
  const dimensions = computeDimensionScores(current);
  const composite = computeComposite(dimensions);

  const priorDimensions = prior ? computeDimensionScores(prior) : null;
  const priorComposite = priorDimensions
    ? computeComposite(priorDimensions)
    : null;

  const delta = priorComposite !== null ? composite - priorComposite : 0;

  const score: PostureScore = {
    score: composite,
    delta,
    tier: scoreTier(composite),
    dimensions,
  };

  const narrative = buildNarrative(current, prior, score);
  const boardMetrics = buildBoardMetrics(current, prior, score);

  return { score, boardMetrics, narrative };
}
