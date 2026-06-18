import { prisma } from "./prisma";
import { shouldSuppressAlert, type PromptRiskAnalysis } from "./prompt-risk";

/** Alert.source value for everything this module raises. */
export const SENSITIVE_ALERT_SOURCE = "sensitive_info";

export type SensitiveFindingSource = "probe" | "response_dlp";

type SensitiveAlertInput = {
  source: SensitiveFindingSource;
  provider: string;
  model: string | null;
  probeLabel?: string | null;
  analysis: PromptRiskAnalysis;
  aiSystemId?: string | null;
};

/**
 * Create (or fold into a recent duplicate) an alert for a sensitive-information
 * finding. Dedup mirrors `createPromptRiskAlert`: same
 * (source, status, aiSystemId, title) within a 1-hour window updates in place
 * instead of spamming new alerts. Returns the alert id.
 */
async function createSensitiveAlert(
  input: SensitiveAlertInput
): Promise<string> {
  const kind =
    input.source === "probe" ? "leakage probe" : "model response";
  const title = `Sensitive data in ${kind}: ${input.analysis.categories[0] ?? "sensitive info"}`;

  const recentDuplicate = await prisma.alert.findFirst({
    where: {
      source: SENSITIVE_ALERT_SOURCE,
      status: { in: ["OPEN", "ACKNOWLEDGED"] },
      aiSystemId: input.aiSystemId ?? null,
      title,
      createdAt: { gte: new Date(Date.now() - 60 * 60 * 1000) },
    },
  });

  const descriptionParts = [
    input.source === "probe"
      ? `Source: active leakage probe${input.probeLabel ? ` (${input.probeLabel})` : ""}`
      : "Source: inline response DLP",
    `Provider: ${input.provider}`,
    input.model ? `Model: ${input.model}` : null,
    `Signals: ${input.analysis.categories.join(", ")}`,
    input.analysis.excerpt ? `Excerpt: ${input.analysis.excerpt}` : null,
  ].filter(Boolean) as string[];

  const metadata = {
    findingSource: input.source,
    provider: input.provider,
    model: input.model,
    probeLabel: input.probeLabel ?? null,
    categories: input.analysis.categories,
    ruleKeys: input.analysis.ruleKeys,
    matchedSignals: input.analysis.matchedSignals,
    ruleMatches: input.analysis.ruleMatches,
    excerpt: input.analysis.excerpt,
    fullExcerpt: input.analysis.fullExcerpt,
  };

  const severity =
    input.analysis.severity === "critical" ? "CRITICAL" : "HIGH";

  if (recentDuplicate) {
    await prisma.alert.update({
      where: { id: recentDuplicate.id },
      data: {
        severity,
        description: descriptionParts.join(" · "),
        promptRiskMetadata: metadata,
      },
    });
    return recentDuplicate.id;
  }

  const alert = await prisma.alert.create({
    data: {
      title,
      description: descriptionParts.join(" · "),
      severity,
      source: SENSITIVE_ALERT_SOURCE,
      aiSystemId: input.aiSystemId ?? null,
      promptRiskMetadata: metadata,
    },
  });
  return alert.id;
}

/**
 * Persist a sanitized `SensitiveFinding` and raise an alert for it (unless an
 * active prompt-risk exception covers all matched rules). Shared by the active
 * probe executor and the inline response-DLP hook. No-ops when the analysis
 * didn't flag anything. Returns the finding id, or null when nothing flagged.
 */
export async function recordSensitiveFinding(input: {
  source: SensitiveFindingSource;
  provider: string;
  model: string | null;
  probeLabel?: string | null;
  analysis: PromptRiskAnalysis;
  aiSystemId?: string | null;
  apiUsageLogId?: string | null;
  scanId?: string | null;
}): Promise<{ findingId: string; severity: "critical" | "warning"; alerted: boolean } | null> {
  if (!input.analysis.flagged) return null;

  const severity =
    input.analysis.severity === "critical" ? "critical" : "warning";

  const finding = await prisma.sensitiveFinding.create({
    data: {
      source: input.source,
      provider: input.provider,
      model: input.model,
      probeLabel: input.probeLabel ?? null,
      severity,
      ruleKeys: input.analysis.ruleKeys,
      categories: input.analysis.categories,
      matchedSignals: input.analysis.matchedSignals,
      excerpt: input.analysis.excerpt,
      aiSystemId: input.aiSystemId ?? null,
      apiUsageLogId: input.apiUsageLogId ?? null,
      scanId: input.scanId ?? null,
    },
  });

  // Respect prompt-risk exceptions so admins can silence known false positives.
  const suppressed = await shouldSuppressAlert(
    input.analysis.ruleKeys,
    input.analysis.matchedSignals
  );
  if (suppressed) {
    return { findingId: finding.id, severity, alerted: false };
  }

  const alertId = await createSensitiveAlert({
    source: input.source,
    provider: input.provider,
    model: input.model,
    probeLabel: input.probeLabel,
    analysis: input.analysis,
    aiSystemId: input.aiSystemId,
  });
  await prisma.sensitiveFinding.update({
    where: { id: finding.id },
    data: { alertId },
  });

  return { findingId: finding.id, severity, alerted: true };
}
