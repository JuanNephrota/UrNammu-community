import { Prisma } from "@prisma/client";
import { prisma } from "../prisma";
import { getConfiguredProviders, type ProviderMeta } from "./providers";
import { runLiveChecks } from "./live";
import {
  evaluateProvider,
  type ProviderEvaluation,
  type VendorFacts,
} from "./rules";

/** Alert.source for everything this scan raises. */
export const PROVIDER_SECURITY_ALERT_SOURCE = "provider_security";

export interface ProviderSecurityScanResult {
  scanId: string;
  status: "completed" | "failed";
  providersScanned: number;
  findingsFound: number;
  criticalCount: number;
  evaluations: ProviderEvaluation[];
  errorMessage?: string;
}

function toStringArray(value: Prisma.JsonValue | null | undefined): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string");
}

/**
 * Run the provider security & privacy posture scan across every configured
 * provider, persist a scan + per-provider results, and reconcile alerts for
 * failing HIGH/CRITICAL checks.
 *
 * @param triggeredBy userId, or "system" for the scheduled run.
 * @param existingScanId optional pre-created ProviderSecurityScan id.
 */
export async function executeProviderSecurityScan(
  triggeredBy: string,
  existingScanId?: string
): Promise<ProviderSecurityScanResult> {
  const scanId =
    existingScanId ??
    (
      await prisma.providerSecurityScan.create({
        data: { status: "running", triggeredBy },
      })
    ).id;

  try {
    const { providers, proxySecret, baseUrls } = await getConfiguredProviders();

    // Pull vendor profiles once and match by alias.
    const vendorProfiles = await prisma.vendorProfile.findMany();
    const matchVendor = (meta: ProviderMeta): VendorFacts | null => {
      const profile = vendorProfiles.find((p) =>
        meta.vendorAliases.includes(p.vendor.trim().toLowerCase())
      );
      if (!profile) return null;
      return {
        contractStatus: profile.contractStatus,
        contractRenewalDate: profile.contractRenewalDate,
        securityReviewStatus: profile.securityReviewStatus,
        dataResidency: toStringArray(profile.dataResidency),
        approvedUseCases: toStringArray(profile.approvedUseCases),
        subprocessors: toStringArray(profile.subprocessors),
      };
    };

    const now = new Date();

    // Evaluate every provider (live reads run concurrently, fail-soft).
    const evaluations = await Promise.all(
      providers.map(async (meta) => {
        const live = await runLiveChecks(meta);
        return evaluateProvider({
          meta,
          proxySecret,
          baseUrl: baseUrls[meta.id] ?? null,
          vendor: matchVendor(meta),
          live,
          now,
        });
      })
    );

    // Persist per-provider results.
    for (const evaluation of evaluations) {
      await prisma.providerSecurityResult.create({
        data: {
          scanId,
          provider: evaluation.provider,
          overallScore: evaluation.overallScore,
          grade: evaluation.grade,
          dataHandlingScore: evaluation.dimensionScores.dataHandling,
          retentionScore: evaluation.dimensionScores.retention,
          trainingUseScore: evaluation.dimensionScores.trainingUse,
          encryptionScore: evaluation.dimensionScores.encryption,
          accessControlScore: evaluation.dimensionScores.accessControl,
          residencyScore: evaluation.dimensionScores.residency,
          liveChecksRan: evaluation.liveChecksRan,
          checks: evaluation.checks as unknown as Prisma.InputJsonValue,
        },
      });
    }

    await reconcileAlerts(evaluations);

    const findingsFound = evaluations.reduce((s, e) => s + e.failingCount, 0);
    const criticalCount = evaluations.reduce((s, e) => s + e.criticalCount, 0);

    await prisma.providerSecurityScan.update({
      where: { id: scanId },
      data: {
        status: "completed",
        providersScanned: evaluations.length,
        findingsFound,
        criticalCount,
        completedAt: new Date(),
      },
    });

    return {
      scanId,
      status: "completed",
      providersScanned: evaluations.length,
      findingsFound,
      criticalCount,
      evaluations,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    await prisma.providerSecurityScan.update({
      where: { id: scanId },
      data: { status: "failed", errorMessage, completedAt: new Date() },
    });
    return {
      scanId,
      status: "failed",
      providersScanned: 0,
      findingsFound: 0,
      criticalCount: 0,
      evaluations: [],
      errorMessage,
    };
  }
}

/**
 * Create/update alerts for failing HIGH/CRITICAL checks and resolve any open
 * provider_security alert whose underlying check now passes. Keyed by title,
 * which encodes provider + check (no aiSystem linkage).
 */
async function reconcileAlerts(evaluations: ProviderEvaluation[]) {
  const desired = evaluations.flatMap((evaluation) =>
    evaluation.checks
      .filter(
        (c) =>
          c.status === "fail" &&
          (c.severity === "HIGH" || c.severity === "CRITICAL")
      )
      .map((c) => ({
        title: `Provider security: ${evaluation.label} — ${c.title}`,
        description: c.remediation ? `${c.detail} ${c.remediation}` : c.detail,
        severity: c.severity as "HIGH" | "CRITICAL",
      }))
  );
  const desiredTitles = new Set(desired.map((d) => d.title));

  const openAlerts = await prisma.alert.findMany({
    where: {
      source: PROVIDER_SECURITY_ALERT_SOURCE,
      status: { in: ["OPEN", "ACKNOWLEDGED"] },
    },
    select: { id: true, title: true },
  });

  for (const candidate of desired) {
    const existing = openAlerts.find((a) => a.title === candidate.title);
    if (existing) {
      await prisma.alert.update({
        where: { id: existing.id },
        data: { description: candidate.description, severity: candidate.severity },
      });
    } else {
      await prisma.alert.create({
        data: {
          title: candidate.title,
          description: candidate.description,
          severity: candidate.severity,
          source: PROVIDER_SECURITY_ALERT_SOURCE,
        },
      });
    }
  }

  // Auto-resolve alerts whose finding cleared.
  for (const alert of openAlerts) {
    if (!desiredTitles.has(alert.title)) {
      await prisma.alert.update({
        where: { id: alert.id },
        data: { status: "RESOLVED" },
      });
    }
  }
}
