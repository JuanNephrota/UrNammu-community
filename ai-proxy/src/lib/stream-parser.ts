import { Readable } from "stream";
import { calculateCost } from "./pricing";
import { logUsage } from "./db";
import { scanResponseForSensitiveInfo } from "./sensitive-detect";

interface StreamContext {
  provider: "claude" | "chatgpt";
  model: string;
  department: string | null;
  userEmail: string | null;
  latencyMs: number;
  aiSystemId: string | null;
}

/**
 * Parse an Anthropic SSE stream to extract usage from
 * message_start (input_tokens) and message_delta (output_tokens) events.
 */
export async function extractAnthropicStreamUsage(
  stream: Readable,
  ctx: StreamContext
): Promise<void> {
  try {
    let buffer = "";
    let inputTokens = 0;
    let outputTokens = 0;
    const responseTextParts: string[] = [];

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

          if (event.type === "message_start" && event.message?.usage) {
            inputTokens = event.message.usage.input_tokens ?? 0;
          }
          if (event.type === "message_delta" && event.usage) {
            outputTokens = event.usage.output_tokens ?? 0;
          }
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

    const totalTokens = inputTokens + outputTokens;
    if (totalTokens > 0) {
      const cost = calculateCost("claude", ctx.model, inputTokens, outputTokens);
      await logUsage({
        provider: "claude",
        model: ctx.model,
        department: ctx.department,
        userEmail: ctx.userEmail,
        promptTokens: inputTokens,
        completionTokens: outputTokens,
        totalTokens,
        cost,
        flagged: !!dlp?.flagged,
        flagCategory: dlp?.flagged ? "sensitive_response" : null,
        flagReason: dlp?.flagged ? dlp.summary : null,
        metadata: { latencyMs: ctx.latencyMs, streaming: true, aiSystemId: ctx.aiSystemId },
      });
    }
  } catch (err) {
    console.error("Failed to extract Anthropic stream usage:", err);
  }
}

/**
 * Parse an OpenAI SSE stream to extract usage from the final chunk.
 * OpenAI includes usage in the last `data:` event when `stream_options.include_usage` is set,
 * or we count from `choices[].delta.content` length as a fallback.
 */
export async function extractOpenAIStreamUsage(
  stream: Readable,
  ctx: StreamContext
): Promise<void> {
  try {
    let buffer = "";
    let inputTokens = 0;
    let outputTokens = 0;
    const responseTextParts: string[] = [];

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
          if (event.usage) {
            inputTokens = event.usage.prompt_tokens ?? 0;
            outputTokens = event.usage.completion_tokens ?? 0;
          }
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

    const totalTokens = inputTokens + outputTokens;
    if (totalTokens > 0) {
      const cost = calculateCost("chatgpt", ctx.model, inputTokens, outputTokens);
      await logUsage({
        provider: "chatgpt",
        model: ctx.model,
        department: ctx.department,
        userEmail: ctx.userEmail,
        promptTokens: inputTokens,
        completionTokens: outputTokens,
        totalTokens,
        cost,
        flagged: !!dlp?.flagged,
        flagCategory: dlp?.flagged ? "sensitive_response" : null,
        flagReason: dlp?.flagged ? dlp.summary : null,
        metadata: { latencyMs: ctx.latencyMs, streaming: true, aiSystemId: ctx.aiSystemId },
      });
    }
  } catch (err) {
    console.error("Failed to extract OpenAI stream usage:", err);
  }
}
