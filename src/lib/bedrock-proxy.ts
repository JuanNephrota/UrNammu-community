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
  mergeBedrockStreamUsage,
  normalizeModelId,
  usageFromAnthropic,
  usageMetadata,
  type AnthropicUsagePayload,
  type TokenUsage,
} from "./model-pricing";
import {
  bedrockRuntimeHost,
  canonicalizeRequest,
  decodeBedrockEventPayload,
  isValidAwsRegion,
  parseBedrockPath,
  parseSigV4Authorization,
  policyViewOf,
  selectBedrockForwardHeaders,
  splitEventStreamFrames,
} from "./proxy-providers";
import {
  extractAnthropicStreamToolUse,
  extractAnthropicToolUses,
  summarizeMcpForMetadata,
  type ObservedToolUse,
} from "./mcp-tool-governance";
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
 * Amazon Bedrock proxy (v1: log only, no credential injection).
 *
 * `/api/proxy/bedrock/{*path}` forwards `/model/{modelId}/invoke` and
 * `/model/{modelId}/invoke-with-response-stream` — the Anthropic Messages API
 * on Bedrock — to `bedrock-runtime.{region}.amazonaws.com`. The client
 * authenticates to AWS itself, either with a Bedrock API key
 * (`Authorization: Bearer …`, the recommended path) or with a SigV4-signed
 * request. Signed requests are forwarded byte-for-byte with every header the
 * client signed, so the signature verifies only if the client signed for the
 * Bedrock host (see the proxy setup guide). The region comes from
 * `x-aws-region`, else the SigV4 credential scope, else `BEDROCK_REGION` /
 * `AWS_REGION`. Signing with a proxy-held role is a separate decision.
 *
 * Responses are the Anthropic shapes: JSON with `usage` for invoke, and an
 * `application/vnd.amazon.eventstream` binary stream whose `chunk` payloads
 * wrap the Anthropic SSE events for the streaming variant. Model ids are
 * normalised (`us.anthropic.claude-…-v1:0` → `claude-…`) so pricing resolves.
 * Other operations (converse, listings) pass through with a 0-token row.
 */

const PROVIDER = "bedrock";

export async function handleBedrockProxy(req: NextRequest, subpath: string): Promise<Response> {
  const authError = await authenticateProxyRequest(req);
  if (authError) return authError;

  const authorization = req.headers.get("authorization");
  const sigv4 = parseSigV4Authorization(authorization);
  const isBearer = !!authorization?.startsWith("Bearer ");
  if (!sigv4 && !isBearer) {
    return NextResponse.json(
      {
        error:
          "Missing AWS credentials. Send Authorization: Bearer <Bedrock API key>, or a SigV4-signed request (AWS4-HMAC-SHA256).",
      },
      { status: 400 }
    );
  }

  const region =
    req.headers.get("x-aws-region") ??
    sigv4?.region ??
    process.env.BEDROCK_REGION ??
    process.env.AWS_REGION ??
    null;
  const host = isValidAwsRegion(region) ? bedrockRuntimeHost(region) : null;
  if (!host) {
    return NextResponse.json(
      { error: "Unknown AWS region. Send x-aws-region (e.g. us-east-1) or sign the request for a region." },
      { status: 400 }
    );
  }

  const parsed = parseBedrockPath(subpath);
  const targetUrl = `https://${host}${parsed.path}${req.nextUrl.search}`;
  const rawModelId = parsed.modelId;
  const model = rawModelId ? normalizeModelId(rawModelId) : "unknown";
  const { department, userEmail, aiSystemId, agent } = await resolveProxyAttribution(req);

  // The body must reach Bedrock byte-for-byte (SigV4 covers its hash), so it
  // is never re-serialised; governance reads a parsed copy.
  const rawBody = req.method === "GET" || req.method === "HEAD" ? null : await req.arrayBuffer();
  let bodyJson: Record<string, unknown> | null = null;
  if (rawBody && rawBody.byteLength > 0) {
    try {
      const value: unknown = JSON.parse(new TextDecoder().decode(rawBody));
      if (value && typeof value === "object" && !Array.isArray(value)) {
        bodyJson = value as Record<string, unknown>;
      }
    } catch {
      // not JSON
    }
  }
  const forwardHeaders = selectBedrockForwardHeaders(req.headers, sigv4?.signedHeaders ?? []);
  const isMessages =
    (parsed.operation === "invoke" || parsed.operation === "invoke-with-response-stream") && !!bodyJson;
  const isStreaming = parsed.operation === "invoke-with-response-stream";
  const baseMeta = {
    path: parsed.path,
    endpoint: parsed.operation,
    region,
    bedrockModelId: rawModelId,
    authMode: sigv4 ? "sigv4" : "bearer",
    aiSystemId,
    agentId: agent?.id ?? null,
  };

  const canonical = { ...canonicalizeRequest("anthropic", bodyJson), model };
  const policyBody = isMessages ? policyViewOf(canonical) : bodyJson;
  const promptRisk = await analyzePromptRisk(policyBody);
  if (policyBody) {
    const denied = await runPolicyGate({
      provider: PROVIDER,
      model,
      aiSystemId,
      userEmail,
      department,
      policyBody,
      isStreaming,
      requestMetadata: { endpoint: parsed.operation, path: parsed.path, region },
    });
    if (denied) return denied;
  }

  const startTime = Date.now();
  let upstream: Response;
  try {
    upstream = await fetch(targetUrl, {
      method: req.method,
      headers: forwardHeaders,
      body: rawBody && rawBody.byteLength > 0 ? rawBody : undefined,
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
    return NextResponse.json({ error: "Failed to reach Amazon Bedrock" }, { status: 502 });
  }

  const latencyMs = Date.now() - startTime;
  const contentType = upstream.headers.get("content-type") ?? "application/json";
  const requestId = upstream.headers.get("x-amzn-requestid") ?? upstream.headers.get("x-amzn-request-id");
  const passthroughHeaders: Record<string, string> = { "Content-Type": contentType };
  for (const name of ["x-amzn-requestid", "x-amzn-bedrock-input-token-count", "x-amzn-bedrock-output-token-count"]) {
    const value = upstream.headers.get(name);
    if (value) passthroughHeaders[name] = value;
  }

  // ── Pass-through (converse, listings, non-JSON bodies) ──
  if (!isMessages) {
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
    return new Response(responseText, { status: upstream.status, headers: passthroughHeaders });
  }

  // ── Streaming (binary event stream) ──
  if (isStreaming && upstream.ok && upstream.body) {
    const [clientStream, logStream] = upstream.body.tee();
    after(
      extractBedrockStreamUsage(logStream, {
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
        logger.error("bedrock_proxy.stream_usage_failed", {
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
      headers: { ...passthroughHeaders, "Cache-Control": "no-cache", Connection: "keep-alive" },
    });
  }

  // ── Non-streaming invoke (and streaming errors, returned as JSON) ──
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

  const tokenUsage = usageFromAnthropic(responseBody?.usage as AnthropicUsagePayload | undefined);
  const accounted = accountTokens(tokenUsage);
  const pricing = calculateCost(PROVIDER, model, tokenUsage);
  const toolUses = upstream.ok ? extractAnthropicToolUses(responseBody?.content) : [];
  const responseTextForDlp = Array.isArray(responseBody?.content)
    ? (responseBody!.content as Array<{ type?: string; text?: string }>)
        .filter((b) => b?.type === "text" && typeof b.text === "string")
        .map((b) => b.text as string)
        .join("\n")
    : "";
  const responseDlp = upstream.ok ? await analyzeText(responseTextForDlp, { excludeIntentRules: true }) : null;

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
    const message =
      (responseBody?.message as string | undefined) ??
      (responseBody?.error as { message?: string } | undefined)?.message ??
      "";
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

  return new Response(responseText, { status: upstream.status, headers: passthroughHeaders });
}

/**
 * Drain the telemetry branch of an `invoke-with-response-stream` response:
 * split the binary event stream into frames, decode each `chunk` payload
 * back into the Anthropic stream event, and fold usage / text / tool uses.
 */
async function extractBedrockStreamUsage(
  stream: ReadableStream<Uint8Array>,
  ctx: {
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
    let pending: Uint8Array = new Uint8Array(0);
    let usage: TokenUsage = EMPTY_USAGE;
    const responseTextParts: string[] = [];
    const toolUses: ObservedToolUse[] = [];

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const merged = new Uint8Array(pending.length + value.length);
      merged.set(pending, 0);
      merged.set(value, pending.length);
      const { frames, rest } = splitEventStreamFrames(merged);
      pending = rest;
      for (const frame of frames) {
        const event = decodeBedrockEventPayload(frame);
        if (!event || typeof event !== "object") continue;
        usage = mergeBedrockStreamUsage(usage, event);
        const e = event as { type?: string; delta?: { type?: string; text?: unknown } };
        if (e.type === "content_block_delta" && e.delta?.type === "text_delta" && typeof e.delta.text === "string") {
          responseTextParts.push(e.delta.text);
        }
        const toolUse = extractAnthropicStreamToolUse(event);
        if (toolUse) toolUses.push(toolUse);
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
          ...usageMetadata(usage, pricing),
          mcp: toolUses.length > 0 ? summarizeMcpForMetadata([], toolUses) : undefined,
          ...promptRiskLogMetadata(ctx.promptRisk),
        },
      });
    } else {
      logger.warn("bedrock_proxy.stream_usage_missing", { model: ctx.model, requestId: ctx.requestId });
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
    logger.error("bedrock_proxy.stream_usage_failed", {
      model: ctx.model,
      error: err instanceof Error ? err.message : "Unknown error",
    });
  }
}
