import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { getSetting } from "./settings";
import { logger } from "./observability";
import {
  analyzePromptRisk,
  analyzeText,
  createPromptRiskAlert,
  promptRiskLogMetadata,
} from "./prompt-risk";
import { recordSensitiveFinding } from "./sensitive-alerts";
import {
  accountTokens,
  calculateCost,
  EMPTY_USAGE,
  isOpenAIUsageOnlyChunk,
  mergeOpenAIResponsesStreamUsage,
  mergeOpenAIStreamUsage,
  usageFromOpenAI,
  usageFromOpenAIResponses,
  usageMetadata,
  type PricingProviderInput,
  type TokenUsage,
} from "./model-pricing";
import {
  canonicalizeRequest,
  classifyAzureOpenAIPath,
  classifyOpenAIPath,
  extractOpenAIResponseText,
  extractOpenAIStreamText,
  normalizeAzureOpenAIEndpoint,
  parseAzureDeploymentMap,
  policyViewOf,
  resolveAzureModel,
  type OpenAIEndpoint,
  isCanonicalProxyPath,
} from "./proxy-providers";
import {
  extractDeclaredMcpServers,
  extractOpenAIStreamToolUses,
  extractOpenAIToolUses,
  summarizeMcpForMetadata,
  type DeclaredMcpServer,
  type ObservedToolUse,
} from "./mcp-tool-governance";
import { recordToolActivity, type AgentGovernance } from "./mcp-tool-activity";
import {
  authenticateProxyRequest,
  logProxyUsage,
  resolveProxyAttribution,
  runMcpServerGate,
  type PromptRiskResult,
  type ProxyFlagCategory,
} from "./proxy-common";
import { runPolicyGate } from "./proxy-policy-gate";

/**
 * OpenAI + Azure OpenAI proxy (Vercel fallback for the Azure Functions proxy).
 *
 * Path-based: `/api/proxy/openai/{*path}` forwards any `/v1/*` path to
 * `https://api.openai.com`; `/api/proxy/azure-openai/{*path}` forwards
 * `/openai/deployments/{deployment}/…?api-version=` (and `/openai/v1/…`) to
 * the configured resource endpoint with the client's `api-key`. Usage is read
 * for chat completions, legacy completions, the Responses API and Embeddings;
 * every other endpoint (images, audio, files, batches, GET listings) passes
 * through and logs a 0-token row with the endpoint in metadata.
 *
 * Streaming: Chat Completions only report usage with
 * `stream_options.include_usage`; when the client omits it we inject it and
 * strip the trailing usage-only chunk from the client's copy. Responses
 * streams carry usage on `response.completed`, so nothing is injected.
 * Pricing + token accounting live in `./model-pricing`; Azure deployments map
 * to model ids through the `azure_openai_deployments` setting.
 */

const OPENAI_BASE = "https://api.openai.com";

export type OpenAIProxyFlavor = "openai" | "azure";

type OpenAIUpstreamPayload =
  | { kind: "stream"; body: ReadableStream<Uint8Array>; contentType: string }
  | { kind: "json"; body: Record<string, unknown>; contentType: string }
  | { kind: "text"; body: string; contentType: string };

type OpenAIErrorBody = {
  error?: { code?: string; type?: string; message?: string };
};

export function getContentType(headers: Headers): string {
  return headers.get("Content-Type") ?? headers.get("content-type") ?? "application/json";
}

/** OpenAI returns `x-request-id`; Azure OpenAI returns `apim-request-id`. */
function upstreamRequestId(res: Response): string | null {
  return (
    res.headers.get("x-request-id") ??
    res.headers.get("apim-request-id") ??
    res.headers.get("request-id")
  );
}

export async function readOpenAIUpstreamPayload(response: Response): Promise<OpenAIUpstreamPayload> {
  const contentType = getContentType(response.headers);
  if (contentType.includes("text/event-stream")) {
    if (!response.body) throw new Error("OpenAI stream response body was empty.");
    return { kind: "stream", body: response.body, contentType };
  }
  if (contentType.includes("application/json")) {
    return {
      kind: "json",
      body: (await response.json()) as Record<string, unknown>,
      contentType,
    };
  }
  return { kind: "text", body: await response.text(), contentType };
}

/**
 * Strip internal detail from upstream errors before returning them — error
 * bodies may include org ids, rate-limit internals, or hints about the
 * server-side key that callers shouldn't see.
 */
export function sanitizeOpenAIUpstreamError(
  status: number,
  payload: OpenAIUpstreamPayload
): Record<string, unknown> {
  const sanitized: Record<string, unknown> = { error: "upstream_error", status };
  if (payload.kind !== "json") return sanitized;
  const body = payload.body as OpenAIErrorBody;
  if (typeof body.error?.code === "string") sanitized.code = body.error.code;
  if (typeof body.error?.type === "string") sanitized.type = body.error.type;
  return sanitized;
}

// ── SSE helpers ─────────────────────────────────────────────────────────────

const SSE_EVENT_BOUNDARY = /\r?\n\r?\n/;

function sseDataPayload(eventText: string): string | null {
  const data: string[] = [];
  for (const line of eventText.split(/\r?\n/)) {
    if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
  }
  return data.length > 0 ? data.join("\n") : null;
}

function parseSseJson(eventText: string): unknown {
  const payload = sseDataPayload(eventText);
  if (payload === null || payload === "[DONE]") return null;
  try {
    return JSON.parse(payload);
  } catch {
    return null;
  }
}

/**
 * Byte-level pass-through that drops the trailing usage-only chunk OpenAI
 * appends when `stream_options.include_usage` is set. Used only when the
 * proxy injected that option itself.
 */
export function createUsageChunkFilter(): TransformStream<Uint8Array, Uint8Array> {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = "";
  const emit = (controller: TransformStreamDefaultController<Uint8Array>, eventText: string) => {
    if (isOpenAIUsageOnlyChunk(parseSseJson(eventText))) return;
    controller.enqueue(encoder.encode(eventText));
  };
  return new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      buffer += decoder.decode(chunk, { stream: true });
      let match: RegExpExecArray | null;
      while ((match = SSE_EVENT_BOUNDARY.exec(buffer)) !== null) {
        const end = match.index + match[0].length;
        emit(controller, buffer.slice(0, end));
        buffer = buffer.slice(end);
      }
    },
    flush(controller) {
      buffer += decoder.decode();
      if (buffer) emit(controller, buffer);
    },
  });
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

// ── Handler ─────────────────────────────────────────────────────────────────

export async function handleOpenAIProxy(
  req: NextRequest,
  subpath: string,
  flavor: OpenAIProxyFlavor
): Promise<Response> {
  const authError = await authenticateProxyRequest(req);
  if (authError) return authError;
  if (!isCanonicalProxyPath(subpath)) {
    return NextResponse.json({ error: "Invalid proxy path" }, { status: 400 });
  }

  const provider = flavor === "azure" ? "azure_openai" : "chatgpt";
  const pricingProvider: PricingProviderInput = flavor === "azure" ? "azure_openai" : "openai";
  const logPrefix = flavor === "azure" ? "azure_openai_proxy" : "openai_proxy";
  const upstreamName = flavor === "azure" ? "Azure OpenAI" : "OpenAI";
  const search = req.nextUrl.search;

  // ── Upstream credentials + target ──
  const forwardHeaders: Record<string, string> = {
    "Content-Type": req.headers.get("content-type") ?? "application/json",
  };
  let targetBase: string;
  let path: string;
  let endpoint: OpenAIEndpoint;
  let deployment: string | null = null;
  let azureEndpoint: string | null = null;

  if (flavor === "openai") {
    const authHeader = req.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return NextResponse.json(
        { error: "Missing Authorization: Bearer <key> header" },
        { status: 400 }
      );
    }
    forwardHeaders.Authorization = authHeader;
    for (const name of ["openai-organization", "openai-project", "openai-beta"]) {
      const value = req.headers.get(name);
      if (value) forwardHeaders[name] = value;
    }
    ({ path, endpoint } = classifyOpenAIPath(subpath));
    targetBase = OPENAI_BASE;
  } else {
    const headerResource = req.headers.get("x-azure-openai-resource");
    if (headerResource !== null) {
      azureEndpoint = normalizeAzureOpenAIEndpoint(headerResource);
      if (!azureEndpoint) {
        return NextResponse.json(
          {
            error:
              "Invalid x-azure-openai-resource. Send the resource name or an https://<resource>.openai.azure.com endpoint.",
          },
          { status: 400 }
        );
      }
    } else {
      azureEndpoint = normalizeAzureOpenAIEndpoint(await getSetting("azure_openai_endpoint"));
    }
    if (!azureEndpoint) {
      return NextResponse.json(
        {
          error:
            "Azure OpenAI endpoint not configured. Set it in Settings → Proxy Setup (azure_openai_endpoint) or send x-azure-openai-resource.",
        },
        { status: 400 }
      );
    }
    const apiKey = req.headers.get("api-key");
    const bearer = req.headers.get("authorization");
    if (apiKey) forwardHeaders["api-key"] = apiKey;
    else if (bearer?.startsWith("Bearer ")) forwardHeaders.Authorization = bearer;
    else {
      return NextResponse.json(
        { error: "Missing api-key header (or Authorization: Bearer <Entra token>)" },
        { status: 400 }
      );
    }
    const classified = classifyAzureOpenAIPath(subpath);
    path = classified.path;
    endpoint = classified.endpoint;
    deployment = classified.deployment;
    targetBase = azureEndpoint;
  }
  const targetUrl = `${targetBase}${path}${search}`;

  const { department, userEmail, aiSystemId, agent, client } = await resolveProxyAttribution(req);

  // ── Body ──
  let bodyText: string | null = null;
  let bodyJson: Record<string, unknown> | null = null;
  if (req.method !== "GET" && req.method !== "HEAD") {
    bodyText = await req.text();
    if (bodyText) {
      try {
        const parsed: unknown = JSON.parse(bodyText);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          bodyJson = parsed as Record<string, unknown>;
        }
      } catch {
        // not JSON — forwarded as-is
      }
    }
  }

  const model =
    flavor === "azure"
      ? resolveAzureModel({
          deployment,
          bodyModel: bodyJson?.model,
          map: parseAzureDeploymentMap(await getSetting("azure_openai_deployments")),
        })
      : (str(bodyJson?.model) ?? "unknown");

  const baseMeta = {
    path,
    endpoint,
    deployment: deployment ?? undefined,
    azureEndpoint: azureEndpoint ?? undefined,
    aiSystemId,
    agentId: agent?.id ?? null,
    client,
  };

  // ── Pass-through: nothing to read usage from ──
  // Images, audio, files, batches, fine-tuning, GET listings… The row keeps
  // the endpoint so the traffic is visible even though tokens are unknown.
  if (endpoint === "other" || !bodyJson) {
    // A JSON body may still carry `model` / `prompt` (images, audio) — run the
    // same prompt-risk and policy checks the usage endpoints get.
    const promptRisk = await analyzePromptRisk(bodyJson);
    if (bodyJson) {
      const denied = await runPolicyGate({
        provider,
        model,
        aiSystemId,
        userEmail,
        department,
        policyBody: bodyJson,
        isStreaming: false,
        requestMetadata: { endpoint: path },
      });
      if (denied) return denied;
    }

    const startTime = Date.now();
    let upstream: Response;
    try {
      upstream = await fetch(targetUrl, {
        method: req.method,
        headers: forwardHeaders,
        body: bodyText || undefined,
      });
    } catch (err) {
      await logProxyUsage({
        provider,
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
        metadata: { ...baseMeta, passthrough: true, method: req.method, ...promptRiskLogMetadata(promptRisk) },
      });
      return NextResponse.json({ error: `Failed to reach ${upstreamName} API` }, { status: 502 });
    }
    const responseText = await upstream.text();
    await logProxyUsage({
      provider,
      model,
      department,
      userEmail,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      cost: 0,
      flagged: promptRisk.flagged || !upstream.ok,
      flagCategory: promptRisk.flagged ? "prompt_risk" : upstream.ok ? null : "upstream_error",
      flagReason: promptRisk.flagReason ?? (upstream.ok ? null : `API error: ${upstream.status}`),
      requestId: upstreamRequestId(upstream),
      metadata: {
        ...baseMeta,
        passthrough: true,
        method: req.method,
        status: upstream.status,
        latencyMs: Date.now() - startTime,
        ...promptRiskLogMetadata(promptRisk),
      },
    });
    if (promptRisk.flagged) {
      await createPromptRiskAlert({ provider, model, department, userEmail, aiSystemId, analysis: promptRisk });
    }
    return new Response(responseText, {
      status: upstream.status,
      headers: { "Content-Type": getContentType(upstream.headers) },
    });
  }

  // ── Usage endpoints ──
  const dialect =
    endpoint === "responses"
      ? "openai_responses"
      : endpoint === "embeddings"
        ? "openai_embeddings"
        : "openai_chat";
  const canonical = { ...canonicalizeRequest(dialect, bodyJson), model };
  const policyBody = policyViewOf(canonical);
  const promptRisk = await analyzePromptRisk(policyBody);
  const isStreaming = canonical.stream;

  // MCP server allowlist (Responses `tools[type=mcp]`) — uniform with Anthropic.
  const declaredServers: DeclaredMcpServer[] = extractDeclaredMcpServers(bodyJson);
  const mcpGate = await runMcpServerGate({
    agent,
    declaredServers,
    provider,
    model,
    aiSystemId,
    userEmail,
    department,
    isStreaming,
    bodyJson,
    bodyText,
  });
  if (mcpGate.response) return mcpGate.response;
  bodyJson = mcpGate.bodyJson ?? bodyJson;
  bodyText = mcpGate.bodyText;

  // Policy-as-code gate.
  const denied = await runPolicyGate({
    provider,
    model,
    aiSystemId,
    userEmail,
    department,
    policyBody,
    isStreaming,
    requestMetadata: { endpoint: path, deployment },
  });
  if (denied) return denied;

  // Chat Completions only report streaming usage on request — inject it and
  // remember to strip the resulting usage chunk.
  let injectUsage = false;
  if (isStreaming && (endpoint === "chat_completions" || endpoint === "completions")) {
    const streamOptions =
      bodyJson.stream_options && typeof bodyJson.stream_options === "object"
        ? (bodyJson.stream_options as Record<string, unknown>)
        : null;
    if (streamOptions?.include_usage !== true) {
      bodyJson = { ...bodyJson, stream_options: { ...(streamOptions ?? {}), include_usage: true } };
      bodyText = JSON.stringify(bodyJson);
      injectUsage = true;
    }
  }

  const startTime = Date.now();
  let upstream: Response;
  try {
    upstream = await fetch(targetUrl, {
      method: "POST",
      headers: forwardHeaders,
      body: bodyText ?? JSON.stringify(bodyJson),
    });
  } catch (err) {
    logger.error(`${logPrefix}.upstream_unreachable`, {
      model,
      department,
      userEmail,
      error: err instanceof Error ? err.message : "Network error",
    });
    await logProxyUsage({
      provider,
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
      metadata: { ...baseMeta, ...promptRiskLogMetadata(promptRisk) },
    });
    if (promptRisk.flagged) {
      await createPromptRiskAlert({ provider, model, department, userEmail, aiSystemId, analysis: promptRisk });
    }
    return NextResponse.json({ error: `Failed to reach ${upstreamName} API` }, { status: 502 });
  }

  const responsePayload = await readOpenAIUpstreamPayload(upstream);
  const latencyMs = Date.now() - startTime;
  const requestId = upstreamRequestId(upstream);

  if (responsePayload.kind === "stream") {
    const [clientStream, logStream] = responsePayload.body.tee();
    after(
      extractOpenAIStreamUsage(logStream, {
        provider,
        pricingProvider,
        endpoint,
        model,
        department,
        userEmail,
        latencyMs,
        aiSystemId,
        agent,
        declaredServers,
        promptRisk,
        requestId,
        injectedUsage: injectUsage,
        baseMeta,
        logPrefix,
      }).catch((err) => {
        logger.error(`${logPrefix}.stream_usage_failed`, {
          model,
          error: err instanceof Error ? err.message : "Unknown error",
        });
      })
    );

    if (promptRisk.flagged) {
      await createPromptRiskAlert({ provider, model, department, userEmail, aiSystemId, analysis: promptRisk });
      logger.warn(`${logPrefix}.dangerous_prompt_detected`, {
        model,
        department,
        userEmail,
        categories: promptRisk.categories,
        aiSystemId,
      });
    }

    const outgoing = injectUsage ? clientStream.pipeThrough(createUsageChunkFilter()) : clientStream;
    return new Response(outgoing, {
      status: upstream.status,
      headers: {
        "Content-Type": responsePayload.contentType,
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  }

  if (responsePayload.kind === "text") {
    if (!upstream.ok) {
      logger.warn(`${logPrefix}.upstream_error`, {
        status: upstream.status,
        model,
        department,
        userEmail,
        contentType: responsePayload.contentType,
      });
      return NextResponse.json(sanitizeOpenAIUpstreamError(upstream.status, responsePayload), {
        status: upstream.status,
      });
    }
    return new Response(responsePayload.body, {
      status: upstream.status,
      headers: { "Content-Type": responsePayload.contentType },
    });
  }

  const responseBody = responsePayload.body;
  const usagePayload = responseBody.usage as Record<string, unknown> | undefined;
  const tokenUsage =
    endpoint === "responses" ? usageFromOpenAIResponses(usagePayload) : usageFromOpenAI(usagePayload);
  const accounted = accountTokens(tokenUsage);
  const pricing = calculateCost(pricingProvider, model, tokenUsage);
  const toolUses = upstream.ok ? extractOpenAIToolUses(responseBody) : [];

  const responseDlp = upstream.ok
    ? await analyzeText(extractOpenAIResponseText(endpoint, responseBody), { excludeIntentRules: true })
    : null;

  let flagged = promptRisk.flagged;
  let flagCategory: ProxyFlagCategory = promptRisk.flagged ? "prompt_risk" : null;
  let flagReason: string | null = promptRisk.flagReason;
  if (responseDlp?.flagged && flagCategory === null) {
    flagged = true;
    flagCategory = "sensitive_response";
    flagReason = responseDlp.flagReason;
  }
  if (!upstream.ok) {
    flagged = true;
    if (flagCategory === null) flagCategory = "upstream_error";
    const apiError = `API error: ${upstream.status} ${(responseBody as OpenAIErrorBody).error?.message ?? ""}`.trim();
    flagReason = flagReason ? `${flagReason}; ${apiError}` : apiError;
  }

  await logProxyUsage({
    provider,
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
      ...baseMeta,
      latencyMs,
      status: upstream.status,
      ...usageMetadata(tokenUsage, pricing),
      mcp:
        declaredServers.length > 0 || toolUses.length > 0
          ? summarizeMcpForMetadata(declaredServers, toolUses)
          : undefined,
      ...promptRiskLogMetadata(promptRisk),
    },
  });

  if (promptRisk.flagged) {
    await createPromptRiskAlert({ provider, model, department, userEmail, aiSystemId, analysis: promptRisk });
    logger.warn(`${logPrefix}.dangerous_prompt_detected`, {
      model,
      department,
      userEmail,
      categories: promptRisk.categories,
      aiSystemId,
    });
  }
  if (responseDlp?.flagged) {
    await recordSensitiveFinding({
      source: "response_dlp",
      provider,
      model,
      analysis: responseDlp,
      aiSystemId,
    });
  }
  await recordToolActivity({
    agent,
    aiSystemId,
    provider,
    model,
    requestId,
    userEmail,
    department,
    declaredServers,
    toolUses,
  });

  if (!upstream.ok) {
    const sanitized = sanitizeOpenAIUpstreamError(upstream.status, responsePayload);
    logger.warn(`${logPrefix}.upstream_error`, {
      status: upstream.status,
      code: sanitized.code,
      type: sanitized.type,
      model,
      department,
      userEmail,
    });
    return NextResponse.json(sanitized, { status: upstream.status });
  }
  return NextResponse.json(responseBody, { status: upstream.status });
}

/**
 * Drain the log branch of a teed SSE stream: accumulate the assistant text for
 * response DLP, collect tool calls, and pick usage off the final chat chunk
 * (present because the client asked for `include_usage`, or because we
 * injected it) or the Responses `response.completed` event. Runs inside
 * `after()`, so it must never throw into the response path.
 */
async function extractOpenAIStreamUsage(
  stream: ReadableStream<Uint8Array>,
  ctx: {
    provider: string;
    pricingProvider: PricingProviderInput;
    endpoint: OpenAIEndpoint;
    model: string;
    department: string | null;
    userEmail: string | null;
    latencyMs: number;
    aiSystemId: string | null;
    agent: AgentGovernance | null;
    declaredServers: DeclaredMcpServer[];
    promptRisk: PromptRiskResult;
    requestId: string | null;
    injectedUsage: boolean;
    baseMeta: Record<string, unknown>;
    logPrefix: string;
  }
) {
  try {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let usage: TokenUsage = EMPTY_USAGE;
    const responseTextParts: string[] = [];
    const toolUses: ObservedToolUse[] = [];
    const merge = ctx.endpoint === "responses" ? mergeOpenAIResponsesStreamUsage : mergeOpenAIStreamUsage;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (!data || data === "[DONE]") continue;
        try {
          const event = JSON.parse(data);
          usage = merge(usage, event);
          toolUses.push(...extractOpenAIStreamToolUses(event));
          const text = extractOpenAIStreamText(ctx.endpoint, event);
          if (text) responseTextParts.push(text);
        } catch {
          // skip non-JSON lines
        }
      }
    }

    const accounted = accountTokens(usage);
    const pricing = calculateCost(ctx.pricingProvider, ctx.model, usage);

    const responseDlp =
      responseTextParts.length > 0
        ? await analyzeText(responseTextParts.join(""), { excludeIntentRules: true })
        : null;
    if (responseDlp?.flagged) {
      await recordSensitiveFinding({
        source: "response_dlp",
        provider: ctx.provider,
        model: ctx.model,
        analysis: responseDlp,
        aiSystemId: ctx.aiSystemId,
      });
    }

    if (accounted.totalTokens > 0) {
      await logProxyUsage({
        provider: ctx.provider,
        model: ctx.model,
        department: ctx.department,
        userEmail: ctx.userEmail,
        promptTokens: accounted.promptTokens,
        completionTokens: accounted.completionTokens,
        totalTokens: accounted.totalTokens,
        cacheReadTokens: accounted.cacheReadTokens,
        cacheCreationTokens: accounted.cacheCreationTokens,
        cost: pricing.cost ?? 0,
        flagged: ctx.promptRisk.flagged || !!responseDlp?.flagged,
        flagCategory: ctx.promptRisk.flagged
          ? "prompt_risk"
          : responseDlp?.flagged
            ? "sensitive_response"
            : null,
        flagReason: ctx.promptRisk.flagReason ?? responseDlp?.flagReason,
        requestId: ctx.requestId,
        metadata: {
          ...ctx.baseMeta,
          latencyMs: ctx.latencyMs,
          streaming: true,
          usageInjected: ctx.injectedUsage,
          ...usageMetadata(usage, pricing),
          mcp:
            ctx.declaredServers.length > 0 || toolUses.length > 0
              ? summarizeMcpForMetadata(ctx.declaredServers, toolUses)
              : undefined,
          ...promptRiskLogMetadata(ctx.promptRisk),
        },
      });
    } else {
      logger.warn(`${ctx.logPrefix}.stream_usage_missing`, {
        model: ctx.model,
        endpoint: ctx.endpoint,
        requestId: ctx.requestId,
        usageInjected: ctx.injectedUsage,
      });
    }

    await recordToolActivity({
      agent: ctx.agent,
      aiSystemId: ctx.aiSystemId,
      provider: ctx.provider,
      model: ctx.model,
      requestId: ctx.requestId,
      userEmail: ctx.userEmail,
      department: ctx.department,
      declaredServers: ctx.declaredServers,
      toolUses,
    });
  } catch (err) {
    logger.error(`${ctx.logPrefix}.stream_usage_failed`, {
      model: ctx.model,
      error: err instanceof Error ? err.message : "Unknown error",
    });
  }
}
