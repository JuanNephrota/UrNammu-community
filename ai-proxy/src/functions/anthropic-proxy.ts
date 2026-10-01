import { app, HttpRequest, HttpResponseInit } from "@azure/functions";
import { Readable, PassThrough } from "stream";
import { accountTokens, calculateCost, usageFromAnthropic, usageMetadata } from "../lib/pricing";
import { logUsage } from "../lib/db";
import { extractAnthropicStreamUsage } from "../lib/stream-parser";
import { scanResponseForSensitiveInfo } from "../lib/sensitive-detect";
import { applyMcpPassthrough } from "../lib/mcp-passthrough";
import { recordToolActivity } from "../lib/tool-activity";
import { computePromptHash, extractUserPromptText } from "../lib/prompt-hash";
import { loadPromptHashSalt } from "../lib/prompt-hash-salt";
import {
  extractAnthropicToolUses,
  extractDeclaredMcpServers,
  summarizeMcpForMetadata,
} from "../lib/mcp-tool-governance";
import { canonicalizeRequest, isAllowedAnthropicPath, policyViewOf } from "../lib/proxy-providers";
import {
  authenticate,
  resolveAttribution,
  runMcpServerGate,
  runPolicyGate,
} from "../lib/proxy-gate";

const ANTHROPIC_BASE = "https://api.anthropic.com";
const MESSAGES_ENDPOINT = "/v1/messages";

/**
 * The provider's own id for this request, read from the response headers.
 * Anthropic sends `request-id`; OpenAI sends `x-request-id`. Claude Code
 * records the same value on its OTel `api_request` event, so persisting it
 * is what lets a session trace line a proxied call up with the model call
 * that produced it.
 */
function upstreamRequestId(res: Response): string | null {
  return res.headers.get("request-id") ?? res.headers.get("x-request-id");
}

async function anthropicProxy(req: HttpRequest): Promise<HttpResponseInit> {
  // Auth
  const authError = authenticate(req);
  if (authError) return authError;

  // Target path from route params; only known Anthropic endpoints are forwarded.
  const url = new URL(req.url);
  const subpath = url.pathname.replace(/^\/api\/proxy\/anthropic/, "") || MESSAGES_ENDPOINT;
  if (!isAllowedAnthropicPath(subpath)) {
    return { status: 404, jsonBody: { error: "Unsupported Anthropic API path" } };
  }

  // The server's own key only backs the metered, policy-gated Messages call.
  const apiKey =
    req.headers.get("x-api-key") ??
    (subpath === MESSAGES_ENDPOINT ? process.env.ANTHROPIC_API_KEY : undefined);
  if (!apiKey) {
    return { status: 400, jsonBody: { error: "No Anthropic API key" } };
  }

  // Tracking — x-ai-system-id links proxy traffic to a governed system in
  // the registry; x-agent-id attributes the call to a registered agent whose
  // MCP allowlists govern the request (fails closed when the agent record
  // cannot be loaded). Shared with the other provider functions.
  const { attribution, response: attributionError } = await resolveAttribution(req, "claude");
  if (attributionError) return attributionError;
  const { department, userEmail, aiSystemId, agent, client } = attribution;

  const targetUrl = `${ANTHROPIC_BASE}${subpath}`;

  // Read body first — MCP passthrough needs it.
  let bodyText: string | null = null;
  let bodyJson: Record<string, unknown> | null = null;
  try {
    bodyText = await req.text();
    if (bodyText) bodyJson = JSON.parse(bodyText);
  } catch {
    // not JSON
  }

  // Forward headers (default allow-list)
  const forwardHeaders: Record<string, string> = {
    "Content-Type": req.headers.get("Content-Type") ?? "application/json",
    "x-api-key": apiKey,
    "anthropic-version": req.headers.get("anthropic-version") ?? "2023-06-01",
  };

  const betaHeader = req.headers.get("anthropic-beta");
  if (betaHeader) {
    forwardHeaders["anthropic-beta"] = betaHeader;
  }

  // MCP passthrough: when the request involves MCP, forward `mcp-*` headers
  // and the client's `Authorization` bearer verbatim. Without this the proxy
  // strips credentials remote MCP servers need.
  const mcpResult = applyMcpPassthrough(forwardHeaders, req.headers, bodyJson);

  const model = (bodyJson?.model as string) ?? "unknown";
  const isStreaming = bodyJson?.stream === true;
  const startTime = Date.now();

  // Cross-surface correlation hash of the user-authored prompt (never the
  // prompt itself). Same extractor + salt chain as the main app, so this
  // matches the hash on the Vercel proxies and the OTel ingest routes.
  const promptHash = computePromptHash(
    await loadPromptHashSalt(),
    extractUserPromptText(bodyJson)
  );

  // ── MCP server allowlist gate ── (shared with the other providers)
  // Monitor mode records a dry-run denial and forwards; enforce mode returns
  // 403 for unlisted servers and narrows allowed_tools before forwarding.
  const declaredServers = extractDeclaredMcpServers(bodyJson);
  const mcpGate = await runMcpServerGate({
    agent,
    declaredServers,
    provider: "claude",
    model,
    aiSystemId,
    userEmail,
    department,
    isStreaming,
    bodyJson,
    bodyText,
  });
  if (mcpGate.response) return mcpGate.response;
  bodyJson = mcpGate.bodyJson;
  bodyText = mcpGate.bodyText;

  // ── Policy enforcement gate ── (shared; see proxy-gate.ts for mode semantics)
  // Off: skip entirely. Dryrun: evaluate + record denials but forward.
  // Enforce: evaluate + return 403 on blocking violations.
  if (subpath === MESSAGES_ENDPOINT) {
    const denied = await runPolicyGate({
      provider: "claude",
      model,
      aiSystemId,
      userEmail,
      department,
      policyBody: policyViewOf({ ...canonicalizeRequest("anthropic", bodyJson), model }),
      isStreaming,
      requestMetadata: { endpoint: subpath },
    });
    if (denied) return denied;
  }

  // Forward to Anthropic
  let anthropicRes: Response;
  try {
    anthropicRes = await fetch(targetUrl, {
      method: req.method,
      headers: forwardHeaders,
      body: bodyText || undefined,
    });
  } catch (err) {
    await logUsage({
      provider: "claude",
      model,
      department,
      userEmail,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      cost: 0,
      flagged: true,
      flagCategory: "proxy_error",
      flagReason: `Proxy error: ${err instanceof Error ? err.message : "Network error"}`,
      metadata: { aiSystemId, promptHash },
    }).catch((logErr) => {
      console.error("logUsage failed:", logErr);
    });
    return { status: 502, jsonBody: { error: "Failed to reach Anthropic API" } };
  }

  const requestId = upstreamRequestId(anthropicRes);
  const latencyMs = Date.now() - startTime;

  // Only the Messages endpoint itself produces usage. /v1/messages/count_tokens,
  // /v1/messages/batches* etc. pass through untouched — logging them wrote
  // 0-token rows.
  if (subpath !== MESSAGES_ENDPOINT) {
    const body = await anthropicRes.text();
    return {
      status: anthropicRes.status,
      headers: { "Content-Type": anthropicRes.headers.get("Content-Type") ?? "application/json" },
      body,
    };
  }

  // ── Streaming ──
  if (isStreaming && anthropicRes.body) {
    const nodeStream = Readable.fromWeb(
      anthropicRes.body as unknown as ReadableStream<Uint8Array>
    );
    const clientPass = new PassThrough();
    const logPass = new PassThrough();

    nodeStream.pipe(clientPass);
    nodeStream.pipe(logPass);

    // Kick off the extractor now so it drains `logPass` in parallel with the
    // client consuming `clientPass`. We MUST attach an error handler — Azure
    // Functions has no `waitUntil`, so the promise is effectively fire-and-
    // forget and an unhandled rejection would crash the worker.
    //
    // The function host keeps this invocation alive while the response body
    // stream is open; in practice the extractor finishes at/before the client
    // stream ends. If the client disconnects mid-stream the extractor may not
    // complete — accepted limitation until telemetry moves to a queue.
    const extractPromise = extractAnthropicStreamUsage(logPass, {
      provider: "claude",
      pricingProvider: "anthropic",
      model,
      department,
      userEmail,
      latencyMs,
      aiSystemId,
      requestId,
      agent,
      declaredServers,
      promptHash,
      baseMeta: { client },
      mcp: mcpResult.detected
        ? { servers: mcpResult.mcpServerCount, forwardedHeaders: mcpResult.forwarded }
        : null,
    }).catch((err: unknown) => {
      console.error("extractAnthropicStreamUsage failed:", err);
    });
    // Silence "floating promise" linters while still not blocking the response.
    void extractPromise;

    return {
      status: anthropicRes.status,
      headers: {
        "Content-Type": anthropicRes.headers.get("Content-Type") ?? "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
      },
      body: clientPass,
    };
  }

  // ── Non-streaming ──
  const responseBody = (await anthropicRes.json()) as {
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      cache_read_input_tokens?: number;
      cache_creation_input_tokens?: number;
    };
    content?: Array<{ type?: string; text?: string }>;
    error?: {
      message?: string;
    };
  };

  // input_tokens excludes cached tokens — usageFromAnthropic/accountTokens
  // fold cache_read + cache_creation into promptTokens (see ../lib/pricing.ts).
  const tokenUsage = usageFromAnthropic(responseBody.usage);
  const accounted = accountTokens(tokenUsage);
  const pricing = calculateCost("anthropic", model, tokenUsage);
  const toolUses = anthropicRes.ok ? extractAnthropicToolUses(responseBody.content) : [];

  let flagged = false;
  let flagCategory: "upstream_error" | "sensitive_response" | null = null;
  let flagReason: string | null = null;

  // Inline DLP on the model's response (only sanitized excerpts are persisted).
  if (anthropicRes.ok) {
    const responseText = (responseBody.content ?? [])
      .filter((b) => b.type === "text" && typeof b.text === "string")
      .map((b) => b.text as string)
      .join("\n");
    const dlp = await scanResponseForSensitiveInfo({
      provider: "claude",
      model,
      aiSystemId,
      responseText,
    });
    if (dlp.flagged) {
      flagged = true;
      flagCategory = "sensitive_response";
      flagReason = dlp.summary;
    }
  }

  if (!anthropicRes.ok) {
    flagged = true;
    flagCategory = "upstream_error";
    flagReason = `API error: ${anthropicRes.status} ${responseBody.error?.message ?? ""}`;
  }

  await logUsage({
    provider: "claude",
    model,
    department,
    userEmail,
    promptTokens: accounted.promptTokens,
    completionTokens: accounted.completionTokens,
    totalTokens: accounted.totalTokens,
    cacheReadTokens: accounted.cacheReadTokens,
    cacheCreationTokens: accounted.cacheCreationTokens,
    cost: pricing.cost ?? 0,
    flagged,
    flagCategory,
    flagReason,
    requestId,
    metadata: {
      aiSystemId,
      agentId: agent?.id ?? null,
      client,
      latencyMs,
      status: anthropicRes.status,
      promptHash,
      ...usageMetadata(tokenUsage, pricing),
      mcp:
        mcpResult.detected || declaredServers.length > 0 || toolUses.length > 0
          ? {
              servers: mcpResult.mcpServerCount,
              forwardedHeaders: mcpResult.forwarded,
              ...summarizeMcpForMetadata(declaredServers, toolUses),
            }
          : undefined,
    },
  }).catch((err) => {
    console.error("logUsage failed:", err);
  });

  await recordToolActivity({
    agent,
    aiSystemId,
    provider: "claude",
    model,
    requestId,
    userEmail,
    department,
    declaredServers,
    toolUses,
  });

  return {
    status: anthropicRes.status,
    jsonBody: responseBody,
  };
}

app.http("anthropic-proxy", {
  methods: ["GET", "POST", "PUT", "DELETE"],
  authLevel: "anonymous",
  route: "proxy/anthropic/{*path}",
  handler: anthropicProxy,
});

// Also handle root /api/proxy/anthropic (no subpath)
app.http("anthropic-proxy-root", {
  methods: ["POST"],
  authLevel: "anonymous",
  route: "proxy/anthropic",
  handler: anthropicProxy,
});
