/**
 * Proxy agent detection (docs/plans/agent-discovery.md, gap 1).
 *
 * Finds callers of the proxy that behave like AI agents but never sent
 * `x-agent-id`: groups the recent unattributed `APIUsageLog` rows by caller
 * (provider, salted credential hash, user, system), joins the tool calls the
 * proxy already records in `AgentToolCall`, scores each caller on agent-like
 * signals, and upserts the ones over threshold as `DiscoveredAgent` rows.
 *
 * The capture half — `metadata.client` on every usage row — lives in
 * caller-fingerprint.ts and both proxies.
 */
import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { CLIENT_LABELS, CLIENT_PATTERNS, type ClientKind } from "./caller-fingerprint";
import {
  confidenceForScore,
  upsertDiscoveredAgent,
  type AgentSignal,
} from "./agent-discovery";

export const DETECTION_WINDOW_DAYS = 7;
export const DETECTION_THRESHOLD = 40;
/** Fewer calls than this is a one-off, not an agent. */
export const MIN_REQUESTS = 5;

export const SIGNAL_WEIGHTS = {
  agent_framework: 40,
  llm_library: 20,
  tool_use: 30,
  mcp_tools: 15,
  heavy_tool_use: 10,
  always_on: 10,
  service_identity: 5,
} as const;

const HEAVY_TOOL_CALLS = 20;
const ALWAYS_ON_HOURS = 12;

const PROVIDER_LABELS: Record<string, string> = {
  claude: "Claude",
  chatgpt: "OpenAI",
  azure_openai: "Azure OpenAI",
  gemini: "Gemini",
  bedrock: "Bedrock",
};

const KIND_BY_FRAMEWORK = new Map<string, ClientKind>(CLIENT_PATTERNS.map((p) => [p.id, p.kind]));

/** One caller's activity in the window, as the aggregate queries return it. */
export type CallerActivity = {
  provider: string;
  keyHash: string | null;
  userId: string | null;
  userEmail: string | null;
  aiSystemId: string | null;
  framework: string | null;
  sdk: string | null;
  /** Most common User-Agent, kept so reviewers can add unrecognised frameworks. */
  userAgent?: string | null;
  models: string[];
  department: string | null;
  requests: number;
  activeHours: number;
  firstSeen: Date;
  lastSeen: Date;
  toolCalls: number;
  mcpToolCalls: number;
  tools: string[];
  mcpServers: string[];
};

export type CallerScore = {
  score: number;
  signals: AgentSignal[];
  /** Why the caller was skipped regardless of score, if it was. */
  excluded: "assistant" | "too_few_requests" | "anonymous" | null;
};

/** Pure scoring, so the thresholds are unit-testable. */
export function scoreCaller(activity: CallerActivity): CallerScore {
  const kind = activity.framework ? KIND_BY_FRAMEWORK.get(activity.framework) ?? "unknown" : "unknown";
  if (kind === "assistant") return { score: 0, signals: [], excluded: "assistant" };
  if (!activity.keyHash && !activity.userId && !activity.aiSystemId) {
    return { score: 0, signals: [], excluded: "anonymous" };
  }
  if (activity.requests < MIN_REQUESTS) return { score: 0, signals: [], excluded: "too_few_requests" };

  const signals: AgentSignal[] = [];
  const label = activity.framework ? CLIENT_LABELS[activity.framework] ?? activity.framework : null;
  if (kind === "agent_framework") {
    signals.push({ key: "agent_framework", label: `Agent framework: ${label}`, weight: SIGNAL_WEIGHTS.agent_framework });
  } else if (kind === "llm_library") {
    signals.push({ key: "llm_library", label: `LLM orchestration library: ${label}`, weight: SIGNAL_WEIGHTS.llm_library });
  }
  if (activity.toolCalls > 0) {
    signals.push({ key: "tool_use", label: `Model returned ${activity.toolCalls} tool call(s)`, weight: SIGNAL_WEIGHTS.tool_use });
  }
  if (activity.mcpToolCalls > 0) {
    signals.push({ key: "mcp_tools", label: `Invoked MCP tools on ${activity.mcpServers.length || "unnamed"} server(s)`, weight: SIGNAL_WEIGHTS.mcp_tools });
  }
  if (activity.toolCalls >= HEAVY_TOOL_CALLS) {
    signals.push({ key: "heavy_tool_use", label: `${HEAVY_TOOL_CALLS}+ tool calls in ${DETECTION_WINDOW_DAYS} days`, weight: SIGNAL_WEIGHTS.heavy_tool_use });
  }
  if (activity.activeHours >= ALWAYS_ON_HOURS) {
    signals.push({ key: "always_on", label: `Active in ${activity.activeHours} distinct hours`, weight: SIGNAL_WEIGHTS.always_on });
  }
  if (!activity.userId) {
    signals.push({ key: "service_identity", label: "No user identity (service credential)", weight: SIGNAL_WEIGHTS.service_identity });
  }
  const score = Math.min(100, signals.reduce((sum, s) => sum + s.weight, 0));
  return { score, signals, excluded: null };
}

export function callerExternalId(activity: Pick<CallerActivity, "provider" | "keyHash" | "userId" | "aiSystemId">): string {
  return createHash("sha256")
    .update([activity.provider, activity.keyHash ?? "", activity.userId ?? "", activity.aiSystemId ?? ""].join("|"))
    .digest("hex")
    .slice(0, 32);
}

export function callerDisplayName(activity: CallerActivity): string {
  const who = activity.userEmail ?? (activity.keyHash ? `key ${activity.keyHash.slice(0, 8)}` : "service caller");
  const what = activity.framework ? CLIENT_LABELS[activity.framework] ?? activity.framework : PROVIDER_LABELS[activity.provider] ?? activity.provider;
  return `${what} agent (${who})`;
}

type UsageGroupRow = {
  provider: string;
  key_hash: string | null;
  user_id: string | null;
  user_email: string | null;
  ai_system_id: string | null;
  framework: string | null;
  sdk: string | null;
  user_agent: string | null;
  models: string[] | null;
  department: string | null;
  requests: bigint;
  active_hours: bigint;
  first_seen: Date;
  last_seen: Date;
};

type ToolGroupRow = {
  provider: string;
  key_hash: string | null;
  user_id: string | null;
  ai_system_id: string | null;
  tool_name: string;
  server_name: string | null;
  kind: string;
  calls: bigint;
};

const groupKey = (r: { provider: string; key_hash: string | null; user_id: string | null; ai_system_id: string | null }) =>
  [r.provider, r.key_hash ?? "", r.user_id ?? "", r.ai_system_id ?? ""].join("|");

/** Aggregate the window into per-caller activity. Two grouped queries, bounded output. */
export async function loadCallerActivity(since: Date): Promise<CallerActivity[]> {
  const usage = await prisma.$queryRaw<UsageGroupRow[]>(Prisma.sql`
    SELECT
      l.provider,
      l."promptMetadata"->'client'->>'keyHash' AS key_hash,
      l."userId" AS user_id,
      max(u.email) AS user_email,
      l."aiSystemId" AS ai_system_id,
      mode() WITHIN GROUP (ORDER BY l."promptMetadata"->'client'->>'framework') AS framework,
      mode() WITHIN GROUP (ORDER BY l."promptMetadata"->'client'->>'sdk') AS sdk,
      mode() WITHIN GROUP (ORDER BY l."promptMetadata"->'client'->>'userAgent') AS user_agent,
      (array_agg(DISTINCT l.model) FILTER (WHERE l.model IS NOT NULL AND l.model <> 'unknown'))[1:20] AS models,
      mode() WITHIN GROUP (ORDER BY l.department) AS department,
      count(*) AS requests,
      count(DISTINCT date_trunc('hour', l."createdAt")) AS active_hours,
      min(l."createdAt") AS first_seen,
      max(l."createdAt") AS last_seen
    FROM "APIUsageLog" l
    LEFT JOIN "User" u ON u.id = l."userId"
    WHERE l."createdAt" >= ${since}
      -- Proxy rows only (admin syncs and ingest APIs write this table too),
      -- minus interactive assistants, so a key shared between Claude Code and
      -- an agent is judged on the agent's traffic alone.
      AND (l."promptMetadata"->'client') IS NOT NULL
      AND coalesce(l."promptMetadata"->'client'->>'kind', '') <> 'assistant'
      AND coalesce(l."promptMetadata"->>'agentId', '') = ''
      AND l."flagCategory" IS DISTINCT FROM 'proxy_error'
    GROUP BY 1, 2, 3, 5
    HAVING count(*) >= ${MIN_REQUESTS}
    ORDER BY count(*) DESC
    LIMIT 2000
  `);
  if (usage.length === 0) return [];

  const tools = await prisma.$queryRaw<ToolGroupRow[]>(Prisma.sql`
    SELECT
      l.provider,
      l."promptMetadata"->'client'->>'keyHash' AS key_hash,
      l."userId" AS user_id,
      l."aiSystemId" AS ai_system_id,
      t."toolName" AS tool_name,
      t."serverName" AS server_name,
      t.kind,
      count(*) AS calls
    FROM "AgentToolCall" t
    JOIN "APIUsageLog" l ON l."requestId" = t."requestId"
    WHERE t."createdAt" >= ${since}
      AND l."createdAt" >= ${new Date(since.getTime() - 60 * 60 * 1000)}
      AND t."agentId" IS NULL
      AND t."requestId" IS NOT NULL
      AND (l."promptMetadata"->'client') IS NOT NULL
      AND coalesce(l."promptMetadata"->'client'->>'kind', '') <> 'assistant'
      AND coalesce(l."promptMetadata"->>'agentId', '') = ''
    GROUP BY 1, 2, 3, 4, 5, 6, 7
    ORDER BY count(*) DESC
    LIMIT 20000
  `);

  const toolsByGroup = new Map<string, ToolGroupRow[]>();
  for (const row of tools) {
    const key = groupKey(row);
    const list = toolsByGroup.get(key) ?? [];
    list.push(row);
    toolsByGroup.set(key, list);
  }

  return usage.map((row) => {
    const groupTools = toolsByGroup.get(groupKey(row)) ?? [];
    const toolNames = new Set<string>();
    const servers = new Set<string>();
    let toolCalls = 0;
    let mcpToolCalls = 0;
    for (const t of groupTools) {
      const calls = Number(t.calls);
      toolCalls += calls;
      toolNames.add(t.server_name ? `${t.server_name}/${t.tool_name}` : t.tool_name);
      if (t.kind === "mcp_tool_use" || t.server_name) {
        mcpToolCalls += calls;
        if (t.server_name) servers.add(t.server_name);
      }
    }
    return {
      provider: row.provider,
      keyHash: row.key_hash,
      userId: row.user_id,
      userEmail: row.user_email,
      aiSystemId: row.ai_system_id,
      framework: row.framework,
      sdk: row.sdk,
      userAgent: row.user_agent,
      models: row.models ?? [],
      department: row.department,
      requests: Number(row.requests),
      activeHours: Number(row.active_hours),
      firstSeen: row.first_seen,
      lastSeen: row.last_seen,
      toolCalls,
      mcpToolCalls,
      tools: [...toolNames],
      mcpServers: [...servers],
    };
  });
}

export type ProxyAgentDetectionResult = {
  ok: boolean;
  callers: number;
  flagged: number;
  created: number;
  updated: number;
  excluded: { assistant: number; too_few_requests: number; anonymous: number; below_threshold: number };
  error?: string;
};

export async function runProxyAgentDetection(now = new Date()): Promise<ProxyAgentDetectionResult> {
  const result: ProxyAgentDetectionResult = {
    ok: true,
    callers: 0,
    flagged: 0,
    created: 0,
    updated: 0,
    excluded: { assistant: 0, too_few_requests: 0, anonymous: 0, below_threshold: 0 },
  };
  try {
    const since = new Date(now.getTime() - DETECTION_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    const callers = await loadCallerActivity(since);
    result.callers = callers.length;
    for (const activity of callers) {
      const { score, signals, excluded } = scoreCaller(activity);
      if (excluded) {
        result.excluded[excluded]++;
        continue;
      }
      if (score < DETECTION_THRESHOLD) {
        result.excluded.below_threshold++;
        continue;
      }
      result.flagged++;
      const outcome = await upsertDiscoveredAgent({
        source: "proxy_traffic",
        externalId: callerExternalId(activity),
        name: callerDisplayName(activity),
        description: `Agent-like traffic through the UrNammu proxy without an x-agent-id header: ${activity.requests} requests to ${PROVIDER_LABELS[activity.provider] ?? activity.provider} in the last ${DETECTION_WINDOW_DAYS} days.`,
        platform: PROVIDER_LABELS[activity.provider] ?? activity.provider,
        framework: activity.framework,
        score,
        confidence: confidenceForScore(score),
        signals,
        tools: activity.tools,
        mcpServers: activity.mcpServers,
        models: activity.models,
        userEmails: activity.userEmail ? [activity.userEmail] : [],
        ownerEmail: activity.userEmail,
        department: activity.department,
        aiSystemId: activity.aiSystemId,
        requestCount: activity.requests,
        firstSeenAt: activity.firstSeen,
        lastSeenAt: activity.lastSeen,
        metadata: {
          provider: activity.provider,
          keyHash: activity.keyHash,
          sdk: activity.sdk,
          userAgent: activity.userAgent ?? null,
          activeHours: activity.activeHours,
          toolCalls: activity.toolCalls,
          windowDays: DETECTION_WINDOW_DAYS,
        },
      });
      if (outcome.created) result.created++;
      else result.updated++;
    }
  } catch (err) {
    result.ok = false;
    result.error = err instanceof Error ? err.message : "Detection failed";
    console.error("proxy agent detection failed:", err);
  }
  return result;
}
