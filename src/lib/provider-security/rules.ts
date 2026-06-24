import type { ProviderMeta } from "./providers";

export type CheckDimension =
  | "dataHandling"
  | "retention"
  | "trainingUse"
  | "encryption"
  | "accessControl"
  | "residency";

export const DIMENSION_LABELS: Record<CheckDimension, string> = {
  dataHandling: "Data Handling",
  retention: "Retention",
  trainingUse: "Training & Use",
  encryption: "Encryption",
  accessControl: "Access Control",
  residency: "Data Residency",
};

/** pass = control in place · warn = present but unconfirmed/partial · fail = gap. */
export type CheckStatus = "pass" | "warn" | "fail" | "not_applicable";

/**
 * How confident we are in the check outcome:
 *  - verified:  confirmed by a live API read this scan
 *  - attested:  backed by a recorded VendorProfile fact
 *  - inferred:  based on the provider's documented default, unconfirmed here
 */
export type Verification = "verified" | "attested" | "inferred";

export type CheckSeverity = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "INFO";

export interface ProviderSecurityCheck {
  id: string;
  dimension: CheckDimension;
  title: string;
  status: CheckStatus;
  /** Severity carried by this check when it is failing. */
  severity: CheckSeverity;
  verification: Verification;
  detail: string;
  remediation?: string;
  evidence?: string;
}

export interface VendorFacts {
  contractStatus: string;
  contractRenewalDate: Date | null;
  securityReviewStatus: string;
  dataResidency: string[];
  approvedUseCases: string[];
  subprocessors: string[];
}

export interface LiveFacts {
  /** A live API read was attempted for this provider. */
  ran: boolean;
  keyValid?: boolean;
  organizationName?: string | null;
  note?: string;
}

export interface ProviderEvalContext {
  meta: ProviderMeta;
  proxySecret: string | null;
  baseUrl: string | null;
  vendor: VendorFacts | null;
  live: LiveFacts | null;
  now: Date;
}

export interface ProviderEvaluation {
  provider: string;
  label: string;
  checks: ProviderSecurityCheck[];
  /** Per-dimension 0-100 score; -1 means the dimension does not apply. */
  dimensionScores: Record<CheckDimension, number>;
  overallScore: number;
  grade: string;
  liveChecksRan: boolean;
  failingCount: number;
  criticalCount: number;
}

const STATUS_WEIGHT: Record<Exclude<CheckStatus, "not_applicable">, number> = {
  pass: 1,
  warn: 0.5,
  fail: 0,
};

const ALL_DIMENSIONS: CheckDimension[] = [
  "dataHandling",
  "retention",
  "trainingUse",
  "encryption",
  "accessControl",
  "residency",
];

function gradeFor(score: number): string {
  if (score >= 90) return "A";
  if (score >= 80) return "B";
  if (score >= 70) return "C";
  if (score >= 60) return "D";
  return "F";
}

/**
 * Evaluate one configured provider against the full rule set. Pure and
 * deterministic given its context — the live read is performed by the caller
 * and passed in as `ctx.live`.
 */
export function evaluateProvider(ctx: ProviderEvalContext): ProviderEvaluation {
  const { meta, vendor, live } = ctx;
  const checks: ProviderSecurityCheck[] = [];

  // 1 — Credentials encrypted at rest (always true for configured providers;
  //     UrNammu stores secret settings with AES-GCM). Informational baseline.
  checks.push({
    id: "credentials_encrypted",
    dimension: "encryption",
    title: "Credentials encrypted at rest",
    status: "pass",
    severity: "INFO",
    verification: "verified",
    detail: `${meta.label} admin credential is stored encrypted at rest (AES-GCM) and masked in API responses.`,
    evidence: "AppSetting secret encryption",
  });

  // 2 — UrNammu proxy secret gates access to the provider through the proxy.
  const secret = ctx.proxySecret?.trim() ?? "";
  if (!secret) {
    checks.push({
      id: "proxy_secret",
      dimension: "accessControl",
      title: "Proxy access secret configured",
      status: "fail",
      severity: "MEDIUM",
      verification: "verified",
      detail:
        "No proxy secret is set, so requests proxied through UrNammu to this provider are not authenticated.",
      remediation:
        "Set a strong PROXY_SECRET in Settings > Proxy and configure clients to send it.",
    });
  } else if (secret.length < 24) {
    checks.push({
      id: "proxy_secret",
      dimension: "accessControl",
      title: "Proxy access secret configured",
      status: "warn",
      severity: "MEDIUM",
      verification: "verified",
      detail: `Proxy secret is set but short (${secret.length} chars).`,
      remediation: "Use a high-entropy secret of at least 24 characters.",
    });
  } else {
    checks.push({
      id: "proxy_secret",
      dimension: "accessControl",
      title: "Proxy access secret configured",
      status: "pass",
      severity: "INFO",
      verification: "verified",
      detail: "A strong proxy secret authenticates traffic routed through UrNammu.",
    });
  }

  // 3 — Endpoint TLS (gateways with a configurable base URL).
  if (meta.baseUrlKey) {
    const base = ctx.baseUrl?.trim() ?? "";
    if (!base) {
      checks.push({
        id: "tls_endpoint",
        dimension: "encryption",
        title: "Endpoint uses TLS",
        status: "pass",
        severity: "HIGH",
        verification: "inferred",
        detail: `No custom base URL set; ${meta.label}'s default HTTPS endpoint is used.`,
      });
    } else if (base.startsWith("https://")) {
      checks.push({
        id: "tls_endpoint",
        dimension: "encryption",
        title: "Endpoint uses TLS",
        status: "pass",
        severity: "HIGH",
        verification: "verified",
        detail: "Configured base URL uses HTTPS.",
        evidence: base,
      });
    } else {
      checks.push({
        id: "tls_endpoint",
        dimension: "encryption",
        title: "Endpoint uses TLS",
        status: "fail",
        severity: "HIGH",
        verification: "verified",
        detail: "Configured base URL is not HTTPS — traffic to this provider is unencrypted in transit.",
        remediation: "Point the base URL at an https:// endpoint.",
        evidence: base,
      });
    }
  }

  // 4 — Training on submitted data.
  const trainAttested =
    vendor?.securityReviewStatus === "APPROVED" ||
    (vendor?.approvedUseCases.length ?? 0) > 0;
  if (meta.trainsOnApiDataByDefault === false) {
    checks.push({
      id: "no_training_on_data",
      dimension: "trainingUse",
      title: "Submitted data not used for training",
      status: trainAttested ? "pass" : "warn",
      severity: "HIGH",
      verification: trainAttested ? "attested" : "inferred",
      detail: trainAttested
        ? `${meta.label} does not train on API/business data by default; confirmed against the vendor profile.`
        : `${meta.label} does not train on API/business data by default, but this is not yet attested in the vendor profile.`,
      remediation: trainAttested
        ? undefined
        : "Record the data-use terms (DPA / no-training commitment) in Vendor Governance.",
    });
  } else {
    // "varies" — depends on route/Privacy Mode/per-model policy.
    checks.push({
      id: "no_training_on_data",
      dimension: "trainingUse",
      title: "Submitted data not used for training",
      status: "warn",
      severity: "HIGH",
      verification: "inferred",
      detail: `${meta.label}'s training-on-data behavior depends on configuration (e.g. Privacy Mode or downstream route) and cannot be assumed.`,
      remediation:
        "Confirm Privacy Mode / data policy is enforced and record the determination in Vendor Governance.",
    });
  }

  // 5 — Data retention / zero-retention.
  if (meta.retainsContentLogsByDefault) {
    checks.push({
      id: "data_retention",
      dimension: "retention",
      title: "Prompt/response retention controlled",
      status: "warn",
      severity: "HIGH",
      verification: "inferred",
      detail: `${meta.label} is a gateway/observability layer that retains prompt and response content as logs by default.`,
      remediation:
        "Set a minimal retention window and enable payload redaction/exclusion for sensitive fields.",
    });
  } else {
    // No provider admin API exposes the account retention setting yet, so this
    // stays an attestation item: available-but-unconfirmed => warn.
    checks.push({
      id: "data_retention",
      dimension: "retention",
      title: "Zero/short data retention available",
      status: "warn",
      severity: "MEDIUM",
      verification: "inferred",
      detail: meta.zeroDataRetentionAvailable
        ? `${meta.label} offers a zero/short data-retention option; confirm it is enabled on the account.`
        : `Confirm ${meta.label}'s data-retention window meets policy.`,
      remediation:
        "Enable zero-data-retention (or the shortest available window) on the provider account and record it in Vendor Governance.",
    });
  }

  // 6 — Data residency (only where the provider offers a choice).
  if (meta.dataResidencyOptions) {
    const regions = vendor?.dataResidency ?? [];
    if (regions.length > 0) {
      checks.push({
        id: "data_residency",
        dimension: "residency",
        title: "Data residency configured",
        status: "pass",
        severity: "MEDIUM",
        verification: "attested",
        detail: `Approved data residency recorded: ${regions.join(", ")}.`,
        evidence: regions.join(", "),
      });
    } else {
      checks.push({
        id: "data_residency",
        dimension: "residency",
        title: "Data residency configured",
        status: "warn",
        severity: "MEDIUM",
        verification: "inferred",
        detail: `${meta.label} offers regional data residency, but no approved region is recorded.`,
        remediation: "Select a region and record it in Vendor Governance > Data Residency.",
      });
    }
  }

  // 7 — Vendor security review.
  const review = vendor?.securityReviewStatus ?? "NOT_REVIEWED";
  checks.push(
    review === "APPROVED"
      ? {
          id: "security_review",
          dimension: "dataHandling",
          title: "Vendor security review approved",
          status: "pass",
          severity: "HIGH",
          verification: "attested",
          detail: "The vendor has a completed, approved security review.",
        }
      : review === "REJECTED"
        ? {
            id: "security_review",
            dimension: "dataHandling",
            title: "Vendor security review approved",
            status: "fail",
            severity: "CRITICAL",
            verification: "attested",
            detail: "The vendor's security review was REJECTED but the provider is still configured.",
            remediation: "Stop using this provider or remediate the rejection before continued use.",
          }
        : review === "CONDITIONAL" || review === "IN_PROGRESS"
          ? {
              id: "security_review",
              dimension: "dataHandling",
              title: "Vendor security review approved",
              status: "warn",
              severity: "MEDIUM",
              verification: "attested",
              detail: `Vendor security review is ${review.toLowerCase().replace("_", " ")}.`,
              remediation: "Complete the security review and resolve any conditions.",
            }
          : {
              id: "security_review",
              dimension: "dataHandling",
              title: "Vendor security review approved",
              status: "fail",
              severity: "HIGH",
              verification: vendor ? "attested" : "inferred",
              detail: "No security review has been completed for this vendor.",
              remediation: "Run a security review in Vendor Governance.",
            }
  );

  // 8 — Contract status.
  const contract = vendor?.contractStatus ?? "UNKNOWN";
  const renewalPast =
    vendor?.contractRenewalDate != null &&
    vendor.contractRenewalDate.getTime() < ctx.now.getTime();
  if (contract === "ACTIVE") {
    checks.push({
      id: "contract_status",
      dimension: "dataHandling",
      title: "Active contract / DPA in place",
      status: renewalPast ? "warn" : "pass",
      severity: "MEDIUM",
      verification: "attested",
      detail: renewalPast
        ? "Contract is marked active but is past its renewal date."
        : "An active contract is recorded for this vendor.",
      remediation: renewalPast ? "Renew the contract or update its renewal date." : undefined,
    });
  } else if (contract === "EXPIRED" || contract === "TERMINATED") {
    checks.push({
      id: "contract_status",
      dimension: "dataHandling",
      title: "Active contract / DPA in place",
      status: "fail",
      severity: "HIGH",
      verification: "attested",
      detail: `Contract is ${contract.toLowerCase()} but the provider is still configured.`,
      remediation: "Renew the agreement or decommission the provider.",
    });
  } else {
    checks.push({
      id: "contract_status",
      dimension: "dataHandling",
      title: "Active contract / DPA in place",
      status: "warn",
      severity: "MEDIUM",
      verification: vendor ? "attested" : "inferred",
      detail:
        contract === "IN_REVIEW"
          ? "Contract is in review."
          : "No contract status is recorded for this vendor.",
      remediation: "Record the contract / DPA status in Vendor Governance.",
    });
  }

  // 9 — Subprocessors catalogued.
  const subprocessors = vendor?.subprocessors ?? [];
  checks.push({
    id: "subprocessors",
    dimension: "dataHandling",
    title: "Subprocessors catalogued",
    status: subprocessors.length > 0 ? "pass" : "warn",
    severity: "LOW",
    verification: subprocessors.length > 0 ? "attested" : "inferred",
    detail:
      subprocessors.length > 0
        ? `${subprocessors.length} subprocessor(s) recorded.`
        : "No subprocessors are catalogued for this vendor.",
    remediation:
      subprocessors.length > 0
        ? undefined
        : "Record the vendor's subprocessors in Vendor Governance for downstream-risk visibility.",
  });

  // 10 — Live credential verification (providers with an adapter).
  if (meta.hasLiveAdapter) {
    if (live?.ran && live.keyValid === true) {
      checks.push({
        id: "live_credential",
        dimension: "accessControl",
        title: "Admin credential verified live",
        status: "pass",
        severity: "HIGH",
        verification: "verified",
        detail: live.organizationName
          ? `Admin credential authenticated against organization "${live.organizationName}".`
          : "Admin credential authenticated successfully.",
        evidence: live.note,
      });
    } else if (live?.ran && live.keyValid === false) {
      checks.push({
        id: "live_credential",
        dimension: "accessControl",
        title: "Admin credential verified live",
        status: "fail",
        severity: "HIGH",
        verification: "verified",
        detail: `Admin credential failed live authentication${live.note ? `: ${live.note}` : "."}`,
        remediation: "Rotate or correct the admin key in Settings > Provider Admin APIs.",
      });
    }
    // If the live read didn't run, we simply omit the check rather than guess.
  }

  // ── Scoring ──
  const dimensionScores = Object.fromEntries(
    ALL_DIMENSIONS.map((dim) => {
      const applicable = checks.filter(
        (c) => c.dimension === dim && c.status !== "not_applicable"
      );
      if (applicable.length === 0) return [dim, -1];
      const mean =
        applicable.reduce(
          (sum, c) => sum + STATUS_WEIGHT[c.status as keyof typeof STATUS_WEIGHT],
          0
        ) / applicable.length;
      return [dim, Math.round(mean * 100)];
    })
  ) as Record<CheckDimension, number>;

  const scored = ALL_DIMENSIONS.map((d) => dimensionScores[d]).filter((s) => s >= 0);
  const overallScore = scored.length
    ? Math.round(scored.reduce((a, b) => a + b, 0) / scored.length)
    : 0;

  const failing = checks.filter((c) => c.status === "fail");
  const criticalCount = failing.filter(
    (c) => c.severity === "CRITICAL" || c.severity === "HIGH"
  ).length;

  return {
    provider: meta.id,
    label: meta.label,
    checks,
    dimensionScores,
    overallScore,
    grade: gradeFor(overallScore),
    liveChecksRan: !!live?.ran,
    failingCount: failing.length,
    criticalCount,
  };
}
