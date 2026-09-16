import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import {
  isGoogleWorkspaceConfigured,
  runFullScan,
  type ScanDiscovery,
} from "./google-workspace";
import {
  isMicrosoft365Configured,
  runMicrosoft365Scan,
} from "./microsoft-365-shadow-ai";
import { isHexnodeConfigured, runHexnodeScan } from "./hexnode";
import {
  isCrowdStrikeConfigured,
  runCrowdStrikeScan,
} from "./crowdstrike";
import { findMatchingGovernedSystem } from "./governed-system-match";
import { resolveToolCategory } from "./ai-tools-registry";
import {
  dismissedDomainKey,
  initialDiscoveryObservation,
  mergeDiscoveryObservation,
} from "./discovery-merge";

export type ShadowAIScanProvider =
  | "google_workspace"
  | "microsoft_365"
  | "hexnode"
  | "crowdstrike";

interface ScanResult {
  scanId: string;
  status: "completed" | "failed";
  toolsFound: number;
  newToolsAdded: number;
  updatedTools: number;
  errorMessage?: string;
}

/**
 * Execute a Google Workspace scan for shadow AI tools.
 * Runs the scan, deduplicates results, creates DiscoveredAITool records and alerts.
 *
 * @param triggeredBy - userId or "system" for cron
 * @param existingScanId - optional pre-created ScanHistory ID (for async calls)
 */
export async function executeScan(
  triggeredBy: string,
  provider: ShadowAIScanProvider = "google_workspace",
  existingScanId?: string
): Promise<ScanResult> {
  if (
    provider === "google_workspace" &&
    !(await isGoogleWorkspaceConfigured())
  ) {
    throw new Error("Google Workspace not configured.");
  }

  if (provider === "microsoft_365" && !(await isMicrosoft365Configured())) {
    throw new Error("Microsoft 365 Shadow AI not configured.");
  }

  if (provider === "hexnode" && !(await isHexnodeConfigured())) {
    throw new Error("Hexnode not configured.");
  }

  if (provider === "crowdstrike" && !(await isCrowdStrikeConfigured())) {
    throw new Error("CrowdStrike not configured.");
  }

  // Use existing scan record or create a new one
  const scanId =
    existingScanId ??
    (
      await prisma.scanHistory.create({
        data: {
          scanType: provider,
          status: "running",
          triggeredBy,
        },
      })
    ).id;

  try {
    const result =
      provider === "google_workspace"
        ? await runFullScan()
        : provider === "hexnode"
          ? await runHexnodeScan()
          : provider === "crowdstrike"
            ? await runCrowdStrikeScan()
            : await runMicrosoft365Scan();

    let newToolsAdded = 0;
    let updatedTools = 0;
    const scannedAt = new Date();

    /**
     * Fold this scan's observation into an existing row. userEmails/scopes
     * are replaced with what this scan saw; first/last seen widen; userCount
     * follows the same-source-replaces / cross-source-max rule. Only a short
     * line is appended to notes, and only when the count actually moved, so
     * daily rescans do not grow notes unboundedly.
     */
    const observationUpdate = (
      discovery: ScanDiscovery,
      existing: {
        detectionSource: string;
        userCount: number;
        firstSeenAt: Date | null;
        lastSeenAt: Date | null;
        notes: string | null;
      }
    ) => {
      const merged = mergeDiscoveryObservation(existing, {
        detectionSource: provider,
        userCount: discovery.userCount,
        userEmails: discovery.userEmails,
        scopes: discovery.scopes,
        firstSeenAt: discovery.firstSeenAt,
        lastSeenAt: discovery.lastSeenAt,
        observedAt: scannedAt,
      });
      const data: Prisma.DiscoveredAIToolUpdateInput = {
        userCount: merged.userCount,
        userEmails: merged.userEmails,
        scopes: merged.scopes,
        firstSeenAt: merged.firstSeenAt,
        lastSeenAt: merged.lastSeenAt,
      };
      if (merged.userCountChanged) {
        const line = `Rescan (${provider}): ${discovery.userCount} user(s) observed.`;
        data.notes = existing.notes ? `${existing.notes}\n${line}` : line;
      }
      return data;
    };

    for (const discovery of result.discoveries) {
      // Skip if this tool was previously dismissed from the low-confidence queue
      const dismissed = await prisma.dismissedCandidate.findUnique({
        where: {
          toolName_detectedDomain: {
            toolName: discovery.toolName,
            detectedDomain: dismissedDomainKey(discovery.domain),
          },
        },
      });
      if (dismissed) continue;

      // Check for existing tool (dedup by name + domain)
      const existing = await prisma.discoveredAITool.findFirst({
        where: {
          toolName: discovery.toolName,
          detectedDomain: discovery.domain,
        },
      });

      const category = resolveToolCategory({
        toolName: discovery.toolName,
        domain: discovery.domain,
      });

      if (existing) {
        // Always refresh the observation columns (emails, scopes, seen window,
        // count) — lastSeenAt must advance on every scan even when nothing
        // else changed — and backfill confidence if missing.
        const updates = observationUpdate(discovery, existing);
        if (!existing.matchConfidence && discovery.matchConfidence) {
          updates.matchConfidence = discovery.matchConfidence;
          updates.matchScore = discovery.matchScore ?? null;
          updates.matchReasons = discovery.matchReasons ?? [];
        }
        // Backfill the registry category for rows created before categories
        // existed. Never overwrite a value a reviewer may have set by hand.
        if (!existing.category && category) {
          updates.category = category;
        }
        // Backfill the identity-provider app handle if a prior scan didn't
        // capture it (e.g. discovered via DNS import first, then OAuth scan).
        if (!existing.externalAppId && discovery.externalAppId) {
          updates.externalAppId = discovery.externalAppId;
          updates.externalAppProvider = discovery.externalAppProvider ?? null;
        }
        await prisma.discoveredAITool.update({
          where: { id: existing.id },
          data: updates,
        });
        updatedTools++;
      } else {
        // If this discovery already corresponds to a governed AISystem, link
        // and suppress it rather than surfacing as new shadow AI.
        const governedMatch = await findMatchingGovernedSystem({
          toolName: discovery.toolName,
          vendor: discovery.vendor,
          detectedDomain: discovery.domain,
        });

        const baseNotes =
          provider === "google_workspace"
            ? `Auto-discovered via Google Workspace scan. ${discovery.userCount} user(s) authorized this tool.${discovery.notes ? ` ${discovery.notes}` : ""}`
            : provider === "hexnode"
              ? `Auto-discovered via Hexnode device scan. Found on ${discovery.userCount} managed device(s).${discovery.notes ? ` ${discovery.notes}` : ""}`
              : provider === "crowdstrike"
                ? `Auto-discovered via CrowdStrike endpoint scan. Detected on ${discovery.userCount} managed endpoint(s).${discovery.notes ? ` ${discovery.notes}` : ""}`
                : `Auto-discovered via Microsoft 365 scan. ${discovery.userCount} user(s) have delegated access to this tool.${discovery.notes ? ` ${discovery.notes}` : ""}`;

        const initial = initialDiscoveryObservation({
          detectionSource: provider,
          userCount: discovery.userCount,
          userEmails: discovery.userEmails,
          scopes: discovery.scopes,
          firstSeenAt: discovery.firstSeenAt,
          lastSeenAt: discovery.lastSeenAt,
          observedAt: scannedAt,
        });

        let tool;
        try {
          tool = await prisma.discoveredAITool.create({
            data: {
              toolName: discovery.toolName,
              vendor: discovery.vendor,
              detectedDomain: discovery.domain,
              detectionSource: provider,
              userCount: initial.userCount,
              userEmails: initial.userEmails,
              scopes: initial.scopes,
              firstSeenAt: initial.firstSeenAt,
              lastSeenAt: initial.lastSeenAt,
              status: governedMatch ? "REGISTERED" : "DISCOVERED",
              linkedSystemId: governedMatch?.id,
              matchConfidence: discovery.matchConfidence ?? null,
              matchScore: discovery.matchScore ?? null,
              matchReasons: discovery.matchReasons ?? [],
              category,
              externalAppId: discovery.externalAppId ?? null,
              externalAppProvider: discovery.externalAppProvider ?? null,
              notes: governedMatch
                ? `${baseNotes} Suppressed: matches governed system "${governedMatch.name}".`
                : baseNotes,
            },
          });
        } catch (error) {
          // A concurrent scan or DNS import created the same
          // (toolName, detectedDomain) between our findFirst and create —
          // fold into the update path instead of failing the whole scan.
          if (
            error instanceof Prisma.PrismaClientKnownRequestError &&
            error.code === "P2002"
          ) {
            const raced = await prisma.discoveredAITool.findFirst({
              where: {
                toolName: discovery.toolName,
                detectedDomain: discovery.domain,
              },
            });
            if (raced) {
              await prisma.discoveredAITool.update({
                where: { id: raced.id },
                data: observationUpdate(discovery, raced),
              });
              updatedTools++;
              continue;
            }
          }
          throw error;
        }

        // Alert only on genuinely new shadow AI. If the discovery maps to a
        // governed system, stay silent — it is already under governance.
        if (!governedMatch) {
          await prisma.alert.create({
            data: {
              title: `Shadow AI detected: ${discovery.toolName}`,
              description:
                provider === "google_workspace"
                  ? `${discovery.toolName} (${discovery.vendor}) discovered via Google Workspace OAuth scan. ${discovery.userCount} user(s) have authorized this tool.`
                  : provider === "hexnode"
                    ? `${discovery.toolName} (${discovery.vendor}) discovered via Hexnode device scan. Installed on ${discovery.userCount} managed device(s).`
                    : provider === "crowdstrike"
                      ? `${discovery.toolName} (${discovery.vendor}) discovered via CrowdStrike Falcon endpoint scan. Installed on ${discovery.userCount} managed endpoint(s).`
                      : `${discovery.toolName} (${discovery.vendor}) discovered via Microsoft 365 delegated-app scan. ${discovery.userCount} user(s) appear connected to this tool.`,
              severity: discovery.userCount >= 10 ? "HIGH" : "MEDIUM",
              source: "shadow_ai",
              relatedToolId: tool.id,
            },
          });
        }

        newToolsAdded++;
      }
    }

    // Update scan history
    await prisma.scanHistory.update({
      where: { id: scanId },
      data: {
        status: "completed",
        toolsFound: result.aiToolsFound,
        newToolsAdded,
        updatedTools,
        completedAt: new Date(),
      },
    });

    return {
      scanId,
      status: "completed",
      toolsFound: result.aiToolsFound,
      newToolsAdded,
      updatedTools,
    };
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";

    await prisma.scanHistory.update({
      where: { id: scanId },
      data: {
        status: "failed",
        errorMessage,
        completedAt: new Date(),
      },
    });

    return {
      scanId,
      status: "failed",
      toolsFound: 0,
      newToolsAdded: 0,
      updatedTools: 0,
      errorMessage,
    };
  }
}
