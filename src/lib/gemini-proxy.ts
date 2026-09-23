import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
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
  mergeGeminiStreamUsage,
  usageFromGemini,
  usageMetadata,
  type GeminiUsageMetadata,
  type TokenUsage,
} from "./model-pricing";
import {
  canonicalizeRequest,
  extractGeminiResponseText,
  extractGeminiToolUses,
  isGeminiSseStream,
  parseGeminiPath,
  policyViewOf,
} from "./proxy-providers";
import { summarizeMcpForMetadata, type ObservedToolUse } from "./mcp-tool-governance";
import { recordToolActivity, type AgentGovernance } from "./mcp-tool-activity";
import {
  authenticateProxyRequest,
  logProxyUsage,
  resolveProxyAttribution,
  type PromptRiskResult,
  type ProxyFlagCategory,
} from "./proxy-common";
import { runPolicyGate } from "./proxy-policy-gate";

/**
 * Gemini Developer API proxy: `/api/proxy/gemini/{*path}` forwards to
 * `https://generativelanguage.googleapis.com`. Usage is read for
 * `models/{model}:generateContent` and `:streamGenerateContent` from
 * `usageMetadata` (promptTokenCount / candidatesTokenCount /
 * cachedContentTokenCount / thoughtsTokenCount); every other method
 * (countTokens, embedContent, file uploads, listings) passes through with a
 * 0-token row. The client's `x-goog-api-key` (or `?key=`) is forwarded
 * verbatim. Streaming with `?alt=sse` is SSE; without it Gemini streams a
 * JSON array, which the telemetry branch parses once it has drained.
 */

const GEMINI_BASE = "https://generativelanguage.googleapis.com";
const PROVIDER = "gemini";

export async function handleGeminiProxy(req: NextRequest, subpath: string): Promise<Response> {
  const authError = await authenticateProxyRequest(req);
  if (authError) return authError;

  const search = req.nextUrl.search;
  const apiKey = req.headers.get("x-goog-api-key");
  const bearer = req.headers.get("authorization");
  const hasQueryKey = req.nextUrl.searchParams.has("key");
  if (!apiKey && !hasQueryKey && !bearer?.startsWith("Bearer ")) {
    return NextResponse.json(
      { error: "Missing x-goog-api-key header (or Authorization: Bearer <token>)" },
      { status: 400 }
    );
  }
  const forwardHeaders: Record<string, string> = {
    "Content-Type": req.headers.get("content-type") ?? "application/json",
  };
  if (apiKey) forwardHeaders["x-goog-api-key"] = apiKey;
  if (bearer?.startsWith("Bearer ")) forwardHeaders.Authorization = bearer;
  const clientHeader = req.headers.get("x-goog-api-client");
  if (clientHeader) forwardHeaders["x-goog-api-client"] = clientHeader;

  const parsed = parseGeminiPath(subpath);
  const targetUrl = `${GEMINI_BASE}${parsed.path}${search}`;
  const model = parsed.model ?? "unknown";
  const { department, userEmail, aiSystemId, agent, client } = await resolveProxyAttribution(req);

  let bodyText: string | null = null;
  let bodyJson: Record<string, unknown> | null = null;
  if (req.method !== "GET" && req.method !== "HEAD") {
    bodyText = await req.text();
    if (bodyText) {
      try {
        const value: unknown = JSON.parse(bodyText);
        if (value && typeof value === "object" && !Array.isArray(value)) {
          bodyJson = value as Record<string, unknown>;
        }
      } catch {
        // not JSON
      }
    }
  }

  const baseMeta = { path: parsed.path, endpoint: parsed.method, aiSystemId, agentId: agent?.id ?? null, client };
  const isGeneration =
    (parsed.method === "generateContent" || parsed.method === "streamGenerateContent") && !!bodyJson;

  // Prompt-risk + policy-as-code see the canonical (messages/system/max_tokens) view.
  const canonical = { ...canonicalizeRequest("gemini", bodyJson), model };
  const policyBody = isGeneration ? policyViewOf(canonical) : bodyJson;
  const promptRisk = await analyzePromptRisk(policyBody);
  const isStreaming = parsed.method === "streamGenerateContent";
  if (policyBody) {
    const denied = await runPolicyGate({
      provider: PROVIDER,
      model,
      aiSystemId,
      userEmail,
      department,
      policyBody,
      isStreaming,
      requestMetadata: { endpoint: parsed.method, path: parsed.path },
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
      provider: PROVIDER,
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
        promptRisk.flagReason ?? `Proxy error: ${err instanceof Error ? err.message : "Network error"}`,
      metadata: { ...baseMeta, ...promptRiskLogMetadata(promptRisk) },
    });
    if (promptRisk.flagged) {
      await createPromptRiskAlert({ provider: PROVIDER, model, department, userEmail, aiSystemId, analysis: promptRisk });
    }
    return NextResponse.json({ error: "Failed to reach Gemini API" }, { status: 502 });
  }

  const latencyMs = Date.now() - startTime;
  const contentType = upstream.headers.get("content-type") ?? "application/json";
  const requestId = upstream.headers.get("x-request-id") ?? upstream.headers.get("x-goog-request-id");

  // ── Pass-through ──
  if (!isGeneration) {
    const responseText = await upstream.text();
    await logProxyUsage({
      provider: PROVIDER,
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
      requestId,
      metadata: {
        ...baseMeta,
        passthrough: true,
        method: req.method,
        status: upstream.status,
        latencyMs,
        ...promptRiskLogMetadata(promptRisk),
      },
    });
    if (promptRisk.flagged) {
      await createPromptRiskAlert({ provider: PROVIDER, model, department, userEmail, aiSystemId, analysis: promptRisk });
    }
    return new Response(responseText, { status: upstream.status, headers: { "Content-Type": contentType } });
  }

  // ── Streaming ──
  if (isStreaming && upstream.ok && upstream.body) {
    const [clientStream, logStream] = upstream.body.tee();
    after(
      extractGeminiStreamUsage(logStream, {
        sse: isGeminiSseStream(search) || contentType.includes("text/event-stream"),
        model,
        department,
        userEmail,
        latencyMs,
        aiSystemId,
        agent,
        promptRisk,
        requestId,
        baseMeta,
      }).catch((err) => {
        logger.error("gemini_proxy.stream_usage_failed", {
          model,
          error: err instanceof Error ? err.message : "Unknown error",
        });
      })
    );
    if (promptRisk.flagged) {
      await createPromptRiskAlert({ provider: PROVIDER, model, department, userEmail, aiSystemId, analysis: promptRisk });
    }
    return new Response(clientStream, {
      status: upstream.status,
      headers: { "Content-Type": contentType, "Cache-Control": "no-cache", Connection: "keep-alive" },
    });
  }

  // ── Non-streaming (and streaming errors, which come back as JSON) ──
  const responseText = await upstream.text();
  let responseBody: Record<string, unknown> | null = null;
  try {
    const value: unknown = JSON.parse(responseText);
    if (value && typeof value === "object" && !Array.isArray(value)) {
      responseBody = value as Record<string, unknown>;
    }
  } catch {
    // non-JSON upstream body
  }

  const tokenUsage = usageFromGemini(responseBody?.usageMetadata as GeminiUsageMetadata | undefined);
  const accounted = accountTokens(tokenUsage);
  const pricing = calculateCost(PROVIDER, model, tokenUsage);
  const toolUses: ObservedToolUse[] = upstream.ok ? extractGeminiToolUses(responseBody) : [];
  const responseDlp = upstream.ok
    ? await analyzeText(extractGeminiResponseText(responseBody), { excludeIntentRules: true })
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
    const message = (responseBody?.error as { message?: string } | undefined)?.message ?? "";
    const apiError = `API error: ${upstream.status} ${message}`.trim();
    flagReason = flagReason ? `${flagReason}; ${apiError}` : apiError;
  }

  await logProxyUsage({
    provider: PROVIDER,
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
      mcp: toolUses.length > 0 ? summarizeMcpForMetadata([], toolUses) : undefined,
      ...promptRiskLogMetadata(promptRisk),
    },
  });
  if (promptRisk.flagged) {
    await createPromptRiskAlert({ provider: PROVIDER, model, department, userEmail, aiSystemId, analysis: promptRisk });
  }
  if (responseDlp?.flagged) {
    await recordSensitiveFinding({ source: "response_dlp", provider: PROVIDER, model, analysis: responseDlp, aiSystemId });
  }
  await recordToolActivity({
    agent,
    aiSystemId,
    provider: PROVIDER,
    model,
    requestId,
    userEmail,
    department,
    declaredServers: [],
    toolUses,
  });

  return new Response(responseText, { status: upstream.status, headers: { "Content-Type": contentType } });
}

/**
 * Drain the telemetry branch of a `streamGenerateContent` response. SSE
 * (`?alt=sse`) is parsed line by line; the JSON-array form is buffered and
 * parsed once the stream ends. Either way each chunk's cumulative
 * `usageMetadata` is folded in and the candidate text collected for DLP.
 */
async function extractGeminiStreamUsage(
  stream: ReadableStream<Uint8Array>,
  ctx: {
    sse: boolean;
    model: string;
    department: string | null;
    userEmail: string | null;
    latencyMs: number;
    aiSystemId: string | null;
    agent: AgentGovernance | null;
    promptRisk: PromptRiskResult;
    requestId: string | null;
    baseMeta: Record<string, unknown>;
  }
) {
  try {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let usage: TokenUsage = EMPTY_USAGE;
    const responseTextParts: string[] = [];
    const toolUses: ObservedToolUse[] = [];
    const fold = (chunk: unknown) => {
      usage = mergeGeminiStreamUsage(usage, chunk);
      const text = extractGeminiResponseText(chunk);
      if (text) responseTextParts.push(text);
      toolUses.push(...extractGeminiToolUses(chunk));
    };

    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      if (!ctx.sse) continue;
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (!data) continue;
        try {
          fold(JSON.parse(data));
        } catch {
          // skip non-JSON lines
        }
      }
    }
    buffer += decoder.decode();
    if (!ctx.sse) {
      try {
        const parsed: unknown = JSON.parse(buffer);
        for (const chunk of Array.isArray(parsed) ? parsed : [parsed]) fold(chunk);
      } catch {
        logger.warn("gemini_proxy.stream_parse_failed", { model: ctx.model, requestId: ctx.requestId });
      }
    }

    const accounted = accountTokens(usage);
    const pricing = calculateCost(PROVIDER, ctx.model, usage);
    const responseDlp =
      responseTextParts.length > 0
        ? await analyzeText(responseTextParts.join(""), { excludeIntentRules: true })
        : null;
    if (responseDlp?.flagged) {
      await recordSensitiveFinding({
        source: "response_dlp",
        provider: PROVIDER,
        model: ctx.model,
        analysis: responseDlp,
        aiSystemId: ctx.aiSystemId,
      });
    }

    if (accounted.totalTokens > 0) {
      await logProxyUsage({
        provider: PROVIDER,
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
          sse: ctx.sse,
          ...usageMetadata(usage, pricing),
          mcp: toolUses.length > 0 ? summarizeMcpForMetadata([], toolUses) : undefined,
          ...promptRiskLogMetadata(ctx.promptRisk),
        },
      });
    } else {
      logger.warn("gemini_proxy.stream_usage_missing", { model: ctx.model, requestId: ctx.requestId });
    }

    await recordToolActivity({
      agent: ctx.agent,
      aiSystemId: ctx.aiSystemId,
      provider: PROVIDER,
      model: ctx.model,
      requestId: ctx.requestId,
      userEmail: ctx.userEmail,
      department: ctx.department,
      declaredServers: [],
      toolUses,
    });
  } catch (err) {
    logger.error("gemini_proxy.stream_usage_failed", {
      model: ctx.model,
      error: err instanceof Error ? err.message : "Unknown error",
    });
  }
}
