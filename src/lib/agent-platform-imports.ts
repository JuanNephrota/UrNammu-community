/**
 * The `agent_platforms` discovery-scan source: runs every configured agent
 * platform importer and records the run in ScanHistory (scanType
 * `agent_platforms`), so it shares the discovery-scan cron, schedule
 * settings and stale-run handling with the shadow-AI sources.
 *
 * OpenAI Assistants and ChatGPT Enterprise GPTs are not here: they ride
 * along with the OpenAI and ChatGPT Enterprise provider syncs, which already
 * hold those credentials and schedules.
 */
import { prisma } from "./prisma";
import type { AgentImportSummary } from "./agent-import";
import {
  importAnthropicManagedAgents,
  isAnthropicManagedAgentsConfigured,
} from "./anthropic-managed-agents";
import {
  importMicrosoftCopilotAgents,
  isMicrosoftCopilotAgentsConfigured,
} from "./microsoft-copilot-agents";
import {
  importSalesforceAgentforce,
  isSalesforceAgentforceConfigured,
} from "./salesforce-agentforce";
import { logger } from "./observability";

export const AGENT_PLATFORMS_SCAN_TYPE = "agent_platforms";

export const AGENT_PLATFORM_IMPORTERS = [
  "anthropic_managed_agents",
  "microsoft_copilot",
  "salesforce_agentforce",
] as const;
export type AgentPlatformImporter = (typeof AGENT_PLATFORM_IMPORTERS)[number];

export type AgentPlatformImportResult = AgentImportSummary & {
  configured: boolean;
  truncated?: boolean;
};

export type AgentPlatformImportRun = Record<AgentPlatformImporter, AgentPlatformImportResult>;

/** Same fields as a shadow-AI ScanResult, plus the per-platform breakdown. */
export type AgentPlatformScanResult = {
  scanId: string;
  status: "completed" | "failed";
  toolsFound: number;
  newToolsAdded: number;
  updatedTools: number;
  errorMessage?: string;
  platforms: AgentPlatformImportRun;
};

type Importers = Record<AgentPlatformImporter, () => Promise<AgentPlatformImportResult>>;

const DEFAULT_IMPORTERS: Importers = {
  anthropic_managed_agents: () => importAnthropicManagedAgents(),
  microsoft_copilot: () => importMicrosoftCopilotAgents(),
  salesforce_agentforce: () => importSalesforceAgentforce(),
};

export async function getAgentPlatformConfiguration(): Promise<Record<AgentPlatformImporter, boolean>> {
  const [anthropic, microsoft, salesforce] = await Promise.all([
    isAnthropicManagedAgentsConfigured().catch(() => false),
    isMicrosoftCopilotAgentsConfigured().catch(() => false),
    isSalesforceAgentforceConfigured().catch(() => false),
  ]);
  return {
    anthropic_managed_agents: anthropic,
    microsoft_copilot: microsoft,
    salesforce_agentforce: salesforce,
  };
}

/** At least one platform is configured — the discovery-scan "configured" check. */
export async function isAgentPlatformImportConfigured(): Promise<boolean> {
  const config = await getAgentPlatformConfiguration();
  return Object.values(config).some(Boolean);
}

/**
 * Totals across importers. Status is `failed` only when every configured
 * importer failed; a partial failure completes with `errorMessage` set.
 */
export function summarizeAgentPlatformRun(run: AgentPlatformImportRun): Omit<AgentPlatformScanResult, "scanId" | "platforms"> {
  const results = Object.entries(run) as Array<[AgentPlatformImporter, AgentPlatformImportResult]>;
  const configured = results.filter(([, r]) => r.configured);
  const errors = configured.filter(([, r]) => r.error).map(([name, r]) => `${name}: ${r.error}`);
  const failed = configured.length > 0 && errors.length === configured.length;
  return {
    status: failed ? "failed" : "completed",
    toolsFound: results.reduce((sum, [, r]) => sum + r.found, 0),
    newToolsAdded: results.reduce((sum, [, r]) => sum + r.created, 0),
    updatedTools: results.reduce((sum, [, r]) => sum + r.updated, 0),
    errorMessage: errors.length ? errors.join("; ").slice(0, 4000) : undefined,
  };
}

/** Run every importer (each is a no-op when unconfigured). Importers never throw. */
export async function runAgentPlatformImports(importers: Importers = DEFAULT_IMPORTERS): Promise<AgentPlatformImportRun> {
  const entries = await Promise.all(
    AGENT_PLATFORM_IMPORTERS.map(async (name) => {
      try {
        return [name, await importers[name]()] as const;
      } catch (err) {
        const result: AgentPlatformImportResult = {
          found: 0,
          created: 0,
          updated: 0,
          configured: true,
          error: err instanceof Error ? err.message : "Import failed",
        };
        return [name, result] as const;
      }
    })
  );
  return Object.fromEntries(entries) as AgentPlatformImportRun;
}

/**
 * Discovery-scan entry point: one ScanHistory row per run, counts are
 * agents (found / new / updated) rather than tools.
 */
export async function executeAgentPlatformScan(triggeredBy: string): Promise<AgentPlatformScanResult> {
  const scan = await prisma.scanHistory.create({
    data: { scanType: AGENT_PLATFORMS_SCAN_TYPE, status: "running", triggeredBy },
  });
  try {
    const platforms = await runAgentPlatformImports();
    const summary = summarizeAgentPlatformRun(platforms);
    await prisma.scanHistory.update({
      where: { id: scan.id },
      data: {
        status: summary.status,
        toolsFound: summary.toolsFound,
        newToolsAdded: summary.newToolsAdded,
        updatedTools: summary.updatedTools,
        errorMessage: summary.errorMessage ?? null,
        completedAt: new Date(),
      },
    });
    logger.info("agent_discovery.platform_scan.completed", {
      scanId: scan.id,
      triggeredBy,
      status: summary.status,
      found: summary.toolsFound,
      created: summary.newToolsAdded,
      updated: summary.updatedTools,
    });
    return { scanId: scan.id, ...summary, platforms };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Agent platform scan failed";
    await prisma.scanHistory.update({
      where: { id: scan.id },
      data: { status: "failed", errorMessage: message, completedAt: new Date() },
    });
    throw err;
  }
}
