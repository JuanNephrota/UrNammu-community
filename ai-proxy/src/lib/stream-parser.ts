import { Readable } from "stream";
import {
  accountTokens,
  calculateCost,
  EMPTY_USAGE,
  mergeAnthropicStreamUsage,
  mergeBedrockStreamUsage,
  mergeGeminiStreamUsage,
  mergeOpenAIResponsesStreamUsage,
  mergeOpenAIStreamUsage,
  usageMetadata,
  type PricingProviderInput,
  type TokenUsage,
} from "./pricing";
import { logUsage } from "./db";
import { scanResponseForSensitiveInfo } from "./sensitive-detect";
import {
  extractAnthropicStreamToolUse,
  extractOpenAIStreamToolUses,
  summarizeMcpForMetadata,
  type DeclaredMcpServer,
  type ObservedToolUse,
} from "./mcp-tool-governance";
import {
  decodeBedrockEventPayload,
  extractGeminiResponseText,
  extractGeminiToolUses,
  extractOpenAIStreamText,
  splitEventStreamFrames,
  type OpenAIEndpoint,
} from "./proxy-providers";
import { recordToolActivity } from "./tool-activity";
import type { LoadedAgent } from "./agent-loader";

export interface StreamContext {
  /** `APIUsageLog.provider`: claude | chatgpt | azure_openai | gemini | bedrock. */
  provider: string;
  /** Pricing table to price under (see ./pricing.ts). */
  pricingProvider: PricingProviderInput;
  model: string;
  department: string | null;
  userEmail: string | null;
  latencyMs: number;
  aiSystemId: string | null;
  /** Upstream request id from the response headers; see logUsage. */
  requestId: string | null;
  /** Agent the call was attributed to via x-agent-id, if any. */
  agent?: LoadedAgent | null;
  /** MCP servers the request declared (for profiles + metadata). */
  declaredServers?: DeclaredMcpServer[];
  /** Passthrough summary, so streaming rows carry the same mcp metadata as non-streaming. */
  mcp?: { servers: number; forwardedHeaders: string[] } | null;
  /** OpenAI chat only: true when the proxy added `stream_options.include_usage` itself. */
  usageInjected?: boolean;
  /** OpenAI: which endpoint's event shape to parse. */
  endpoint?: OpenAIEndpoint;
  /** Gemini: `?alt=sse` (SSE) vs the JSON-array stream. */
  sse?: boolean;
  /** Extra metadata every row for this request carries (path, endpoint, deployment…). */
  baseMeta?: Record<string, unknown>;
  /**
   * Salted fingerprint of the user prompt (see ./prompt-hash.ts) — never the
   * prompt. Lets this row be correlated with dangerous_prompt alerts and
   * Claude Code / Cursor telemetry that carried the same prompt.
   */
  promptHash?: string | null;
}

/** Shared tail: response DLP, the usage row (when tokens were charged) and tool activity. */
async function finalizeStream(
  ctx: StreamContext,
  usage: TokenUsage,
  responseTextParts: string[],
  toolUses: ObservedToolUse[],
  extraMeta: Record<string, unknown> = {}
): Promise<void> {
  const dlp =
    responseTextParts.length > 0
      ? await scanResponseForSensitiveInfo({
          provider: ctx.provider,
          model: ctx.model,
          aiSystemId: ctx.aiSystemId,
          responseText: responseTextParts.join(""),
        })
      : null;

  const accounted = accountTokens(usage);
  if (accounted.totalTokens > 0) {
    const pricing = calculateCost(ctx.pricingProvider, ctx.model, usage);
    const declared = ctx.declaredServers ?? [];
    await logUsage({
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
      flagged: !!dlp?.flagged,
      flagCategory: dlp?.flagged ? "sensitive_response" : null,
      flagReason: dlp?.flagged ? dlp.summary : null,
      requestId: ctx.requestId,
      metadata: {
        ...(ctx.baseMeta ?? {}),
        latencyMs: ctx.latencyMs,
        streaming: true,
        aiSystemId: ctx.aiSystemId,
        agentId: ctx.agent?.id ?? null,
        promptHash: ctx.promptHash ?? null,
        ...extraMeta,
        ...usageMetadata(usage, pricing),
        mcp:
          ctx.mcp || declared.length > 0 || toolUses.length > 0
            ? { ...(ctx.mcp ?? {}), ...summarizeMcpForMetadata(declared, toolUses) }
            : undefined,
      },
    });
  } else {
    console.warn(
      `${ctx.provider} stream for ${ctx.model} ended without usage (requestId=${ctx.requestId ?? "n/a"}); nothing logged.`
    );
  }

  await recordToolActivity({
    agent: ctx.agent ?? null,
    aiSystemId: ctx.aiSystemId,
    provider: ctx.provider,
    model: ctx.model,
    requestId: ctx.requestId,
    userEmail: ctx.userEmail,
    department: ctx.department,
    declaredServers: ctx.declaredServers ?? [],
    toolUses,
  });
}

/** Iterate the `data:` payloads of an SSE stream. */
async function* sseDataLines(stream: Readable): AsyncGenerator<string> {
  let buffer = "";
  for await (const chunk of stream) {
    buffer += typeof chunk === "string" ? chunk : chunk.toString();
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (!data || data === "[DONE]") continue;
      yield data;
    }
  }
  if (buffer.startsWith("data:")) {
    const data = buffer.slice(5).trim();
    if (data && data !== "[DONE]") yield data;
  }
}

/**
 * Parse an Anthropic SSE stream: usage from message_start (input, cache_read,
 * cache_creation tokens) and message_delta (output tokens); text deltas for
 * DLP; content_block_start tool invocations for agent governance.
 */
export async function extractAnthropicStreamUsage(stream: Readable, ctx: StreamContext): Promise<void> {
  try {
    let usage: TokenUsage = EMPTY_USAGE;
    const responseTextParts: string[] = [];
    const toolUses: ObservedToolUse[] = [];
    for await (const data of sseDataLines(stream)) {
      try {
        const event = JSON.parse(data);
        const toolUse = extractAnthropicStreamToolUse(event);
        if (toolUse) toolUses.push(toolUse);
        usage = mergeAnthropicStreamUsage(usage, event);
        if (
          event.type === "content_block_delta" &&
          event.delta?.type === "text_delta" &&
          typeof event.delta.text === "string"
        ) {
          responseTextParts.push(event.delta.text);
        }
      } catch {
        // skip non-JSON lines
      }
    }
    await finalizeStream(ctx, usage, responseTextParts, toolUses);
  } catch (err) {
    console.error("Failed to extract Anthropic stream usage:", err);
  }
}

/**
 * Parse an OpenAI SSE stream. Chat Completions carry usage on the final
 * chunk only (with `stream_options.include_usage`, which the handler injects
 * when the client omits it); the Responses API carries it on
 * `response.completed`. Also works for Azure OpenAI.
 */
export async function extractOpenAIStreamUsage(stream: Readable, ctx: StreamContext): Promise<void> {
  try {
    const endpoint = ctx.endpoint ?? "chat_completions";
    const merge = endpoint === "responses" ? mergeOpenAIResponsesStreamUsage : mergeOpenAIStreamUsage;
    let usage: TokenUsage = EMPTY_USAGE;
    const responseTextParts: string[] = [];
    const toolUses: ObservedToolUse[] = [];
    for await (const data of sseDataLines(stream)) {
      try {
        const event = JSON.parse(data);
        toolUses.push(...extractOpenAIStreamToolUses(event));
        usage = merge(usage, event);
        const text = extractOpenAIStreamText(endpoint, event);
        if (text) responseTextParts.push(text);
      } catch {
        // skip
      }
    }
    await finalizeStream(ctx, usage, responseTextParts, toolUses, {
      usageInjected: ctx.usageInjected ?? false,
    });
  } catch (err) {
    console.error("Failed to extract OpenAI stream usage:", err);
  }
}

/**
 * Parse a Gemini `streamGenerateContent` response. With `?alt=sse` it is SSE;
 * otherwise a JSON array, buffered and parsed once the stream ends. Each
 * chunk's cumulative `usageMetadata` is folded in.
 */
export async function extractGeminiStreamUsage(stream: Readable, ctx: StreamContext): Promise<void> {
  try {
    let usage: TokenUsage = EMPTY_USAGE;
    const responseTextParts: string[] = [];
    const toolUses: ObservedToolUse[] = [];
    const fold = (chunk: unknown) => {
      usage = mergeGeminiStreamUsage(usage, chunk);
      const text = extractGeminiResponseText(chunk);
      if (text) responseTextParts.push(text);
      toolUses.push(...extractGeminiToolUses(chunk));
    };
    if (ctx.sse) {
      for await (const data of sseDataLines(stream)) {
        try {
          fold(JSON.parse(data));
        } catch {
          // skip
        }
      }
    } else {
      let buffer = "";
      for await (const chunk of stream) buffer += typeof chunk === "string" ? chunk : chunk.toString();
      try {
        const parsed: unknown = JSON.parse(buffer);
        for (const chunk of Array.isArray(parsed) ? parsed : [parsed]) fold(chunk);
      } catch {
        console.warn(`Gemini stream for ${ctx.model} was not parseable JSON (requestId=${ctx.requestId ?? "n/a"}).`);
      }
    }
    await finalizeStream(ctx, usage, responseTextParts, toolUses, { sse: !!ctx.sse });
  } catch (err) {
    console.error("Failed to extract Gemini stream usage:", err);
  }
}

/**
 * Parse a Bedrock `invoke-with-response-stream` body: an
 * `application/vnd.amazon.eventstream` binary stream whose `chunk` payloads
 * wrap the Anthropic stream events (`{"bytes": "<base64 JSON>"}`).
 */
export async function extractBedrockStreamUsage(stream: Readable, ctx: StreamContext): Promise<void> {
  try {
    let pending: Uint8Array = new Uint8Array(0);
    let usage: TokenUsage = EMPTY_USAGE;
    const responseTextParts: string[] = [];
    const toolUses: ObservedToolUse[] = [];
    for await (const chunk of stream) {
      const bytes: Uint8Array = typeof chunk === "string" ? Buffer.from(chunk) : new Uint8Array(chunk);
      const merged = new Uint8Array(pending.length + bytes.length);
      merged.set(pending, 0);
      merged.set(bytes, pending.length);
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
    await finalizeStream(ctx, usage, responseTextParts, toolUses);
  } catch (err) {
    console.error("Failed to extract Bedrock stream usage:", err);
  }
}
