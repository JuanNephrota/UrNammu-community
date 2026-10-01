import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import {
  analyzePromptRisk,
  analyzeText,
  createPromptRiskAlert,
  promptRiskLogMetadata,
} from "./prompt-risk";
import { recordSensitiveFinding } from "./sensitive-alerts";
import { applyMcpPassthrough } from "./mcp-passthrough";
import {
  authenticateProxyRequest,
  logProxyUsage as logUsage,
  resolveProxyAttribution,
  runAgentRuntimeGate,
  runMcpServerGate,
} from "./proxy-common";
import { runPolicyGate } from "./proxy-policy-gate";
import {
  ANTHROPIC_METERED_PATH,
  canonicalizeRequest,
  isAllowedAnthropicPath,
  policyViewOf,
} from "./proxy-providers";
import {
  accountTokens,
  calculateCost,
  EMPTY_USAGE,
  mergeAnthropicStreamUsage,
  usageFromAnthropic,
  usageMetadata,
  type TokenUsage,
} from "./model-pricing";
import {
  extractAnthropicStreamToolUse,
  extractAnthropicToolUses,
  extractDeclaredMcpServers,
  summarizeMcpForMetadata,
  type DeclaredMcpServer,
  type ObservedToolUse,
} from "./mcp-tool-governance";
import { recordToolActivity, type AgentGovernance } from "./mcp-tool-activity";
import type { ClientFingerprint } from "./caller-fingerprint";

const ANTHROPIC_BASE = "https://api.anthropic.com";
const MESSAGES_ENDPOINT = "/v1/messages";

// Pricing + token accounting live in ./model-pricing (mirrored into ai-proxy).
// Anthropic's `input_tokens` excludes cached tokens; see that module for how
// we fold cache_read / cache_creation into promptTokens and cost.

/** Concatenate the assistant's text from a non-streaming Messages response. */
function extractAnthropicResponseText(responseBody: unknown): string {
  const content = (responseBody as { content?: unknown })?.content;
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const block of content) {
    if (
      block &&
      typeof block === "object" &&
      (block as { type?: string }).type === "text" &&
      typeof (block as { text?: unknown }).text === "string"
    ) {
      parts.push((block as { text: string }).text);
    }
  }
  return parts.join("\n");
}

/**
 * Handle a proxied request to the Anthropic API.
 * Supports both streaming and non-streaming requests.
 */
export async function handleAnthropicProxy(
  req: NextRequest,
  subpath: string
): Promise<NextResponse | Response> {
  // Authenticate proxy request
  const authError = await authenticateProxyRequest(req);
  if (authError) return authError;

  if (!isAllowedAnthropicPath(subpath)) {
    return NextResponse.json({ error: "Unsupported Anthropic API path" }, { status: 404 });
  }

  // The server's own key only backs the metered, policy-gated Messages call.
  // Every other path needs the client's key, or a proxy-key holder could
  // reach the org's files/batches/admin surface.
  const apiKey =
    req.headers.get("x-api-key") ??
    (subpath === ANTHROPIC_METERED_PATH ? process.env.ANTHROPIC_API_KEY : undefined);

  if (!apiKey) {
    return NextResponse.json(
      { error: "No Anthropic API key. Pass x-api-key header or set ANTHROPIC_API_KEY." },
      { status: 400 }
    );
  }

  // Tracking metadata. x-agent-id attributes the call to a registered agent
  // (and, through it, to its parent system when x-ai-system-id is absent);
  // the agent's MCP allowlists govern which servers/tools the call may use.
  const { department, userEmail, aiSystemId: attributedSystemId, agent, client } =
    await resolveProxyAttribution(req);
  const agentBlocked = await runAgentRuntimeGate({
    agent,
    provider: "claude",
    aiSystemId: attributedSystemId,
    userEmail,
    department,
  });
  if (agentBlocked) return agentBlocked;

  // Build the target URL
  const targetUrl = `${ANTHROPIC_BASE}${subpath}`;

  // Read request body first — MCP passthrough needs to inspect it for
  // `mcp_servers`.
  let bodyText: string | null = null;
  let bodyJson: Record<string, unknown> | null = null;
  try {
    bodyText = await req.text();
    if (bodyText) {
      bodyJson = JSON.parse(bodyText);
    }
  } catch {
    // Not JSON or empty body
  }

  // Forward headers (default allow-list)
  const forwardHeaders: Record<string, string> = {
    "Content-Type": req.headers.get("Content-Type") ?? "application/json",
    "x-api-key": apiKey,
    "anthropic-version":
      req.headers.get("anthropic-version") ?? "2023-06-01",
  };

  const betaHeader = req.headers.get("anthropic-beta");
  if (betaHeader) {
    forwardHeaders["anthropic-beta"] = betaHeader;
  }

  // MCP passthrough: when the request involves MCP (body declares
  // `mcp_servers`, anthropic-beta mentions `mcp-client`, or the client sent
  // any `mcp-*` header), forward MCP headers and the client's `Authorization`
  // bearer verbatim. Without this the proxy strips the credentials remote
  // MCP servers need to authenticate the call.
  const mcpResult = applyMcpPassthrough(forwardHeaders, req.headers, bodyJson);

  const model = (bodyJson?.model as string) ?? "unknown";
  const promptRisk = await analyzePromptRisk(bodyJson);
  const isStreaming = bodyJson?.stream === true;

  // ── MCP server allowlist gate ── (shared with the other providers)
  // Monitor mode records a dry-run denial and forwards; enforce mode returns
  // 403 for unlisted servers and narrows each server's allowed_tools so the
  // provider only exposes allowlisted tools to the model.
  const declaredServers: DeclaredMcpServer[] = extractDeclaredMcpServers(bodyJson);
  const mcpGate = await runMcpServerGate({
    agent,
    declaredServers,
    provider: "claude",
    model,
    aiSystemId: attributedSystemId,
    userEmail,
    department,
    isStreaming,
    bodyJson,
    bodyText,
  });
  if (mcpGate.response) return mcpGate.response;
  bodyJson = mcpGate.bodyJson;
  bodyText = mcpGate.bodyText;

  // ── Policy-as-code gate ── same rule set the Azure proxy enforces, keyed on
  // the global policy_enforcement_mode setting (off by default).
  if (subpath === MESSAGES_ENDPOINT) {
    const denied = await runPolicyGate({
      provider: "claude",
      model,
      aiSystemId: attributedSystemId,
      userEmail,
      department,
      policyBody: policyViewOf({ ...canonicalizeRequest("anthropic", bodyJson), model }),
      isStreaming,
      requestMetadata: { endpoint: subpath },
    });
    if (denied) return denied;
  }

  const startTime = Date.now();

  // Forward to Anthropic
  let anthropicResponse: Response;
  try {
    anthropicResponse = await fetch(targetUrl, {
      method: req.method,
      headers: forwardHeaders,
      body: bodyText || undefined,
    });
  } catch (err) {
    logUsage({
      provider: "claude",
      model,
      department,
      userEmail,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      cost: 0,
      flagged: true,
      flagCategory: promptRisk.flagged ? "prompt_risk" : "proxy_error",
      flagReason:
        promptRisk.flagReason ??
        `Proxy error: ${err instanceof Error ? err.message : "Network error"}`,
      metadata: {
        ...promptRiskLogMetadata(promptRisk),
        aiSystemId: attributedSystemId,
      },
    });

    if (promptRisk.flagged) {
      await createPromptRiskAlert({
        provider: "claude",
        model,
        department,
        userEmail,
        aiSystemId: attributedSystemId,
        analysis: promptRisk,
      });
    }

    return NextResponse.json(
      { error: "Failed to reach Anthropic API" },
      { status: 502 }
    );
  }

  const latencyMs = Date.now() - startTime;

  // Only the Messages endpoint itself produces usage. Everything else under
  // /v1/messages/* (count_tokens, batches, ...) passes through untouched —
  // logging those used to write 0-token rows.
  if (subpath !== MESSAGES_ENDPOINT) {
    const responseBody = await anthropicResponse.text();
    return new NextResponse(responseBody, {
      status: anthropicResponse.status,
      headers: {
        "Content-Type":
          anthropicResponse.headers.get("Content-Type") ?? "application/json",
      },
    });
  }

  // ── Streaming response ──
  if (isStreaming && anthropicResponse.body) {
    const contentType =
      anthropicResponse.headers.get("Content-Type") ??
      "text/event-stream";

    // Tee the stream: one for the client, one to extract usage
    const [clientStream, logStream] = anthropicResponse.body.tee();

    // Extract usage from the log stream after the response is sent.
    // Using `after` keeps the runtime alive long enough for the stream to drain
    // and for the DB write to complete, without blocking the client response.
    after(
      extractStreamUsage(logStream, {
        model,
        department,
        userEmail,
        latencyMs,
        subpath,
        aiSystemId: attributedSystemId,
        promptRisk,
        mcp: mcpResult,
        agent,
        client,
        declaredServers,
        requestId: anthropicResponse.headers.get("request-id"),
      }).catch((err) => {
        console.error("extractStreamUsage failed:", err);
      })
    );

    if (promptRisk.flagged) {
      await createPromptRiskAlert({
        provider: "claude",
        model,
        department,
        userEmail,
        aiSystemId: attributedSystemId,
        analysis: promptRisk,
      });
    }

    return new Response(clientStream, {
      status: anthropicResponse.status,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  }

  // ── Non-streaming response ──
  const responseBody = await anthropicResponse.json();

  const tokenUsage = usageFromAnthropic(responseBody.usage);
  const accounted = accountTokens(tokenUsage);
  const pricing = calculateCost("anthropic", model, tokenUsage);
  const requestId = anthropicResponse.headers.get("request-id");
  const toolUses = anthropicResponse.ok ? extractAnthropicToolUses(responseBody.content) : [];

  // Inline DLP on the model's response — detect sensitive info coming back
  // (only sanitized excerpts are persisted by recordSensitiveFinding).
  const responseDlp = anthropicResponse.ok
    ? await analyzeText(extractAnthropicResponseText(responseBody), {
        excludeIntentRules: true,
      })
    : null;

  let flagged = promptRisk.flagged;
  let flagCategory:
    | "upstream_error"
    | "prompt_risk"
    | "sensitive_response"
    | null = promptRisk.flagged ? "prompt_risk" : null;
  let flagReason: string | null = promptRisk.flagReason;

  if (responseDlp?.flagged && flagCategory === null) {
    flagged = true;
    flagCategory = "sensitive_response";
    flagReason = responseDlp.flagReason;
  }

  if (!anthropicResponse.ok) {
    flagged = true;
    // Prompt-risk wins the category when both fire — that's the more
    // actionable governance signal for the user.
    if (flagCategory === null) flagCategory = "upstream_error";
    const apiError = `API error: ${anthropicResponse.status} ${responseBody.error?.message ?? ""}`.trim();
    flagReason = flagReason ? `${flagReason}; ${apiError}` : apiError;
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
      latencyMs,
      status: anthropicResponse.status,
      path: subpath,
      aiSystemId: attributedSystemId,
      agentId: agent?.id ?? null,
      client,
      ...usageMetadata(tokenUsage, pricing),
      mcp:
        mcpResult.detected || declaredServers.length > 0 || toolUses.length > 0
          ? {
              servers: mcpResult.mcpServerCount,
              forwardedHeaders: mcpResult.forwarded,
              ...summarizeMcpForMetadata(declaredServers, toolUses),
            }
          : undefined,
      ...promptRiskLogMetadata(promptRisk),
    },
  });

  if (promptRisk.flagged) {
    await createPromptRiskAlert({
      provider: "claude",
      model,
      department,
      userEmail,
      aiSystemId: attributedSystemId,
      analysis: promptRisk,
    });
  }

  if (responseDlp?.flagged) {
    await recordSensitiveFinding({
      source: "response_dlp",
      provider: "claude",
      model,
      analysis: responseDlp,
      aiSystemId: attributedSystemId,
    });
  }

  await recordToolActivity({
    agent,
    aiSystemId: attributedSystemId,
    provider: "claude",
    model,
    requestId,
    userEmail,
    department,
    declaredServers,
    toolUses,
  });

  return NextResponse.json(responseBody, {
    status: anthropicResponse.status,
  });
}

/**
 * Read a stream to extract usage info from the message_start / message_delta
 * events (input, cache_read, cache_creation, output tokens), then log it.
 * The stream is consumed and discarded.
 */
async function extractStreamUsage(
  stream: ReadableStream<Uint8Array>,
  ctx: {
    model: string;
    department: string | null;
    userEmail: string | null;
    latencyMs: number;
    subpath: string;
    aiSystemId: string | null;
    promptRisk: Awaited<ReturnType<typeof analyzePromptRisk>>;
    mcp: import("./mcp-passthrough").McpPassthroughResult;
    agent: AgentGovernance | null;
    client: ClientFingerprint;
    declaredServers: DeclaredMcpServer[];
    requestId: string | null;
  }
) {
  try {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let usage: TokenUsage = EMPTY_USAGE;
    const responseTextParts: string[] = [];
    const toolUses: ObservedToolUse[] = [];

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Process complete SSE lines
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const data = line.slice(6).trim();
        if (data === "[DONE]") continue;

        try {
          const event = JSON.parse(data);

          // message_start carries the input breakdown (uncached, cache_read,
          // cache_creation); message_delta carries the final output count.
          usage = mergeAnthropicStreamUsage(usage, event);

          // content_block_delta carries the assistant's streamed text — collect
          // it for inline response DLP once the stream drains.
          if (
            event.type === "content_block_delta" &&
            event.delta?.type === "text_delta" &&
            typeof event.delta.text === "string"
          ) {
            responseTextParts.push(event.delta.text);
          }

          // content_block_start announces tool invocations (mcp_tool_use,
          // server_tool_use, tool_use) — the governance signal for agents.
          const toolUse = extractAnthropicStreamToolUse(event);
          if (toolUse) toolUses.push(toolUse);
        } catch {
          // skip non-JSON lines
        }
      }
    }

    const accounted = accountTokens(usage);
    const pricing = calculateCost("anthropic", ctx.model, usage);

    // Inline DLP on the streamed response text.
    const responseDlp =
      responseTextParts.length > 0
        ? await analyzeText(responseTextParts.join(""), {
            excludeIntentRules: true,
          })
        : null;
    if (responseDlp?.flagged) {
      await recordSensitiveFinding({
        source: "response_dlp",
        provider: "claude",
        model: ctx.model,
        analysis: responseDlp,
        aiSystemId: ctx.aiSystemId,
      });
    }

    if (accounted.totalTokens > 0) {
      await logUsage({
        provider: "claude",
        model: ctx.model,
        department: ctx.department,
        userEmail: ctx.userEmail,
        promptTokens: accounted.promptTokens,
        completionTokens: accounted.completionTokens,
        totalTokens: accounted.totalTokens,
        cacheReadTokens: accounted.cacheReadTokens,
        cacheCreationTokens: accounted.cacheCreationTokens,
        cost: pricing.cost ?? 0,
        requestId: ctx.requestId,
        flagged: ctx.promptRisk.flagged || !!responseDlp?.flagged,
        flagCategory: ctx.promptRisk.flagged
          ? "prompt_risk"
          : responseDlp?.flagged
            ? "sensitive_response"
            : null,
        flagReason: ctx.promptRisk.flagReason ?? responseDlp?.flagReason,
        metadata: {
          latencyMs: ctx.latencyMs,
          streaming: true,
          path: ctx.subpath,
          aiSystemId: ctx.aiSystemId,
          agentId: ctx.agent?.id ?? null,
          client: ctx.client,
          ...usageMetadata(usage, pricing),
          mcp:
            ctx.mcp.detected || ctx.declaredServers.length > 0 || toolUses.length > 0
              ? {
                  servers: ctx.mcp.mcpServerCount,
                  forwardedHeaders: ctx.mcp.forwarded,
                  ...summarizeMcpForMetadata(ctx.declaredServers, toolUses),
                }
              : undefined,
          ...promptRiskLogMetadata(ctx.promptRisk),
        },
      });
    }

    await recordToolActivity({
      agent: ctx.agent,
      aiSystemId: ctx.aiSystemId,
      provider: "claude",
      model: ctx.model,
      requestId: ctx.requestId,
      userEmail: ctx.userEmail,
      department: ctx.department,
      declaredServers: ctx.declaredServers,
      toolUses,
    });
  } catch (err) {
    console.error("Failed to extract stream usage:", err);
  }
}
