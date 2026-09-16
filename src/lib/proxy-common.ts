/**
 * Shared plumbing for every Vercel proxy path (`/api/proxy/*`): proxy-secret
 * auth, attribution headers, and usage logging into `APIUsageLog` plus the
 * normalized buckets. Provider-specific handlers (`anthropic-proxy.ts`,
 * `openai-proxy.ts`, `gemini-proxy.ts`, `bedrock-proxy.ts`) compose these so
 * the five providers log identically; the prompt-risk / prompt-hash metadata
 * block they all write comes from `promptRiskLogMetadata` in ./prompt-risk.
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "./prisma";
import { getSetting } from "./settings";
import { secretsMatch } from "./secret-compare";
import { writeProxyUsageBucket } from "./proxy-bucket-writer";
import { bucketProviderFor } from "./proxy-providers";
import { loadAgentGovernance, type AgentGovernance } from "./mcp-tool-activity";
import type { analyzePromptRisk } from "./prompt-risk";

export type ProxyFlagCategory =
  | "upstream_error"
  | "proxy_error"
  | "prompt_risk"
  | "sensitive_response"
  | null;

export type PromptRiskResult = Awaited<ReturnType<typeof analyzePromptRisk>>;

/**
 * Check `x-proxy-key` against the configured proxy secret. Returns the error
 * response to send, or null when the caller is authenticated.
 */
export async function authenticateProxyRequest(req: NextRequest): Promise<NextResponse | null> {
  const proxyKey = req.headers.get("x-proxy-key");
  const proxySecret = (await getSetting("proxy_secret")) ?? process.env.PROXY_SECRET;

  if (!proxySecret) {
    return NextResponse.json(
      { error: "Proxy not configured. Set PROXY_SECRET env var or configure in Settings." },
      { status: 500 }
    );
  }
  if (!secretsMatch(proxyKey, proxySecret)) {
    return NextResponse.json({ error: "Invalid x-proxy-key header" }, { status: 401 });
  }
  return null;
}

export type ProxyAttribution = {
  department: string | null;
  userEmail: string | null;
  /** Registered system the call is attributed to (header, else the agent's parent). */
  aiSystemId: string | null;
  /** Agent named by `x-agent-id`, with its MCP allowlists. */
  agent: AgentGovernance | null;
};

/**
 * Read the attribution headers. `x-ai-system-id` must name an existing
 * system (unknown ids are dropped rather than persisted); `x-agent-id`
 * attributes the call to a registered agent and, through it, to its parent
 * system when no system header was sent.
 */
export async function resolveProxyAttribution(req: NextRequest): Promise<ProxyAttribution> {
  const department = req.headers.get("x-department") ?? null;
  const userEmail = req.headers.get("x-user-email") ?? null;
  const requestedSystemId = req.headers.get("x-ai-system-id");
  const linkedSystem = requestedSystemId
    ? await prisma.aISystem.findUnique({
        where: { id: requestedSystemId },
        select: { id: true },
      })
    : null;
  const agent = await loadAgentGovernance(req.headers.get("x-agent-id"));
  return {
    department,
    userEmail,
    aiSystemId: linkedSystem?.id ?? agent?.aiSystemId ?? null,
    agent,
  };
}

export type LogProxyUsageParams = {
  /** `APIUsageLog.provider`: claude | chatgpt | azure_openai | gemini | bedrock. */
  provider: string;
  model: string;
  department: string | null;
  userEmail: string | null;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  /** Cache breakdown — already included in promptTokens; see model-pricing.ts. */
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
  cost: number;
  flagged: boolean;
  flagCategory?: ProxyFlagCategory;
  flagReason?: string | null;
  /** Upstream request id. Null when the call never reached the provider. */
  requestId?: string | null;
  metadata?: Record<string, unknown>;
};

/**
 * Persist one proxied request. Writes the legacy `APIUsageLog` row and, when
 * tokens were charged, mirrors it into `UsageBucket` / `CostBucket` so the
 * traffic shows on the Oversight dashboard immediately. Never throws — a
 * telemetry failure must not fail the client's request.
 */
export async function logProxyUsage(params: LogProxyUsageParams): Promise<void> {
  try {
    let userId: string | null = null;
    if (params.userEmail) {
      const user = await prisma.user.findUnique({
        where: { email: params.userEmail },
        select: { id: true },
      });
      userId = user?.id ?? null;
    }

    // aiSystemId is a real column (indexed with createdAt) as well as a
    // metadata key — the Azure proxy sets both, so must we.
    const aiSystemId =
      typeof params.metadata?.aiSystemId === "string" ? params.metadata.aiSystemId : null;

    await prisma.aPIUsageLog.create({
      data: {
        provider: params.provider,
        model: params.model,
        department: params.department,
        aiSystemId,
        userId,
        promptTokens: params.promptTokens,
        completionTokens: params.completionTokens,
        totalTokens: params.totalTokens,
        cost: params.cost,
        flagged: params.flagged,
        flagCategory: params.flagCategory ?? null,
        flagReason: params.flagReason,
        requestId: params.requestId ?? null,
        promptMetadata: params.metadata
          ? JSON.parse(JSON.stringify(params.metadata))
          : undefined,
      },
    });

    // Skip the buckets when no tokens were charged — error-path rows and
    // 0-token pass-through rows should not create buckets.
    if (params.totalTokens > 0) {
      const bucketProvider = bucketProviderFor(params.provider);
      if (bucketProvider) {
        await writeProxyUsageBucket({
          provider: bucketProvider,
          model: params.model,
          userEmail: params.userEmail,
          department: params.department,
          promptTokens: params.promptTokens,
          completionTokens: params.completionTokens,
          totalTokens: params.totalTokens,
          cacheReadTokens: params.cacheReadTokens ?? 0,
          cacheCreationTokens: params.cacheCreationTokens ?? 0,
          cost: params.cost,
          aiSystemId,
        });
      }
    }
  } catch (err) {
    console.error("Failed to log API usage:", err);
  }
}

// ── MCP server allowlist gate ───────────────────────────────────────────────

import {
  evaluateServers,
  restrictAllowedTools,
  type DeclaredMcpServer,
} from "./mcp-tool-governance";
import { logMcpServerDenial } from "./mcp-tool-activity";

export type McpGateResult = {
  /** 403 to send instead of forwarding, or null to proceed. */
  response: NextResponse | null;
  /** Possibly-narrowed body (enforce mode intersects `allowed_tools`). */
  bodyJson: Record<string, unknown> | null;
  bodyText: string | null;
};

/**
 * Apply an agent's MCP server allowlist to the servers a request declares
 * (Anthropic `mcp_servers[]`, OpenAI Responses `tools[type=mcp]`). Monitor
 * mode records a dry-run denial and forwards; enforce mode returns 403 for
 * unlisted servers and narrows each server's allowed tools so the provider
 * only exposes allowlisted tools to the model.
 */
export async function runMcpServerGate(input: {
  agent: AgentGovernance | null;
  declaredServers: DeclaredMcpServer[];
  provider: string;
  model: string;
  aiSystemId: string | null;
  userEmail: string | null;
  department: string | null;
  isStreaming: boolean;
  bodyJson: Record<string, unknown> | null;
  bodyText: string | null;
}): Promise<McpGateResult> {
  const { agent, declaredServers } = input;
  let { bodyJson, bodyText } = input;
  if (!agent || declaredServers.length === 0) return { response: null, bodyJson, bodyText };

  const denied = evaluateServers(declaredServers, agent.config).filter((v) => !v.allowed);
  if (denied.length > 0) {
    await logMcpServerDenial({
      provider: input.provider,
      model: input.model,
      agent,
      aiSystemId: input.aiSystemId,
      userEmail: input.userEmail,
      department: input.department,
      deniedServers: denied.map((v) => v.server),
      isStreaming: input.isStreaming,
    });
    if (agent.config.enforcement === "enforce") {
      return {
        response: NextResponse.json(
          {
            error: {
              type: "policy_denied",
              message:
                "Request blocked: an MCP server is not on this agent's allowlist. See `violations`.",
              violations: denied.map((v) => ({
                rule: "mcp_server_not_allowed",
                message: `MCP server "${v.server.name}" is not allowlisted for agent "${agent.name}".`,
                policy: `Agent MCP allowlist: ${agent.name}`,
              })),
            },
          },
          { status: 403 }
        ),
        bodyJson,
        bodyText,
      };
    }
  }
  if (agent.config.enforcement === "enforce") {
    const restricted = restrictAllowedTools(bodyJson, agent.config);
    if (restricted.changed && restricted.body) {
      bodyJson = restricted.body;
      bodyText = JSON.stringify(restricted.body);
    }
  }
  return { response: null, bodyJson, bodyText };
}
