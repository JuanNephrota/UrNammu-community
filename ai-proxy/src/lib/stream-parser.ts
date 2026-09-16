import { Readable } from "stream";
import {
  accountTokens,
  calculateCost,
  EMPTY_USAGE,
  mergeAnthropicStreamUsage,
  mergeOpenAIStreamUsage,
  usageMetadata,
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
import { recordToolActivity } from "./tool-activity";
import type { LoadedAgent } from "./agent-loader";

interface StreamContext {
  provider: "claude" | "chatgpt";
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
  /** OpenAI only: true when the proxy added `stream_options.include_usage` itself. */
  usageInjected?: boolean;
}

/**
 * Parse an Anthropic SSE stream to extract usage from message_start (input,
 * cache_read, cache_creation tokens) and message_delta (output tokens) events.
 * Token accounting convention: see ./pricing.ts.
 */
export async function extractAnthropicStreamUsage(
  stream: Readable,
  ctx: StreamContext
): Promise<void> {
  try {
    let buffer = "";
    let usage: TokenUsage = EMPTY_USAGE;
    const responseTextParts: string[] = [];
    const toolUses: ObservedToolUse[] = [];

    for await (const chunk of stream) {
      buffer += typeof chunk === "string" ? chunk : chunk.toString();

      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const data = line.slice(6).trim();
        if (data === "[DONE]") continue;

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
    }

    // Inline DLP on the streamed response text.
    const dlp =
      responseTextParts.length > 0
        ? await scanResponseForSensitiveInfo({
            provider: "claude",
            model: ctx.model,
            aiSystemId: ctx.aiSystemId,
            responseText: responseTextParts.join(""),
          })
        : null;

    const accounted = accountTokens(usage);
    if (accounted.totalTokens > 0) {
      const pricing = calculateCost("anthropic", ctx.model, usage);
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
        flagged: !!dlp?.flagged,
        flagCategory: dlp?.flagged ? "sensitive_response" : null,
        flagReason: dlp?.flagged ? dlp.summary : null,
        requestId: ctx.requestId,
        metadata: {
          latencyMs: ctx.latencyMs,
          streaming: true,
          aiSystemId: ctx.aiSystemId,
          agentId: ctx.agent?.id ?? null,
          ...usageMetadata(usage, pricing),
          mcp:
            ctx.mcp || (ctx.declaredServers?.length ?? 0) > 0 || toolUses.length > 0
              ? { ...(ctx.mcp ?? {}), ...summarizeMcpForMetadata(ctx.declaredServers ?? [], toolUses) }
              : undefined,
        },
      });
    }

    await recordToolActivity({
      agent: ctx.agent ?? null,
      aiSystemId: ctx.aiSystemId,
      provider: "claude",
      model: ctx.model,
      requestId: ctx.requestId,
      userEmail: ctx.userEmail,
      department: ctx.department,
      declaredServers: ctx.declaredServers ?? [],
      toolUses,
    });
  } catch (err) {
    console.error("Failed to extract Anthropic stream usage:", err);
  }
}

/**
 * Parse an OpenAI SSE stream to extract usage from the final chunk.
 * OpenAI only includes usage (prompt, completion, cached tokens) in the last
 * `data:` event when `stream_options.include_usage` is set — the function
 * injects that option when the client omits it (see openai-proxy.ts). With
 * no usage chunk nothing is logged.
 */
export async function extractOpenAIStreamUsage(
  stream: Readable,
  ctx: StreamContext
): Promise<void> {
  try {
    let buffer = "";
    let usage: TokenUsage = EMPTY_USAGE;
    const responseTextParts: string[] = [];
    const toolUses: ObservedToolUse[] = [];

    for await (const chunk of stream) {
      buffer += typeof chunk === "string" ? chunk : chunk.toString();

      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const data = line.slice(6).trim();
        if (data === "[DONE]") continue;

        try {
          const event = JSON.parse(data);
          toolUses.push(...extractOpenAIStreamToolUses(event));
          usage = mergeOpenAIStreamUsage(usage, event);
          const delta = event.choices?.[0]?.delta?.content;
          if (typeof delta === "string") responseTextParts.push(delta);
        } catch {
          // skip
        }
      }
    }

    // Inline DLP on the streamed response text.
    const dlp =
      responseTextParts.length > 0
        ? await scanResponseForSensitiveInfo({
            provider: "chatgpt",
            model: ctx.model,
            aiSystemId: ctx.aiSystemId,
            responseText: responseTextParts.join(""),
          })
        : null;

    const accounted = accountTokens(usage);
    if (accounted.totalTokens > 0) {
      const pricing = calculateCost("openai", ctx.model, usage);
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
        flagged: !!dlp?.flagged,
        flagCategory: dlp?.flagged ? "sensitive_response" : null,
        flagReason: dlp?.flagged ? dlp.summary : null,
        requestId: ctx.requestId,
        metadata: {
          latencyMs: ctx.latencyMs,
          streaming: true,
          usageInjected: ctx.usageInjected ?? false,
          aiSystemId: ctx.aiSystemId,
          agentId: ctx.agent?.id ?? null,
          ...usageMetadata(usage, pricing),
          mcp: summarizeMcpForMetadata(ctx.declaredServers ?? [], toolUses),
        },
      });
    } else {
      console.warn(
        `OpenAI stream for ${ctx.model} ended without a usage chunk (requestId=${ctx.requestId ?? "n/a"}); nothing logged.`
      );
    }

    await recordToolActivity({
      agent: ctx.agent ?? null,
      aiSystemId: ctx.aiSystemId,
      provider: "chatgpt",
      model: ctx.model,
      requestId: ctx.requestId,
      userEmail: ctx.userEmail,
      department: ctx.department,
      declaredServers: ctx.declaredServers ?? [],
      toolUses,
    });
  } catch (err) {
    console.error("Failed to extract OpenAI stream usage:", err);
  }
}
