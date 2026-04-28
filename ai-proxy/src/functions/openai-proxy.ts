import { app, HttpRequest, HttpResponseInit } from "@azure/functions";
import { Readable, PassThrough } from "stream";
import { calculateCost } from "../lib/pricing";
import { logPolicyDenial, logUsage } from "../lib/db";
import { extractOpenAIStreamUsage } from "../lib/stream-parser";
import {
  loadEnforcementMode,
  loadPoliciesForSystem,
} from "../lib/policy-loader";
import { evaluateRequest, extractPromptText } from "../lib/policy-enforcement";

const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";

async function openaiProxy(req: HttpRequest): Promise<HttpResponseInit> {
  // Auth
  const proxyKey = req.headers.get("x-proxy-key");
  const proxySecret = process.env.PROXY_SECRET;

  if (!proxySecret) {
    return { status: 500, jsonBody: { error: "PROXY_SECRET not configured" } };
  }
  if (proxyKey !== proxySecret) {
    return { status: 401, jsonBody: { error: "Invalid x-proxy-key" } };
  }

  // OpenAI key from Authorization header
  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return { status: 400, jsonBody: { error: "Missing Authorization: Bearer <key> header" } };
  }

  const department = req.headers.get("x-department") ?? null;
  const userEmail = req.headers.get("x-user-email") ?? null;
  const aiSystemId = req.headers.get("x-ai-system-id") ?? null;

  let bodyText: string;
  let bodyJson: Record<string, unknown>;
  try {
    bodyText = await req.text();
    bodyJson = JSON.parse(bodyText);
  } catch {
    return { status: 400, jsonBody: { error: "Invalid JSON body" } };
  }

  const model = (bodyJson.model as string) ?? "unknown";
  const isStreaming = bodyJson.stream === true;
  const startTime = Date.now();

  // ── Policy enforcement gate ── see anthropic-proxy.ts for mode semantics.
  if (aiSystemId) {
    const mode = await loadEnforcementMode();
    if (mode !== "off") {
      const policies = await loadPoliciesForSystem(aiSystemId);
      if (policies.length) {
        const evaluation = await evaluateRequest({
          policies,
          aiSystemId,
          model,
          bodyJson,
        });

        if (evaluation.decision === "deny") {
          const promptExcerpt = extractPromptText(bodyJson).slice(0, 1000);
          const policyIds = Array.from(
            new Set(evaluation.violations.map((v) => v.policyId))
          );

          void logPolicyDenial({
            provider: "chatgpt",
            model,
            aiSystemId,
            userEmail,
            department,
            mode: mode === "enforce" ? "enforced" : "dryrun",
            policyIds,
            reasons: evaluation.violations,
            promptExcerpt: promptExcerpt || null,
            requestMetadata: { isStreaming },
          }).catch((err) => {
            console.error("logPolicyDenial failed:", err);
          });

          if (mode === "enforce") {
            return {
              status: 403,
              jsonBody: {
                error: {
                  type: "policy_denied",
                  message:
                    "Request blocked by governance policy. See `violations` for details.",
                  violations: evaluation.violations.map((v) => ({
                    rule: v.ruleKey,
                    message: v.message,
                    policy: v.policyName,
                  })),
                },
              },
            };
          }
        }
      }
    }
  }

  let openaiRes: Response;
  try {
    openaiRes = await fetch(OPENAI_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: authHeader,
      },
      body: bodyText,
    });
  } catch (err) {
    logUsage({
      provider: "chatgpt",
      model,
      department,
      userEmail,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      cost: 0,
      flagged: true,
      flagCategory: "proxy_error",
      flagReason: `Proxy error: ${err instanceof Error ? err.message : "Network error"}`,
      metadata: { aiSystemId },
    });
    return { status: 502, jsonBody: { error: "Failed to reach OpenAI API" } };
  }

  const latencyMs = Date.now() - startTime;

  // ── Streaming ──
  if (isStreaming && openaiRes.body) {
    const nodeStream = Readable.fromWeb(
      openaiRes.body as unknown as ReadableStream<Uint8Array>
    );
    const clientPass = new PassThrough();
    const logPass = new PassThrough();

    nodeStream.pipe(clientPass);
    nodeStream.pipe(logPass);

    extractOpenAIStreamUsage(logPass, {
      provider: "chatgpt",
      model,
      department,
      userEmail,
      latencyMs,
    });

    return {
      status: openaiRes.status,
      headers: {
        "Content-Type": openaiRes.headers.get("Content-Type") ?? "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
      },
      body: clientPass,
    };
  }

  // ── Non-streaming ──
  const responseBody = (await openaiRes.json()) as {
    usage?: {
      prompt_tokens?: number;
      completion_tokens?: number;
      total_tokens?: number;
    };
    error?: {
      message?: string;
    };
  };

  const usage = responseBody.usage ?? {};
  const promptTokens = usage.prompt_tokens ?? 0;
  const completionTokens = usage.completion_tokens ?? 0;
  const totalTokens = usage.total_tokens ?? promptTokens + completionTokens;
  const cost = calculateCost("chatgpt", model, promptTokens, completionTokens);

  let flagged = false;
  let flagCategory: "upstream_error" | null = null;
  let flagReason: string | null = null;
  if (!openaiRes.ok) {
    flagged = true;
    flagCategory = "upstream_error";
    flagReason = `API error: ${openaiRes.status} ${responseBody.error?.message ?? ""}`;
  }

  logUsage({
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
    metadata: { aiSystemId, latencyMs, status: openaiRes.status },
  });

  return {
    status: openaiRes.status,
    jsonBody: responseBody,
  };
}

app.http("openai-proxy", {
  methods: ["POST"],
  authLevel: "anonymous",
  route: "proxy/openai",
  handler: openaiProxy,
});
