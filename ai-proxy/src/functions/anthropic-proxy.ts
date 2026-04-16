import { app, HttpRequest, HttpResponseInit } from "@azure/functions";
import { Readable, PassThrough } from "stream";
import { calculateCost } from "../lib/pricing";
import { logPolicyDenial, logUsage } from "../lib/db";
import { extractAnthropicStreamUsage } from "../lib/stream-parser";
import { applyMcpPassthrough } from "../lib/mcp-passthrough";
import {
  loadEnforcementMode,
  loadPoliciesForSystem,
} from "../lib/policy-loader";
import { evaluateRequest, extractPromptText } from "../lib/policy-enforcement";

const ANTHROPIC_BASE = "https://api.anthropic.com";

async function anthropicProxy(req: HttpRequest): Promise<HttpResponseInit> {
  // Auth
  const proxyKey = req.headers.get("x-proxy-key");
  const proxySecret = process.env.PROXY_SECRET;

  if (!proxySecret) {
    return { status: 500, jsonBody: { error: "PROXY_SECRET not configured" } };
  }
  if (proxyKey !== proxySecret) {
    return { status: 401, jsonBody: { error: "Invalid x-proxy-key" } };
  }

  // API key
  const apiKey = req.headers.get("x-api-key") ?? process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return { status: 400, jsonBody: { error: "No Anthropic API key" } };
  }

  // Tracking — x-ai-system-id links proxy traffic to a governed system in
  // the registry, matching the Vercel fallback proxy's behavior.
  const department = req.headers.get("x-department") ?? null;
  const userEmail = req.headers.get("x-user-email") ?? null;
  const aiSystemId = req.headers.get("x-ai-system-id") ?? null;

  // Build target URL from route params
  const url = new URL(req.url);
  const subpath = url.pathname.replace(/^\/api\/proxy\/anthropic/, "");
  const targetUrl = `${ANTHROPIC_BASE}${subpath || "/v1/messages"}`;

  // Read body first — MCP passthrough needs it.
  let bodyText: string | null = null;
  let bodyJson: Record<string, unknown> | null = null;
  try {
    bodyText = await req.text();
    if (bodyText) bodyJson = JSON.parse(bodyText);
  } catch {
    // not JSON
  }

  // Forward headers (default allow-list)
  const forwardHeaders: Record<string, string> = {
    "Content-Type": req.headers.get("Content-Type") ?? "application/json",
    "x-api-key": apiKey,
    "anthropic-version": req.headers.get("anthropic-version") ?? "2023-06-01",
  };

  const betaHeader = req.headers.get("anthropic-beta");
  if (betaHeader) {
    forwardHeaders["anthropic-beta"] = betaHeader;
  }

  // MCP passthrough: when the request involves MCP, forward `mcp-*` headers
  // and the client's `Authorization` bearer verbatim. Without this the proxy
  // strips credentials remote MCP servers need.
  const mcpResult = applyMcpPassthrough(forwardHeaders, req.headers, bodyJson);

  const model = (bodyJson?.model as string) ?? "unknown";
  const isStreaming = bodyJson?.stream === true;
  const startTime = Date.now();

  // ── Policy enforcement gate ──
  // Off: skip entirely. Dryrun: evaluate + record denials but forward.
  // Enforce: evaluate + return 403 on blocking violations.
  // No aiSystemId: nothing to evaluate against (proxy still logs usage).
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
            provider: "claude",
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
          // dryrun falls through to forwarding
        }
      }
    }
  }

  // Forward to Anthropic
  let anthropicRes: Response;
  try {
    anthropicRes = await fetch(targetUrl, {
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
      metadata: { aiSystemId },
    }).catch((logErr) => {
      console.error("logUsage failed:", logErr);
    });
    return { status: 502, jsonBody: { error: "Failed to reach Anthropic API" } };
  }

  const latencyMs = Date.now() - startTime;

  // Non-messages endpoints: pass through
  if (!subpath.includes("/messages")) {
    const body = await anthropicRes.text();
    return {
      status: anthropicRes.status,
      headers: { "Content-Type": anthropicRes.headers.get("Content-Type") ?? "application/json" },
      body,
    };
  }

  // ── Streaming ──
  if (isStreaming && anthropicRes.body) {
    const nodeStream = Readable.fromWeb(
      anthropicRes.body as unknown as ReadableStream<Uint8Array>
    );
    const clientPass = new PassThrough();
    const logPass = new PassThrough();

    nodeStream.pipe(clientPass);
    nodeStream.pipe(logPass);

    // Kick off the extractor now so it drains `logPass` in parallel with the
    // client consuming `clientPass`. We MUST attach an error handler — Azure
    // Functions has no `waitUntil`, so the promise is effectively fire-and-
    // forget and an unhandled rejection would crash the worker.
    //
    // The function host keeps this invocation alive while the response body
    // stream is open; in practice the extractor finishes at/before the client
    // stream ends. If the client disconnects mid-stream the extractor may not
    // complete — accepted limitation until telemetry moves to a queue.
    const extractPromise = extractAnthropicStreamUsage(logPass, {
      provider: "claude",
      model,
      department,
      userEmail,
      latencyMs,
    }).catch((err: unknown) => {
      console.error("extractAnthropicStreamUsage failed:", err);
    });
    // Silence "floating promise" linters while still not blocking the response.
    void extractPromise;

    return {
      status: anthropicRes.status,
      headers: {
        "Content-Type": anthropicRes.headers.get("Content-Type") ?? "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
      },
      body: clientPass,
    };
  }

  // ── Non-streaming ──
  const responseBody = (await anthropicRes.json()) as {
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
    };
    error?: {
      message?: string;
    };
  };

  const usage = responseBody.usage ?? {};
  const promptTokens = usage.input_tokens ?? 0;
  const completionTokens = usage.output_tokens ?? 0;
  const totalTokens = promptTokens + completionTokens;
  const cost = calculateCost("claude", model, promptTokens, completionTokens);

  let flagged = false;
  let flagReason: string | null = null;
  if (!anthropicRes.ok) {
    flagged = true;
    flagReason = `API error: ${anthropicRes.status} ${responseBody.error?.message ?? ""}`;
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
      aiSystemId,
      latencyMs,
      status: anthropicRes.status,
      mcp: mcpResult.detected
        ? {
            servers: mcpResult.mcpServerCount,
            forwardedHeaders: mcpResult.forwarded,
          }
        : undefined,
    },
  }).catch((err) => {
    console.error("logUsage failed:", err);
  });

  return {
    status: anthropicRes.status,
    jsonBody: responseBody,
  };
}

app.http("anthropic-proxy", {
  methods: ["GET", "POST", "PUT", "DELETE"],
  authLevel: "anonymous",
  route: "proxy/anthropic/{*path}",
  handler: anthropicProxy,
});

// Also handle root /api/proxy/anthropic (no subpath)
app.http("anthropic-proxy-root", {
  methods: ["POST"],
  authLevel: "anonymous",
  route: "proxy/anthropic",
  handler: anthropicProxy,
});
