import { NextRequest, NextResponse } from "next/server";
import { prisma } from "./prisma";
import { getSetting } from "./settings";
import { analyzePromptRisk, createPromptRiskAlert } from "./prompt-risk";

const ANTHROPIC_BASE = "https://api.anthropic.com";

// Pricing per million tokens (approximate)
const PRICING: Record<string, { input: number; output: number }> = {
  "claude-sonnet-4-20250514": { input: 3.0, output: 15.0 },
  "claude-haiku-4-5-20251001": { input: 0.8, output: 4.0 },
  "claude-opus-4-20250514": { input: 15.0, output: 75.0 },
};

function calculateCost(
  model: string,
  inputTokens: number,
  outputTokens: number
): number {
  const pricing = Object.entries(PRICING).find(
    ([key]) => model.includes(key) || key.includes(model)
  )?.[1] ?? { input: 3.0, output: 15.0 };

  return (
    (inputTokens / 1_000_000) * pricing.input +
    (outputTokens / 1_000_000) * pricing.output
  );
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
  const proxyKey = req.headers.get("x-proxy-key");
  const proxySecret =
    (await getSetting("proxy_secret")) ?? process.env.PROXY_SECRET;

  if (!proxySecret) {
    return NextResponse.json(
      { error: "Proxy not configured. Set PROXY_SECRET env var or configure in Settings." },
      { status: 500 }
    );
  }

  if (proxyKey !== proxySecret) {
    return NextResponse.json(
      { error: "Invalid x-proxy-key header" },
      { status: 401 }
    );
  }

  // Get the Anthropic API key
  const apiKey =
    req.headers.get("x-api-key") ?? process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    return NextResponse.json(
      { error: "No Anthropic API key. Pass x-api-key header or set ANTHROPIC_API_KEY." },
      { status: 400 }
    );
  }

  // Tracking metadata
  const department = req.headers.get("x-department") ?? null;
  const userEmail = req.headers.get("x-user-email") ?? null;
  const requestedSystemId = req.headers.get("x-ai-system-id");
  const linkedSystem = requestedSystemId
    ? await prisma.aISystem.findUnique({
        where: { id: requestedSystemId },
        select: { id: true },
      })
    : null;

  // Build the target URL
  const targetUrl = `${ANTHROPIC_BASE}${subpath}`;

  // Forward headers
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

  // Read request body
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

  const model = (bodyJson?.model as string) ?? "unknown";
  const promptRisk = analyzePromptRisk(bodyJson);
  const isStreaming = bodyJson?.stream === true;
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
      flagReason:
        promptRisk.flagReason ??
        `Proxy error: ${err instanceof Error ? err.message : "Network error"}`,
      metadata: {
        promptRisk: promptRisk.flagged
          ? {
              severity: promptRisk.severity,
              categories: promptRisk.categories,
              matchedSignals: promptRisk.matchedSignals,
              excerpt: promptRisk.excerpt,
            }
          : undefined,
        aiSystemId: linkedSystem?.id ?? null,
      },
    });

    if (promptRisk.flagged) {
      await createPromptRiskAlert({
        provider: "claude",
        model,
        department,
        userEmail,
        aiSystemId: linkedSystem?.id ?? null,
        analysis: promptRisk,
      });
    }

    return NextResponse.json(
      { error: "Failed to reach Anthropic API" },
      { status: 502 }
    );
  }

  const latencyMs = Date.now() - startTime;

  // For non-messages endpoints, pass through directly
  if (!subpath.includes("/messages")) {
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

    // Extract usage from the log stream in the background (non-blocking)
    extractStreamUsage(logStream, {
      model,
      department,
      userEmail,
      latencyMs,
      subpath,
      aiSystemId: linkedSystem?.id ?? null,
      promptRisk,
    });

    if (promptRisk.flagged) {
      await createPromptRiskAlert({
        provider: "claude",
        model,
        department,
        userEmail,
        aiSystemId: linkedSystem?.id ?? null,
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

  const usage = responseBody.usage ?? {};
  const promptTokens = usage.input_tokens ?? 0;
  const completionTokens = usage.output_tokens ?? 0;
  const totalTokens = promptTokens + completionTokens;
  const cost = calculateCost(model, promptTokens, completionTokens);

  let flagged = promptRisk.flagged;
  let flagReason: string | null = promptRisk.flagReason;

  if (!anthropicResponse.ok) {
    flagged = true;
    const apiError = `API error: ${anthropicResponse.status} ${responseBody.error?.message ?? ""}`.trim();
    flagReason = flagReason ? `${flagReason}; ${apiError}` : apiError;
  }

  await logUsage({
    provider: "claude",
    model,
    department,
    userEmail,
    promptTokens,
    completionTokens,
    totalTokens,
    cost,
    flagged,
    flagReason,
    metadata: {
      latencyMs,
      status: anthropicResponse.status,
      path: subpath,
      aiSystemId: linkedSystem?.id ?? null,
      promptRisk: promptRisk.flagged
        ? {
            severity: promptRisk.severity,
            categories: promptRisk.categories,
            matchedSignals: promptRisk.matchedSignals,
            excerpt: promptRisk.excerpt,
          }
        : undefined,
    },
  });

  if (promptRisk.flagged) {
    await createPromptRiskAlert({
      provider: "claude",
      model,
      department,
      userEmail,
      aiSystemId: linkedSystem?.id ?? null,
      analysis: promptRisk,
    });
  }

  return NextResponse.json(responseBody, {
    status: anthropicResponse.status,
  });
}

/**
 * Read a stream to extract usage info from the message_delta event,
 * then log it. The stream is consumed and discarded.
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
    promptRisk: ReturnType<typeof analyzePromptRisk>;
  }
) {
  try {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let inputTokens = 0;
    let outputTokens = 0;

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

          // message_start contains input token count
          if (event.type === "message_start" && event.message?.usage) {
            inputTokens = event.message.usage.input_tokens ?? 0;
          }

          // message_delta contains output token count
          if (event.type === "message_delta" && event.usage) {
            outputTokens = event.usage.output_tokens ?? 0;
          }
        } catch {
          // skip non-JSON lines
        }
      }
    }

    const totalTokens = inputTokens + outputTokens;
    const cost = calculateCost(ctx.model, inputTokens, outputTokens);

    if (totalTokens > 0) {
      logUsage({
        provider: "claude",
        model: ctx.model,
        department: ctx.department,
        userEmail: ctx.userEmail,
        promptTokens: inputTokens,
        completionTokens: outputTokens,
        totalTokens,
        cost,
        flagged: ctx.promptRisk.flagged,
        flagReason: ctx.promptRisk.flagReason,
        metadata: {
          latencyMs: ctx.latencyMs,
          streaming: true,
          path: ctx.subpath,
          aiSystemId: ctx.aiSystemId,
          promptRisk: ctx.promptRisk.flagged
            ? {
                severity: ctx.promptRisk.severity,
                categories: ctx.promptRisk.categories,
                matchedSignals: ctx.promptRisk.matchedSignals,
                excerpt: ctx.promptRisk.excerpt,
              }
            : undefined,
        },
      });
    }
  } catch (err) {
    console.error("Failed to extract stream usage:", err);
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
  cost: number;
  flagged: boolean;
  flagReason?: string | null;
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

    await prisma.aPIUsageLog.create({
      data: {
        provider: params.provider,
        model: params.model,
        department: params.department,
        userId,
        promptTokens: params.promptTokens,
        completionTokens: params.completionTokens,
        totalTokens: params.totalTokens,
        cost: params.cost,
        flagged: params.flagged,
        flagReason: params.flagReason,
        promptMetadata: params.metadata
          ? JSON.parse(JSON.stringify(params.metadata))
          : undefined,
      },
    });
  } catch (err) {
    console.error("Failed to log API usage:", err);
  }
}
