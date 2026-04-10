import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSetting } from "@/lib/settings";

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

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const model = (body.model as string) ?? "unknown";
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
      flagReason: `Proxy error: ${err instanceof Error ? err.message : "Network error"}`,
    });

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

  let flagged = false;
  let flagReason: string | null = null;

  if (!openaiResponse.ok) {
    flagged = true;
    flagReason = `API error: ${openaiResponse.status} ${responseBody.error?.message ?? ""}`;
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
    flagReason,
    metadata: { latencyMs, status: openaiResponse.status },
  });

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
