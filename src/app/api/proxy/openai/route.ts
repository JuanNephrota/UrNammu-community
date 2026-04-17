import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSetting } from "@/lib/settings";
import { logger } from "@/lib/observability";
import { analyzePromptRisk, createPromptRiskAlert } from "@/lib/prompt-risk";
import { writeProxyUsageBucket } from "@/lib/proxy-bucket-writer";

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
 */

const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";

const PRICING: Record<string, { input: number; output: number }> = {
  "gpt-4o": { input: 2.5, output: 10.0 },
  "gpt-4o-mini": { input: 0.15, output: 0.6 },
  "gpt-4-turbo": { input: 10.0, output: 30.0 },
  "gpt-4": { input: 30.0, output: 60.0 },
  "gpt-3.5-turbo": { input: 0.5, output: 1.5 },
  "o1": { input: 15.0, output: 60.0 },
  "o1-mini": { input: 3.0, output: 12.0 },
};

function calculateCost(
  model: string,
  inputTokens: number,
  outputTokens: number
): number {
  const pricing = Object.entries(PRICING).find(([key]) =>
    model.includes(key) || key.includes(model)
  )?.[1] ?? { input: 5.0, output: 15.0 };

  return (
    (inputTokens / 1_000_000) * pricing.input +
    (outputTokens / 1_000_000) * pricing.output
  );
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

  if (proxyKey !== proxySecret) {
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

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const model = (body.model as string) ?? "unknown";
  const promptRisk = await analyzePromptRisk(body);
  const startTime = Date.now();
  let openaiResponse: Response;

  try {
    openaiResponse = await fetch(OPENAI_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: authHeader,
      },
      body: JSON.stringify(body),
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
        provider: "chatgpt",
        model,
        department,
        userEmail,
        aiSystemId: linkedSystem?.id ?? null,
        analysis: promptRisk,
      });
    }

    return NextResponse.json(
      { error: "Failed to reach OpenAI API" },
      { status: 502 }
    );
  }

  const responseBody = await openaiResponse.json();
  const latencyMs = Date.now() - startTime;

  const usage = responseBody.usage ?? {};
  const promptTokens = usage.prompt_tokens ?? 0;
  const completionTokens = usage.completion_tokens ?? 0;
  const totalTokens = usage.total_tokens ?? promptTokens + completionTokens;
  const cost = calculateCost(model, promptTokens, completionTokens);

  let flagged = promptRisk.flagged;
  let flagCategory: "upstream_error" | "prompt_risk" | null = promptRisk.flagged
    ? "prompt_risk"
    : null;
  let flagReason: string | null = promptRisk.flagReason;

  if (!openaiResponse.ok) {
    flagged = true;
    if (flagCategory === null) flagCategory = "upstream_error";
    const apiError = `API error: ${openaiResponse.status} ${responseBody.error?.message ?? ""}`.trim();
    flagReason = flagReason ? `${flagReason}; ${apiError}` : apiError;
  }

  await logUsage({
    provider: "chatgpt",
    model,
    department,
    userEmail,
    promptTokens,
    completionTokens,
    totalTokens,
    cost,
    flagged,
    flagCategory,
    flagReason,
    metadata: {
      latencyMs,
      status: openaiResponse.status,
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
      provider: "chatgpt",
      model,
      department,
      userEmail,
      aiSystemId: linkedSystem?.id ?? null,
      analysis: promptRisk,
    });
    logger.warn("openai_proxy.dangerous_prompt_detected", {
      model,
      department,
      userEmail,
      categories: promptRisk.categories,
      aiSystemId: linkedSystem?.id ?? null,
    });
  }

  // Successful upstream: return the response as-is.
  // On upstream errors, strip internal detail before returning to the caller —
  // OpenAI error bodies may include org IDs, rate-limit internals, or hints
  // about our server-side key that callers shouldn't see.
  if (!openaiResponse.ok) {
    const upstreamCode =
      typeof responseBody?.error?.code === "string"
        ? responseBody.error.code
        : null;
    const upstreamType =
      typeof responseBody?.error?.type === "string"
        ? responseBody.error.type
        : null;
    const sanitized: Record<string, unknown> = {
      error: "upstream_error",
      status: openaiResponse.status,
    };
    if (upstreamCode) sanitized.code = upstreamCode;
    if (upstreamType) sanitized.type = upstreamType;
    logger.warn("openai_proxy.upstream_error", {
      status: openaiResponse.status,
      code: upstreamCode,
      type: upstreamType,
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
  flagCategory?: "upstream_error" | "proxy_error" | "prompt_risk" | null;
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
        flagCategory: params.flagCategory ?? null,
        flagReason: params.flagReason,
        promptMetadata: params.metadata
          ? JSON.parse(JSON.stringify(params.metadata))
          : undefined,
      },
    });

    // Mirror to normalized UsageBucket/CostBucket (see proxy-bucket-writer.ts).
    if (params.totalTokens > 0) {
      const aiSystemId =
        typeof (params.metadata as Record<string, unknown> | undefined)?.aiSystemId === "string"
          ? ((params.metadata as Record<string, unknown>).aiSystemId as string)
          : null;
      await writeProxyUsageBucket({
        provider: "openai",
        model: params.model,
        userEmail: params.userEmail,
        department: params.department,
        promptTokens: params.promptTokens,
        completionTokens: params.completionTokens,
        totalTokens: params.totalTokens,
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
