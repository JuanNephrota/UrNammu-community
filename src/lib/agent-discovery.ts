/**
 * Agent discovery: the one write path into `DiscoveredAgent`.
 *
 * Every source — proxy traffic detection, agent-platform inventory imports,
 * the endpoint agent's MCP config scan — calls `upsertDiscoveredAgent()`, so
 * merging, alerting and the review workflow behave identically regardless of
 * where an agent was seen. `registerDiscoveredAgent()` promotes a row into
 * the Agent Registry. See docs/plans/agent-discovery.md.
 */
import { Prisma, type DiscoveredAgent, type DiscoveryStatus } from "@prisma/client";
import { prisma } from "./prisma";
import { createAuditLog } from "./audit";

export const AGENT_DISCOVERY_ALERT_SOURCE = "agent_discovery";

export const AGENT_DISCOVERY_SOURCES = [
  "proxy_traffic",
  "anthropic_managed_agents",
  "microsoft_copilot",
  "salesforce_agentforce",
  "openai_assistants",
  "openai_agents",
  "chatgpt_gpts",
  "endpoint_agent",
] as const;
export type AgentDiscoverySource = (typeof AGENT_DISCOVERY_SOURCES)[number];

export const AGENT_DISCOVERY_SOURCE_LABELS: Record<AgentDiscoverySource, string> = {
  proxy_traffic: "Proxy traffic",
  anthropic_managed_agents: "Anthropic Managed Agents",
  microsoft_copilot: "Microsoft Copilot Studio",
  salesforce_agentforce: "Salesforce Agentforce",
  openai_assistants: "OpenAI Assistants",
  openai_agents: "OpenAI Agents",
  chatgpt_gpts: "ChatGPT custom GPTs",
  endpoint_agent: "Endpoint agent",
};

export function isAgentDiscoverySource(value: string): value is AgentDiscoverySource {
  return (AGENT_DISCOVERY_SOURCES as readonly string[]).includes(value);
}

export type AgentSignal = { key: string; label: string; weight: number };

export type AgentConfidence = "high" | "medium" | "low";

export type DiscoveredAgentInput = {
  source: AgentDiscoverySource;
  externalId: string;
  name: string;
  description?: string | null;
  platform?: string | null;
  framework?: string | null;
  confidence?: AgentConfidence | null;
  score?: number | null;
  signals?: AgentSignal[];
  tools?: string[];
  mcpServers?: string[];
  models?: string[];
  userEmails?: string[];
  ownerEmail?: string | null;
  department?: string | null;
  aiSystemId?: string | null;
  /**
   * Registry agent this discovery already corresponds to (e.g. an OpenAI
   * Assistant imported before DiscoveredAgent existed). Linking sets the row
   * to REGISTERED on create.
   */
  linkedAgentId?: string | null;
  /**
   * Replaces the stored count when set. Sources that report a rolling window
   * (proxy detection) pass the window total; inventory sources omit it.
   */
  requestCount?: number;
  firstSeenAt?: Date | null;
  lastSeenAt?: Date | null;
  metadata?: Record<string, unknown> | null;
};

export type UpsertOutcome = { id: string; created: boolean };

/**
 * Sources pass through system ids they did not create (the Azure proxy logs
 * `x-ai-system-id` unvalidated, and a system can be deleted inside the
 * detection window). Alert.aiSystemId and AIAgent.aiSystemId are foreign
 * keys, so an unknown id is dropped here rather than failing the write.
 */
async function existingSystemId(id: string | null | undefined): Promise<string | null> {
  if (!id) return null;
  const system = await prisma.aISystem.findUnique({ where: { id }, select: { id: true } });
  return system?.id ?? null;
}

/** Array columns are capped so a noisy source cannot grow a row unbounded. */
export const MAX_ARRAY_ITEMS = 100;

const MAX_DESCRIPTION_CHARS = 2000;

/** Union two lists, preserving first-seen order, dropping blanks, capped. */
export function mergeList(existing: readonly string[], incoming: readonly string[] | undefined): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of [...existing, ...(incoming ?? [])]) {
    const value = raw.trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
    if (out.length >= MAX_ARRAY_ITEMS) break;
  }
  return out;
}

function earliest(a: Date | null | undefined, b: Date | null | undefined): Date | null {
  if (!a) return b ?? null;
  if (!b) return a;
  return a < b ? a : b;
}

function latest(a: Date | null | undefined, b: Date | null | undefined): Date | null {
  if (!a) return b ?? null;
  if (!b) return a;
  return a > b ? a : b;
}

export function confidenceForScore(score: number): AgentConfidence {
  if (score >= 70) return "high";
  if (score >= 50) return "medium";
  return "low";
}

function truncate(value: string | null | undefined, max: number): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed;
}

type ExistingRow = Pick<
  DiscoveredAgent,
  | "tools"
  | "mcpServers"
  | "models"
  | "userEmails"
  | "firstSeenAt"
  | "lastSeenAt"
  | "requestCount"
  | "metadata"
  | "linkedAgentId"
  | "status"
>;

/**
 * The update applied to an existing row. Pure, so the merge rules are
 * testable without a database:
 * - list columns union; timestamps widen; descriptive fields refresh when the
 *   source sends a value and are otherwise kept;
 * - `status` and `notes` are never touched — they belong to the reviewer;
 * - an existing link is never replaced by a source-supplied one.
 */
export function buildDiscoveredAgentUpdate(
  existing: ExistingRow,
  input: DiscoveredAgentInput
): Prisma.DiscoveredAgentUpdateInput {
  const data: Prisma.DiscoveredAgentUpdateInput = {
    name: truncate(input.name, 200) ?? undefined,
    tools: mergeList(existing.tools, input.tools),
    mcpServers: mergeList(existing.mcpServers, input.mcpServers),
    models: mergeList(existing.models, input.models),
    userEmails: mergeList(existing.userEmails, input.userEmails),
    firstSeenAt: earliest(existing.firstSeenAt, input.firstSeenAt),
    lastSeenAt: latest(existing.lastSeenAt, input.lastSeenAt ?? new Date()),
  };
  if (input.description !== undefined) data.description = truncate(input.description, MAX_DESCRIPTION_CHARS);
  if (input.platform) data.platform = input.platform;
  if (input.framework) data.framework = input.framework;
  if (input.confidence) data.confidence = input.confidence;
  if (input.score != null) data.score = input.score;
  if (input.signals) data.signals = input.signals as unknown as Prisma.InputJsonValue;
  if (input.ownerEmail) data.ownerEmail = input.ownerEmail;
  if (input.department) data.department = input.department;
  if (input.aiSystemId) data.aiSystemId = input.aiSystemId;
  if (input.requestCount != null) data.requestCount = input.requestCount;
  if (input.metadata) {
    const prior =
      existing.metadata && typeof existing.metadata === "object" && !Array.isArray(existing.metadata)
        ? (existing.metadata as Record<string, unknown>)
        : {};
    data.metadata = { ...prior, ...input.metadata } as Prisma.InputJsonValue;
  }
  if (!existing.linkedAgentId && input.linkedAgentId) {
    data.linkedAgent = { connect: { id: input.linkedAgentId } };
    if (existing.status === "DISCOVERED") data.status = "REGISTERED";
  }
  return data;
}

async function raiseDiscoveryAlert(row: DiscoveredAgent) {
  const source = isAgentDiscoverySource(row.source)
    ? AGENT_DISCOVERY_SOURCE_LABELS[row.source]
    : row.source;
  const detail = [
    row.platform ? `platform ${row.platform}` : null,
    row.framework ? `framework ${row.framework}` : null,
    row.tools.length ? `${row.tools.length} tool(s)` : null,
    row.mcpServers.length ? `MCP: ${row.mcpServers.slice(0, 5).join(", ")}` : null,
    row.confidence ? `${row.confidence} confidence` : null,
  ]
    .filter(Boolean)
    .join("; ");
  await prisma.alert.create({
    data: {
      title: `Unregistered AI agent discovered: ${row.name}`,
      description: `${source} found an AI agent that is not in the Agent Registry${detail ? ` (${detail})` : ""}. Review it under Agents → Discovered and register or block it.`,
      severity: "MEDIUM",
      source: AGENT_DISCOVERY_ALERT_SOURCE,
      aiSystemId: row.aiSystemId,
    },
  });
}

/**
 * Create or merge one discovery. Alerts only on first creation of a row that
 * is not already linked to a registry agent, so re-detection is silent.
 */
export async function upsertDiscoveredAgent(input: DiscoveredAgentInput): Promise<UpsertOutcome> {
  const externalId = input.externalId.trim();
  if (!externalId) throw new Error("externalId is required");
  if (input.aiSystemId) input = { ...input, aiSystemId: await existingSystemId(input.aiSystemId) };

  const existing = await prisma.discoveredAgent.findUnique({
    where: { source_externalId: { source: input.source, externalId } },
  });

  if (existing) {
    await prisma.discoveredAgent.update({
      where: { id: existing.id },
      data: buildDiscoveredAgentUpdate(existing, input),
    });
    return { id: existing.id, created: false };
  }

  const now = new Date();
  let row: DiscoveredAgent;
  try {
    row = await prisma.discoveredAgent.create({
      data: {
        source: input.source,
        externalId,
        name: truncate(input.name, 200) ?? "Unnamed agent",
        description: truncate(input.description, MAX_DESCRIPTION_CHARS),
        platform: input.platform ?? null,
        framework: input.framework ?? null,
        status: input.linkedAgentId ? "REGISTERED" : "DISCOVERED",
        confidence: input.confidence ?? null,
        score: input.score ?? null,
        signals: (input.signals ?? []) as unknown as Prisma.InputJsonValue,
        tools: mergeList([], input.tools),
        mcpServers: mergeList([], input.mcpServers),
        models: mergeList([], input.models),
        userEmails: mergeList([], input.userEmails),
        ownerEmail: input.ownerEmail ?? null,
        department: input.department ?? null,
        aiSystemId: input.aiSystemId ?? null,
        linkedAgentId: input.linkedAgentId ?? null,
        requestCount: input.requestCount ?? 0,
        firstSeenAt: input.firstSeenAt ?? now,
        lastSeenAt: input.lastSeenAt ?? now,
        metadata: (input.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
      },
    });
  } catch (err) {
    // Two workers raced to create the same row: fall back to a merge.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return upsertDiscoveredAgent(input);
    }
    throw err;
  }

  if (!row.linkedAgentId) {
    try {
      await raiseDiscoveryAlert(row);
    } catch (err) {
      console.error("agent discovery alert failed:", err);
    }
  }
  return { id: row.id, created: true };
}

export const REVIEW_STATUSES: DiscoveryStatus[] = [
  "DISCOVERED",
  "UNDER_REVIEW",
  "REGISTERED",
  "APPROVED",
  "BLOCKED",
];

/**
 * Promote a discovery into the Agent Registry, or link it to an existing
 * agent when `existingAgentId` is given. Idempotent: a row already linked
 * returns its agent unchanged, and a concurrent second call loses the race
 * inside the transaction instead of creating a second agent.
 */
export async function registerDiscoveredAgent(input: {
  discoveredAgentId: string;
  userId: string;
  existingAgentId?: string | null;
}): Promise<{ agentId: string; created: boolean }> {
  const row = await prisma.discoveredAgent.findUnique({ where: { id: input.discoveredAgentId } });
  if (!row) throw new DiscoveredAgentNotFoundError();
  if (row.linkedAgentId) return { agentId: row.linkedAgentId, created: false };
  const aiSystemId = await existingSystemId(row.aiSystemId);

  try {
    return await registerInTransaction(row, aiSystemId, input);
  } catch (err) {
    if (err instanceof AlreadyLinkedError) {
      const winner = await prisma.discoveredAgent.findUnique({ where: { id: row.id }, select: { linkedAgentId: true } });
      if (winner?.linkedAgentId) return { agentId: winner.linkedAgentId, created: false };
    }
    throw err;
  }
}

class AlreadyLinkedError extends Error {}

async function registerInTransaction(
  row: DiscoveredAgent,
  aiSystemId: string | null,
  input: { userId: string; existingAgentId?: string | null }
): Promise<{ agentId: string; created: boolean }> {
  return prisma.$transaction(async (tx) => {
    let agentId: string;
    let created = false;
    if (input.existingAgentId) {
      const agent = await tx.aIAgent.findUnique({ where: { id: input.existingAgentId }, select: { id: true } });
      if (!agent) throw new DiscoveredAgentNotFoundError("Agent not found");
      agentId = agent.id;
    } else {
      const sourceLabel = isAgentDiscoverySource(row.source)
        ? AGENT_DISCOVERY_SOURCE_LABELS[row.source]
        : row.source;
      const agent = await tx.aIAgent.create({
        data: {
          name: row.name,
          description: row.description,
          ownerId: input.userId,
          aiSystemId,
          capabilities: row.tools.slice(0, 50),
          connectedSystems: [row.platform ?? sourceLabel, ...row.mcpServers.slice(0, 20)],
          accessLevel: row.mcpServers.length > 0 || row.tools.length > 0 ? "read-write" : "read-only",
          autonomyLevel: "SUPERVISED",
          status: "DRAFT",
          department: row.department,
          // Observed MCP servers seed the allowlist in monitor mode, so the
          // agent's current behaviour is the baseline and drift alerts.
          mcpServerAllowlist: row.mcpServers.slice(0, 50),
          mcpEnforcement: "monitor",
        },
      });
      agentId = agent.id;
      created = true;
      await createAuditLog(
        {
          userId: input.userId,
          action: "CREATE",
          entityType: "AIAgent",
          entityId: agent.id,
          agentId: agent.id,
          changes: { fromDiscoveredAgentId: row.id, source: row.source },
        },
        tx
      );
    }

    // Claim the row only if nobody linked it meanwhile; otherwise roll back
    // the agent created above.
    const claimed = await tx.discoveredAgent.updateMany({
      where: { id: row.id, linkedAgentId: null },
      data: { status: "REGISTERED", linkedAgentId: agentId },
    });
    if (claimed.count === 0) throw new AlreadyLinkedError();
    await createAuditLog(
      {
        userId: input.userId,
        action: "REGISTER",
        entityType: "DiscoveredAgent",
        entityId: row.id,
        agentId,
        changes: { fromStatus: row.status, linkedAgentId: agentId, createdAgent: created },
      },
      tx
    );
    return { agentId, created };
  });
}

export class DiscoveredAgentNotFoundError extends Error {
  constructor(message = "Discovered agent not found") {
    super(message);
    this.name = "DiscoveredAgentNotFoundError";
  }
}
