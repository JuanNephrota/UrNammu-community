import { app, HttpRequest, HttpResponseInit } from "@azure/functions";
import { Readable, PassThrough } from "stream";
import { calculateCost } from "../lib/pricing";
import { logUsage } from "../lib/db";
import { extractAnthropicStreamUsage } from "../lib/stream-parser";
import { applyMcpPassthrough } from "../lib/mcp-passthrough";

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

  // Tracking
  const department = req.headers.get("x-department") ?? null;
  const userEmail = req.headers.get("x-user-email") ?? null;

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

  // Forward to Anthropic
  let anthropicRes: Response;
  try {
    anthropicRes = await fetch(targetUrl, {
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
      flagReason: `Proxy error: ${err instanceof Error ? err.message : "Network error"}`,
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

    // Extract usage in background
    extractAnthropicStreamUsage(logPass, {
      provider: "claude",
      model,
      department,
      userEmail,
      latencyMs,
    });

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
    metadata: {
      latencyMs,
      status: anthropicRes.status,
      mcp: mcpResult.detected
        ? {
            servers: mcpResult.mcpServerCount,
            forwardedHeaders: mcpResult.forwarded,
          }
        : undefined,
    },
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
