import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSetting } from "@/lib/settings";
import { logger } from "@/lib/observability";
import {
  analyzePromptRisk,
  analyzeText,
  createPromptRiskAlert,
  promptRiskLogMetadata,
} from "@/lib/prompt-risk";
import { recordSensitiveFinding } from "@/lib/sensitive-alerts";
import { writeProxyUsageBucket } from "@/lib/proxy-bucket-writer";
import { secretsMatch } from "@/lib/secret-compare";
import {
  accountTokens,
  calculateCost,
  EMPTY_USAGE,
  isOpenAIUsageOnlyChunk,
  mergeOpenAIStreamUsage,
  usageFromOpenAI,
  usageMetadata,
  type TokenUsage,
} from "@/lib/model-pricing";

/**
 * OpenAI API Proxy
 *
 * Transparently forwards requests to the OpenAI Chat Completions API
 * while logging usage to the AI Oversight module.
 *
 * Usage: Point your apps at this proxy instead of https://api.openai.com/v1/chat/completions
 *
 *   // In your app's OpenAI client config:
 *   //   baseURL: "http://localhost:3001/api/proxy/openai"
 *   //
 *   // Or with curl:
 *   //   curl http://localhost:3001/api/proxy/openai \
 *   //     -H "Authorization: Bearer sk-..." \
 *   //     -H "x-proxy-key: your-proxy-secret" \
 *   //     -H "x-department: Engineering" \
 *   //     -d '{"model":"gpt-4","messages":[...]}'
 *
 * Streaming: OpenAI only reports token usage on a stream when the request
 * sets `stream_options.include_usage`. When the client omits it we inject it
 * upstream so the final chunk carries usage (prompt, completion and cached
 * tokens), tee the stream so telemetry is extracted in `after()`, and strip
 * that extra usage-only chunk from what the client receives so the response
 * matches what the client asked for. Pricing + token accounting live in
 * `@/lib/model-pricing`.
 */

const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";

type OpenAIUpstreamPayload =
  | {
      kind: "stream";
      body: ReadableStream<Uint8Array>;
      contentType: string;
    }
  | {
      kind: "json";
      body: Record<string, unknown>;
      contentType: string;
    }
  | {
      kind: "text";
      body: string;
      contentType: string;
    };

type OpenAIErrorBody = {
  error?: {
    code?: string;
    type?: string;
    message?: string;
  };
};

type OpenAIUsageBody = {
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number } | null;
  };
};

type OpenAIResponseTextBody = {
  choices?: Array<{ message?: { content?: string } }>;
};

type FlagCategory =
  | "upstream_error"
  | "proxy_error"
  | "prompt_risk"
  | "sensitive_response"
  | null;

export function getContentType(headers: Headers): string {
  return headers.get("Content-Type") ?? headers.get("content-type") ?? "application/json";
}

/** OpenAI returns its request id as `x-request-id`; persisted on APIUsageLog.requestId. */
function upstreamRequestId(res: Response): string | null {
  return res.headers.get("x-request-id") ?? res.headers.get("request-id");
}

export async function readOpenAIUpstreamPayload(
  response: Response
): Promise<OpenAIUpstreamPayload> {
  const contentType = getContentType(response.headers);

  if (contentType.includes("text/event-stream")) {
    if (!response.body) {
      throw new Error("OpenAI stream response body was empty.");
    }

    return {
      kind: "stream",
      body: response.body,
      contentType,
    };
  }

  if (contentType.includes("application/json")) {
    return {
      kind: "json",
      body: (await response.json()) as Record<string, unknown>,
      contentType,
    };
  }

  return {
    kind: "text",
    body: await response.text(),
    contentType,
  };
}

export function sanitizeOpenAIUpstreamError(
  status: number,
  payload: OpenAIUpstreamPayload
): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {
    error: "upstream_error",
    status,
  };

  if (payload.kind !== "json") {
    return sanitized;
  }

  const body = payload.body as OpenAIErrorBody;

  const upstreamCode =
    typeof body.error?.code === "string"
      ? body.error.code
      : null;
  const upstreamType =
    typeof body.error?.type === "string"
      ? body.error.type
      : null;

  if (upstreamCode) sanitized.code = upstreamCode;
  if (upstreamType) sanitized.type = upstreamType;
  return sanitized;
}

// ── SSE helpers ─────────────────────────────────────────────────────────────

const SSE_EVENT_BOUNDARY = /\r?\n\r?\n/;

/** Join the `data:` lines of one SSE event; null when the event has none. */
function sseDataPayload(eventText: string): string | null {
  const lines = eventText.split(/\r?\n/);
  const data: string[] = [];
  for (const line of lines) {
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
 * proxy injected that option itself, so clients see exactly the stream shape
 * they requested.
 */
function createUsageChunkFilter(): TransformStream<Uint8Array, Uint8Array> {
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

export async function POST(req: NextRequest) {
  // Authenticate proxy request
  const proxyKey = req.headers.get("x-proxy-key");
  const proxySecret =
    (await getSetting("proxy_secret")) ?? process.env.PROXY_SECRET;

  if (!proxySecret) {
    return NextResponse.json(
      { error: "Proxy not configured. Set PROXY_SECRET env var or configure in Settings." },
      { status: 500 }
    );
  }

  if (!secretsMatch(proxyKey, proxySecret)) {
    return NextResponse.json(
      { error: "Invalid x-proxy-key header" },
      { status: 401 }
    );
  }

  // Get the OpenAI API key from the Authorization header
  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return NextResponse.json(
      { error: "Missing Authorization: Bearer <key> header" },
      { status: 400 }
    );
  }

  const department = req.headers.get("x-department") ?? null;
  const userEmail = req.headers.get("x-user-email") ?? null;
  const requestedSystemId = req.headers.get("x-ai-system-id");
  const linkedSystem = requestedSystemId
    ? await prisma.aISystem.findUnique({
        where: { id: requestedSystemId },
        select: { id: true },
      })
    : null;
  const aiSystemId = linkedSystem?.id ?? null;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const model = (body.model as string) ?? "unknown";
  const promptRisk = await analyzePromptRisk(body);
  const isStreaming = body.stream === true;

  // Streaming usage: inject `stream_options.include_usage` when the client
  // did not ask for it, and remember to strip the resulting usage chunk.
  const streamOptions =
    body.stream_options && typeof body.stream_options === "object"
      ? (body.stream_options as Record<string, unknown>)
      : null;
  const clientRequestedUsage = streamOptions?.include_usage === true;
  const injectUsage = isStreaming && !clientRequestedUsage;
  const upstreamBody = injectUsage
    ? { ...body, stream_options: { ...(streamOptions ?? {}), include_usage: true } }
    : body;

  const startTime = Date.now();
  let openaiResponse: Response;

  try {
    openaiResponse = await fetch(OPENAI_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: authHeader,
      },
      body: JSON.stringify(upstreamBody),
    });
  } catch (err) {
    logger.error("openai_proxy.upstream_unreachable", {
      model,
      department,
      userEmail,
      error: err instanceof Error ? err.message : "Network error",
    });
    await logUsage({
      provider: "chatgpt",
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
        aiSystemId,
      },
    });

    if (promptRisk.flagged) {
      await createPromptRiskAlert({
        provider: "chatgpt",
        model,
        department,
        userEmail,
        aiSystemId,
        analysis: promptRisk,
      });
    }

    return NextResponse.json(
      { error: "Failed to reach OpenAI API" },
      { status: 502 }
    );
  }

  const responsePayload = await readOpenAIUpstreamPayload(openaiResponse);
  const latencyMs = Date.now() - startTime;
  const requestId = upstreamRequestId(openaiResponse);

  if (responsePayload.kind === "stream") {
    // Tee: one branch to the client, one drained in `after()` for usage,
    // cache tokens and response DLP — mirrors the Anthropic proxy.
    const [clientStream, logStream] = responsePayload.body.tee();

    after(
      extractOpenAIStreamUsage(logStream, {
        model,
        department,
        userEmail,
        latencyMs,
        aiSystemId,
        promptRisk,
        requestId,
        injectedUsage: injectUsage,
      }).catch((err) => {
        logger.error("openai_proxy.stream_usage_failed", {
          model,
          error: err instanceof Error ? err.message : "Unknown error",
        });
      })
    );

    if (promptRisk.flagged) {
      await createPromptRiskAlert({
        provider: "chatgpt",
        model,
        department,
        userEmail,
        aiSystemId,
        analysis: promptRisk,
      });
      logger.warn("openai_proxy.dangerous_prompt_detected", {
        model,
        department,
        userEmail,
        categories: promptRisk.categories,
        aiSystemId,
      });
    }

    const outgoing = injectUsage
      ? clientStream.pipeThrough(createUsageChunkFilter())
      : clientStream;

    return new Response(outgoing, {
      status: openaiResponse.status,
      headers: {
        "Content-Type": responsePayload.contentType,
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  }

  if (responsePayload.kind === "text") {
    if (!openaiResponse.ok) {
      logger.warn("openai_proxy.upstream_error", {
        status: openaiResponse.status,
        model,
        department,
        userEmail,
        contentType: responsePayload.contentType,
      });
      return NextResponse.json(
        sanitizeOpenAIUpstreamError(openaiResponse.status, responsePayload),
        { status: openaiResponse.status }
      );
    }

    return new Response(responsePayload.body, {
      status: openaiResponse.status,
      headers: {
        "Content-Type": responsePayload.contentType,
      },
    });
  }

  const responseBody = responsePayload.body;

  // OpenAI's prompt_tokens INCLUDES cached tokens — usageFromOpenAI splits
  // them out so cache reads are priced at the cached rate.
  const tokenUsage = usageFromOpenAI((responseBody as OpenAIUsageBody).usage);
  const accounted = accountTokens(tokenUsage);
  const pricing = calculateCost("openai", model, tokenUsage);

  // Inline DLP on the model's response — detect sensitive info coming back.
  const responseDlp = openaiResponse.ok
    ? await analyzeText(
        (responseBody as OpenAIResponseTextBody).choices?.[0]?.message?.content ?? "",
        { excludeIntentRules: true }
      )
    : null;

  let flagged = promptRisk.flagged;
  let flagCategory: FlagCategory = promptRisk.flagged ? "prompt_risk" : null;
  let flagReason: string | null = promptRisk.flagReason;

  if (responseDlp?.flagged && flagCategory === null) {
    flagged = true;
    flagCategory = "sensitive_response";
    flagReason = responseDlp.flagReason;
  }

  if (!openaiResponse.ok) {
    flagged = true;
    if (flagCategory === null) flagCategory = "upstream_error";
    const apiError = `API error: ${openaiResponse.status} ${((responseBody as OpenAIErrorBody).error?.message ?? "")}`.trim();
    flagReason = flagReason ? `${flagReason}; ${apiError}` : apiError;
  }

  await logUsage({
    provider: "chatgpt",
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
      status: openaiResponse.status,
      aiSystemId,
      ...usageMetadata(tokenUsage, pricing),
      ...promptRiskLogMetadata(promptRisk),
    },
  });

  if (promptRisk.flagged) {
    await createPromptRiskAlert({
      provider: "chatgpt",
      model,
      department,
      userEmail,
      aiSystemId,
      analysis: promptRisk,
    });
    logger.warn("openai_proxy.dangerous_prompt_detected", {
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
      provider: "chatgpt",
      model,
      analysis: responseDlp,
      aiSystemId,
    });
  }

  // Successful upstream: return the response as-is.
  // On upstream errors, strip internal detail before returning to the caller —
  // OpenAI error bodies may include org IDs, rate-limit internals, or hints
  // about our server-side key that callers shouldn't see.
  if (!openaiResponse.ok) {
    const sanitized = sanitizeOpenAIUpstreamError(openaiResponse.status, responsePayload);
    logger.warn("openai_proxy.upstream_error", {
      status: openaiResponse.status,
      code: sanitized.code,
      type: sanitized.type,
      model,
      department,
      userEmail,
    });
    return NextResponse.json(sanitized, { status: openaiResponse.status });
  }

  return NextResponse.json(responseBody, {
    status: openaiResponse.status,
  });
}

/**
 * Drain the log branch of a teed chat-completions SSE stream: accumulate the
 * assistant text for response DLP and pick usage off the final chunk (present
 * because the client asked for `include_usage`, or because we injected it).
 * Runs inside `after()`, so it must never throw into the response path.
 */
async function extractOpenAIStreamUsage(
  stream: ReadableStream<Uint8Array>,
  ctx: {
    model: string;
    department: string | null;
    userEmail: string | null;
    latencyMs: number;
    aiSystemId: string | null;
    promptRisk: Awaited<ReturnType<typeof analyzePromptRisk>>;
    requestId: string | null;
    injectedUsage: boolean;
  }
) {
  try {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let usage: TokenUsage = EMPTY_USAGE;
    const responseTextParts: string[] = [];

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
          const chunk = JSON.parse(data);
          usage = mergeOpenAIStreamUsage(usage, chunk);
          const delta = chunk?.choices?.[0]?.delta?.content;
          if (typeof delta === "string") responseTextParts.push(delta);
        } catch {
          // skip non-JSON lines
        }
      }
    }

    const accounted = accountTokens(usage);
    const pricing = calculateCost("openai", ctx.model, usage);

    // Same response-DLP path as the non-streaming branch.
    const responseDlp =
      responseTextParts.length > 0
        ? await analyzeText(responseTextParts.join(""), { excludeIntentRules: true })
        : null;
    if (responseDlp?.flagged) {
      await recordSensitiveFinding({
        source: "response_dlp",
        provider: "chatgpt",
        model: ctx.model,
        analysis: responseDlp,
        aiSystemId: ctx.aiSystemId,
      });
    }

    if (accounted.totalTokens > 0) {
      await logUsage({
        provider: "chatgpt",
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
          latencyMs: ctx.latencyMs,
          streaming: true,
          usageInjected: ctx.injectedUsage,
          aiSystemId: ctx.aiSystemId,
          ...usageMetadata(usage, pricing),
          ...promptRiskLogMetadata(ctx.promptRisk),
        },
      });
    } else {
      logger.warn("openai_proxy.stream_usage_missing", {
        model: ctx.model,
        requestId: ctx.requestId,
        usageInjected: ctx.injectedUsage,
      });
    }
  } catch (err) {
    logger.error("openai_proxy.stream_usage_failed", {
      model: ctx.model,
      error: err instanceof Error ? err.message : "Unknown error",
    });
  }
}

async function logUsage(params: {
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
  flagCategory?: FlagCategory;
  flagReason?: string | null;
  /** Upstream `x-request-id`. Null when the call never reached OpenAI. */
  requestId?: string | null;
  metadata?: Record<string, unknown>;
}) {
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

    // Mirror to normalized UsageBucket/CostBucket (see proxy-bucket-writer.ts).
    if (params.totalTokens > 0) {
      await writeProxyUsageBucket({
        provider: "openai",
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
  } catch (err) {
    logger.error("openai_proxy.log_usage_failed", {
      model: params.model,
      provider: params.provider,
      error: err instanceof Error ? err.message : "Unknown error",
    });
  }
}
