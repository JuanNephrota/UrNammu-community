import { NextRequest, NextResponse } from "next/server";
import { prisma } from "./prisma";
import { getSetting } from "./settings";

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
 * @param req - The incoming request
 * @param subpath - The path after /api/proxy/anthropic (e.g. "/v1/messages")
 */
export async function handleAnthropicProxy(
  req: NextRequest,
  subpath: string
): Promise<NextResponse> {
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

  // Build the target URL
  const targetUrl = `${ANTHROPIC_BASE}${subpath}`;

  // Forward headers (pass through anthropic-specific headers)
  const forwardHeaders: Record<string, string> = {
    "Content-Type": "application/json",
    "x-api-key": apiKey,
    "anthropic-version":
      req.headers.get("anthropic-version") ?? "2023-06-01",
  };

  // Pass through anthropic-beta header if present
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
    // Not JSON or empty body — that's fine for some endpoints
  }

  const model = bodyJson?.model as string ?? "unknown";
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
    await logUsage({
      provider: "claude",
      model,
      department,
      userEmail,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      cost: 0,
      flagged: true,
      flagReason: `Proxy error: ${err instanceof Error ? err.message : "Network error"}`,
    });

    return NextResponse.json(
      { error: "Failed to reach Anthropic API" },
      { status: 502 }
    );
  }

  const latencyMs = Date.now() - startTime;

  // For non-messages endpoints, just pass through without logging
  if (!subpath.includes("/messages")) {
    const responseBody = await anthropicResponse.text();
    return new NextResponse(responseBody, {
      status: anthropicResponse.status,
      headers: { "Content-Type": anthropicResponse.headers.get("Content-Type") ?? "application/json" },
    });
  }

  // Parse message response for usage logging
  const responseBody = await anthropicResponse.json();

  const usage = responseBody.usage ?? {};
  const promptTokens = usage.input_tokens ?? 0;
  const completionTokens = usage.output_tokens ?? 0;
  const totalTokens = promptTokens + completionTokens;
  const cost = calculateCost(model, promptTokens, completionTokens);

  let flagged = false;
  let flagReason: string | null = null;

  if (!anthropicResponse.ok) {
    flagged = true;
    flagReason = `API error: ${anthropicResponse.status} ${responseBody.error?.message ?? ""}`;
  }

  // Log usage (non-blocking)
  logUsage({
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
    metadata: { latencyMs, status: anthropicResponse.status, path: subpath },
  });

  return NextResponse.json(responseBody, {
    status: anthropicResponse.status,
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
