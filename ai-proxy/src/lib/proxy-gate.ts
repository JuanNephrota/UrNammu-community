/**
 * Request gates shared by every Azure Functions proxy handler: proxy-secret
 * auth, agent attribution (fail closed), the MCP server allowlist gate and
 * the policy-as-code gate. Each handler feeds the same canonical request
 * body (`policyViewOf(canonicalizeRequest(...))`) so one rule set governs
 * Anthropic, OpenAI, Azure OpenAI, Gemini and Bedrock traffic alike.
 */
import { HttpRequest, HttpResponseInit } from "@azure/functions";
import { secretsMatch } from "./secret-compare";
import { loadAgent, type LoadedAgent } from "./agent-loader";
import { loadPromptHashSalt } from "./prompt-hash-salt";
import { fingerprintCaller, type ClientFingerprint } from "./caller-fingerprint";
import {
  loadEnforcementMode,
  loadPoliciesForSystem,
  type EnforcementMode,
  type LoadedPolicy,
} from "./policy-loader";
import { evaluateRequest, extractPromptText } from "./policy-enforcement";
import { logPolicyDenial } from "./db";
import { MCP_SERVER_DENIAL_RULE } from "./tool-activity";
import {
  evaluateServers,
  restrictAllowedTools,
  type DeclaredMcpServer,
} from "./mcp-tool-governance";

/** `x-proxy-key` check. Returns the error response, or null when authenticated. */
export function authenticate(req: HttpRequest): HttpResponseInit | null {
  const proxySecret = process.env.PROXY_SECRET;
  if (!proxySecret) {
    return { status: 500, jsonBody: { error: "PROXY_SECRET not configured" } };
  }
  if (!secretsMatch(req.headers.get("x-proxy-key"), proxySecret)) {
    return { status: 401, jsonBody: { error: "Invalid x-proxy-key" } };
  }
  return null;
}

export type Attribution = {
  department: string | null;
  userEmail: string | null;
  aiSystemId: string | null;
  agent: LoadedAgent | null;
  /** Client framework / SDK + salted credential hash, logged as `metadata.client`. */
  client: ClientFingerprint;
};

/**
 * Read the attribution headers. `x-agent-id` loads the agent's MCP
 * allowlists; if agent state cannot be loaded (DB outage, cold cache) the
 * request is refused rather than forwarded unenforced.
 */
export async function resolveAttribution(
  req: HttpRequest
): Promise<{ attribution: Attribution; response: HttpResponseInit | null }> {
  const department = req.headers.get("x-department") ?? null;
  const userEmail = req.headers.get("x-user-email") ?? null;
  const salt = await loadPromptHashSalt().catch(() => null);
  const client = fingerprintCaller({ headers: req.headers, url: req.url, salt });
  const requestedAgentId = req.headers.get("x-agent-id") ?? null;
  let agent: LoadedAgent | null = null;
  if (requestedAgentId) {
    try {
      agent = await loadAgent(requestedAgentId);
    } catch (err) {
      console.error("Agent governance unavailable — failing closed:", err);
      return {
        attribution: { department, userEmail, aiSystemId: null, agent: null, client },
        response: {
          status: 503,
          jsonBody: {
            error: {
              type: "agent_unavailable",
              message: "Agent governance state could not be loaded; request refused. Retry shortly.",
            },
          },
        },
      };
    }
  }
  const aiSystemId = req.headers.get("x-ai-system-id") ?? agent?.aiSystemId ?? null;
  return { attribution: { department, userEmail, aiSystemId, agent, client }, response: null };
}

/** The proxy route parameter (`{*path}`) as a leading-slash path. */
export function subpathOf(req: HttpRequest, fallback: string): string {
  const raw = req.params?.path ?? "";
  if (!raw) return fallback;
  return raw.startsWith("/") ? raw : `/${raw}`;
}

export async function readJsonBody(
  req: HttpRequest
): Promise<{ bodyText: string | null; bodyJson: Record<string, unknown> | null }> {
  if (req.method === "GET" || req.method === "HEAD") return { bodyText: null, bodyJson: null };
  let bodyText: string | null = null;
  let bodyJson: Record<string, unknown> | null = null;
  try {
    bodyText = await req.text();
    if (bodyText) {
      const parsed: unknown = JSON.parse(bodyText);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        bodyJson = parsed as Record<string, unknown>;
      }
    }
  } catch {
    // not JSON — forwarded as-is
  }
  return { bodyText, bodyJson };
}

export type McpGateResult = {
  response: HttpResponseInit | null;
  bodyJson: Record<string, unknown> | null;
  bodyText: string | null;
};

/**
 * Apply an agent's MCP server allowlist to the servers a request declares.
 * Monitor mode records a dry-run denial and forwards; enforce mode returns
 * 403 for unlisted servers and narrows allowed_tools before forwarding.
 */
export async function runMcpServerGate(input: {
  agent: LoadedAgent | null;
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
    const violations = denied.map((v) => ({
      ruleKey: MCP_SERVER_DENIAL_RULE,
      message: `MCP server "${v.server.name}"${v.server.host ? ` (${v.server.host})` : ""} is not on the allowlist for agent "${agent.name}".`,
      policyId: agent.id,
      policyName: `Agent MCP allowlist: ${agent.name}`,
    }));
    void logPolicyDenial({
      provider: input.provider,
      model: input.model,
      aiSystemId: input.aiSystemId,
      userEmail: input.userEmail,
      department: input.department,
      mode: agent.config.enforcement === "enforce" ? "enforced" : "dryrun",
      policyIds: [],
      reasons: violations,
      promptExcerpt: null,
      requestMetadata: {
        isStreaming: input.isStreaming,
        agentId: agent.id,
        deniedServers: denied.map((v) => ({ name: v.server.name, host: v.server.host })),
      },
    }).catch((err) => {
      console.error("logPolicyDenial (mcp) failed:", err);
    });
    if (agent.config.enforcement === "enforce") {
      return {
        response: {
          status: 403,
          jsonBody: {
            error: {
              type: "policy_denied",
              message:
                "Request blocked: an MCP server is not on this agent's allowlist. See `violations`.",
              violations: violations.map((v) => ({
                rule: v.ruleKey,
                message: v.message,
                policy: v.policyName,
              })),
            },
          },
        },
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

/**
 * Policy-as-code gate. Off: skip. Dryrun: evaluate + record denials but
 * forward. Enforce: 403 on blocking violations. Fails closed (503) when the
 * policy state cannot be loaded. With no aiSystemId there is nothing to
 * evaluate against (usage is still logged).
 */
export async function runPolicyGate(input: {
  provider: string;
  model: string;
  aiSystemId: string | null;
  userEmail: string | null;
  department: string | null;
  policyBody: Record<string, unknown> | null;
  isStreaming: boolean;
  requestMetadata?: Record<string, unknown>;
}): Promise<HttpResponseInit | null> {
  if (!input.aiSystemId) return null;

  let mode: EnforcementMode = "off";
  let policies: LoadedPolicy[] = [];
  try {
    mode = await loadEnforcementMode();
    if (mode !== "off") policies = await loadPoliciesForSystem(input.aiSystemId);
  } catch (err) {
    console.error("Policy state unavailable — failing closed:", err);
    return {
      status: 503,
      jsonBody: {
        error: {
          type: "policy_unavailable",
          message: "Policy enforcement state could not be loaded; request refused. Retry shortly.",
        },
      },
    };
  }
  if (mode === "off" || policies.length === 0) return null;

  const evaluation = await evaluateRequest({
    policies,
    aiSystemId: input.aiSystemId,
    model: input.model,
    bodyJson: input.policyBody,
  });
  if (evaluation.decision !== "deny") return null;

  const promptExcerpt = extractPromptText(input.policyBody).slice(0, 1000);
  void logPolicyDenial({
    provider: input.provider,
    model: input.model,
    aiSystemId: input.aiSystemId,
    userEmail: input.userEmail,
    department: input.department,
    mode: mode === "enforce" ? "enforced" : "dryrun",
    policyIds: Array.from(new Set(evaluation.violations.map((v) => v.policyId))),
    reasons: evaluation.violations,
    promptExcerpt: promptExcerpt || null,
    requestMetadata: { isStreaming: input.isStreaming, ...(input.requestMetadata ?? {}) },
  }).catch((err) => {
    console.error("logPolicyDenial failed:", err);
  });

  if (mode !== "enforce") return null;
  return {
    status: 403,
    jsonBody: {
      error: {
        type: "policy_denied",
        message: "Request blocked by governance policy. See `violations` for details.",
        violations: evaluation.violations.map((v) => ({
          rule: v.ruleKey,
          message: v.message,
          policy: v.policyName,
        })),
      },
    },
  };
}

/** Log a 0-token pass-through row for an endpoint whose usage cannot be read. */
export function passthroughMeta(input: {
  baseMeta: Record<string, unknown>;
  method: string;
  status: number;
  latencyMs: number;
}): Record<string, unknown> {
  return {
    ...input.baseMeta,
    passthrough: true,
    method: input.method,
    status: input.status,
    latencyMs: input.latencyMs,
  };
}
