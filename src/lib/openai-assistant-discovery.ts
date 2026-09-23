/**
 * OpenAI Assistants inventory import (source `openai_assistants`). Runs after
 * a successful OpenAI telemetry sync, with the same key.
 *
 * Before agent discovery existed this wrote `AIAgent` rows directly (name +
 * department "OpenAI"). It now writes `DiscoveredAgent` rows; when one of
 * those legacy registry rows matches by name, the discovery is linked to it
 * (`linkedAgentId`, status REGISTERED) so nothing is duplicated and the
 * registry row is left as it is.
 *
 * Note: OpenAI shut the Assistants API down on 2026-08-26 (replacement:
 * Responses + Conversations). A 404/410 from `GET /v1/assistants` is
 * therefore treated as "nothing to import", not as a sync error. OpenAI's
 * newer saved agents (`POST /v1/agents`, Agents API beta) have no
 * documented list endpoint, so `openai_agents` is not imported — see
 * docs/plans/agent-discovery.md (Gap 2).
 */
import type { DiscoveredAgentInput } from "./agent-discovery";
import {
  applyAgentImport,
  asArray,
  asRecord,
  asString,
  emptyImportSummary,
  toDate,
  type AgentImportSummary,
  type AgentUpsertFn,
} from "./agent-import";
import { listAssistants } from "./openai-admin";
import { prisma } from "./prisma";

const UNNAMED_ASSISTANT = "Unnamed Assistant";

/** Department the pre-discovery importer stamped on the AIAgent rows it created. */
export const LEGACY_OPENAI_AGENT_DEPARTMENT = "OpenAI";

export type OpenAIAssistant = {
  id?: string;
  name?: string | null;
  description?: string | null;
  model?: string | null;
  created_at?: number | null;
  tools?: Array<{ type?: string; function?: { name?: string } }> | null;
  [k: string]: unknown;
};

export function assistantTools(assistant: OpenAIAssistant): string[] {
  const out: string[] = [];
  for (const raw of asArray(assistant.tools)) {
    const tool = asRecord(raw);
    const type = asString(tool.type);
    if (!type) continue;
    // Function tools are named by the developer; keep the name, not the schema.
    const fnName = type === "function" ? asString(asRecord(tool.function).name) : null;
    out.push(fnName ? `function:${fnName}` : type);
  }
  return out;
}

/**
 * Map one assistant. `instructions` (the system prompt) is content and is
 * never copied; only `description` is.
 */
export function mapOpenAIAssistant(
  assistant: OpenAIAssistant,
  linkedAgentId: string | null = null
): DiscoveredAgentInput | null {
  const id = asString(assistant.id);
  if (!id) return null;
  const model = asString(assistant.model);
  return {
    source: "openai_assistants",
    externalId: id,
    name: asString(assistant.name) ?? UNNAMED_ASSISTANT,
    description: asString(assistant.description),
    platform: "OpenAI Platform",
    framework: "openai-assistants",
    confidence: "high",
    tools: assistantTools(assistant),
    models: model ? [model] : [],
    linkedAgentId,
    firstSeenAt: toDate(assistant.created_at),
    lastSeenAt: new Date(),
    metadata: { assistantId: id },
  };
}

/** True for the errors the retired Assistants API returns. */
export function isAssistantsApiGone(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /\((404|410)\)/.test(message);
}

/**
 * The pre-DiscoveredAgent importer keyed registry rows by name alone, so a
 * link is only trusted when the name is real and unambiguous. Otherwise a new
 * assistant reusing a legacy name (or the "Unnamed Assistant" placeholder)
 * would be auto-REGISTERED without review.
 */
async function findLegacyAgentId(name: string): Promise<string | null> {
  if (!name || name === UNNAMED_ASSISTANT) return null;
  const agents = await prisma.aIAgent.findMany({
    where: { name, department: LEGACY_OPENAI_AGENT_DEPARTMENT },
    select: { id: true },
    take: 2,
  });
  return agents.length === 1 ? agents[0].id : null;
}

export type OpenAIAssistantImportDeps = {
  list?: () => Promise<unknown>;
  findLinkedAgentId?: (name: string) => Promise<string | null>;
  upsert?: AgentUpsertFn;
};

/**
 * Same summary shape the provider sync has always reported
 * (`ProviderSyncOutcome.assistants`): `created` / `updated` now count
 * DiscoveredAgent rows.
 */
export async function importOpenAIAssistants(
  deps: OpenAIAssistantImportDeps = {}
): Promise<AgentImportSummary> {
  const list = deps.list ?? (() => listAssistants({ limit: 100, order: "desc" }));
  const findLinked = deps.findLinkedAgentId ?? findLegacyAgentId;
  let response: unknown;
  try {
    response = await list();
  } catch (err) {
    if (isAssistantsApiGone(err)) return emptyImportSummary();
    return { ...emptyImportSummary(), error: err instanceof Error ? err.message : "Failed" };
  }
  const assistants = asArray(asRecord(response).data) as OpenAIAssistant[];
  try {
    const inputs: DiscoveredAgentInput[] = [];
    for (const assistant of assistants) {
      const base = mapOpenAIAssistant(assistant);
      if (!base) continue;
      const linkedAgentId = await findLinked(base.name);
      inputs.push(linkedAgentId ? { ...base, linkedAgentId } : base);
    }
    return await applyAgentImport(inputs, deps.upsert);
  } catch (err) {
    return { ...emptyImportSummary(), found: assistants.length, error: err instanceof Error ? err.message : "Failed" };
  }
}
