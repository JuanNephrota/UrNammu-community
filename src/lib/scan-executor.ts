import { prisma } from "./prisma";
import { isGoogleWorkspaceConfigured, runFullScan } from "./google-workspace";

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
  existingScanId?: string
): Promise<ScanResult> {
  if (!(await isGoogleWorkspaceConfigured())) {
    throw new Error(
      "Google Workspace not configured. Set GOOGLE_SERVICE_ACCOUNT_KEY and GOOGLE_ADMIN_EMAIL environment variables."
    );
  }

  // Use existing scan record or create a new one
  const scanId =
    existingScanId ??
    (
      await prisma.scanHistory.create({
        data: {
          scanType: "google_workspace",
          status: "running",
          triggeredBy,
        },
      })
    ).id;

  try {
    const result = await runFullScan();

    let newToolsAdded = 0;
    let updatedTools = 0;

    for (const discovery of result.discoveries) {
      // Check for existing tool (dedup by name + domain)
      const existing = await prisma.discoveredAITool.findFirst({
        where: {
          toolName: discovery.toolName,
          detectedDomain: discovery.domain,
        },
      });

      if (existing) {
        // Update user count if higher
        if (discovery.userCount > existing.userCount) {
          await prisma.discoveredAITool.update({
            where: { id: existing.id },
            data: {
              userCount: discovery.userCount,
              notes: existing.notes
                ? `${existing.notes}\nUpdated by scan: ${discovery.userCount} users detected.`
                : `Scan detected ${discovery.userCount} users.`,
            },
          });
          updatedTools++;
        }
      } else {
        // Create new discovered tool
        const tool = await prisma.discoveredAITool.create({
          data: {
            toolName: discovery.toolName,
            vendor: discovery.vendor,
            detectedDomain: discovery.domain,
            detectionSource: "google_workspace",
            userCount: discovery.userCount,
            status: "DISCOVERED",
            notes: `Auto-discovered via Google Workspace scan. ${discovery.userCount} user(s) authorized this tool.`,
          },
        });

        // Auto-create alert
        await prisma.alert.create({
          data: {
            title: `Shadow AI detected: ${discovery.toolName}`,
            description: `${discovery.toolName} (${discovery.vendor}) discovered via Google Workspace OAuth scan. ${discovery.userCount} user(s) have authorized this tool.`,
            severity: discovery.userCount >= 10 ? "HIGH" : "MEDIUM",
            source: "shadow_ai",
            relatedToolId: tool.id,
          },
        });

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
