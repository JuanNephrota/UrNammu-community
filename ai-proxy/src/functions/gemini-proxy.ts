import { app, HttpRequest, HttpResponseInit } from "@azure/functions";
import { Readable, PassThrough } from "stream";
import {
  accountTokens,
  calculateCost,
  usageFromGemini,
  usageMetadata,
  type GeminiUsageMetadata,
} from "../lib/pricing";
import { logUsage } from "../lib/db";
import { computePromptHash, extractUserPromptText } from "../lib/prompt-hash";
import { loadPromptHashSalt } from "../lib/prompt-hash-salt";
import { extractGeminiStreamUsage } from "../lib/stream-parser";
import { scanResponseForSensitiveInfo } from "../lib/sensitive-detect";
import { recordToolActivity } from "../lib/tool-activity";
import { summarizeMcpForMetadata } from "../lib/mcp-tool-governance";
import {
  canonicalizeRequest,
  extractGeminiResponseText,
  extractGeminiToolUses,
  isGeminiSseStream,
  parseGeminiPath,
  policyViewOf,
} from "../lib/proxy-providers";
import {
  authenticate,
  passthroughMeta,
  readJsonBody,
  resolveAttribution,
  runPolicyGate,
  subpathOf,
} from "../lib/proxy-gate";

/**
 * Gemini Developer API proxy. Point the SDK's base URL at
 * `https://<function-app>.azurewebsites.net/api/proxy/gemini` and keep the
 * `x-goog-api-key` header. Usage is read for `:generateContent` and
 * `:streamGenerateContent` (`usageMetadata`); other methods pass through.
 */
const GEMINI_BASE = "https://generativelanguage.googleapis.com";
const PROVIDER = "gemini";

async function geminiProxy(req: HttpRequest): Promise<HttpResponseInit> {
  const authError = authenticate(req);
  if (authError) return authError;

  const url = new URL(req.url);
  const search = url.search;
  const apiKey = req.headers.get("x-goog-api-key");
  const bearer = req.headers.get("authorization");
  if (!apiKey && !url.searchParams.has("key") && !bearer?.startsWith("Bearer ")) {
    return {
      status: 400,
      jsonBody: { error: "Missing x-goog-api-key header (or Authorization: Bearer <token>)" },
    };
  }
  const forwardHeaders: Record<string, string> = {
    "Content-Type": req.headers.get("content-type") ?? "application/json",
  };
  if (apiKey) forwardHeaders["x-goog-api-key"] = apiKey;
  if (bearer?.startsWith("Bearer ")) forwardHeaders.Authorization = bearer;
  const clientHeader = req.headers.get("x-goog-api-client");
  if (clientHeader) forwardHeaders["x-goog-api-client"] = clientHeader;

  const parsed = parseGeminiPath(subpathOf(req, "/"));
  const targetUrl = `${GEMINI_BASE}${parsed.path}${search}`;
  const model = parsed.model ?? "unknown";

  const { attribution, response: attributionError } = await resolveAttribution(req);
  if (attributionError) return attributionError;
  const { department, userEmail, aiSystemId, agent } = attribution;

  const { bodyText, bodyJson } = await readJsonBody(req);
  const isGeneration =
    (parsed.method === "generateContent" || parsed.method === "streamGenerateContent") && !!bodyJson;
  const isStreaming = parsed.method === "streamGenerateContent";
  const baseMeta = { path: parsed.path, endpoint: parsed.method, aiSystemId, agentId: agent?.id ?? null };

  const canonical = { ...canonicalizeRequest("gemini", bodyJson), model };
  const policyBody = isGeneration ? policyViewOf(canonical) : bodyJson;
  // Cross-surface correlation hash of the user-authored prompt (never the
  // prompt itself) — see anthropic-proxy.ts. Computed from the canonical view,
  // so a Gemini `contents` body hashes like the same prompt sent elsewhere.
  const promptHash = computePromptHash(await loadPromptHashSalt(), extractUserPromptText(policyBody));
  if (policyBody) {
    const denied = await runPolicyGate({
      provider: PROVIDER,
      model,
      aiSystemId,
      userEmail,
      department,
      policyBody,
      isStreaming,
      requestMetadata: { endpoint: parsed.method, path: parsed.path },
    });
    if (denied) return denied;
  }

  const startTime = Date.now();
  let upstream: Response;
  try {
    upstream = await fetch(targetUrl, {
      method: req.method,
      headers: forwardHeaders,
      body: bodyText || undefined,
    });
  } catch (err) {
    await logUsage({
      provider: PROVIDER,
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
      metadata: { ...baseMeta, promptHash },
    }).catch((logErr) => console.error("logUsage failed:", logErr));
    return { status: 502, jsonBody: { error: "Failed to reach Gemini API" } };
  }

  const latencyMs = Date.now() - startTime;
  const contentType = upstream.headers.get("content-type") ?? "application/json";
  const requestId = upstream.headers.get("x-request-id") ?? upstream.headers.get("x-goog-request-id");

  if (!isGeneration) {
    const responseText = await upstream.text();
    await logUsage({
      provider: PROVIDER,
      model,
      department,
      userEmail,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      cost: 0,
      flagged: !upstream.ok,
      flagCategory: upstream.ok ? null : "upstream_error",
      flagReason: upstream.ok ? null : `API error: ${upstream.status}`,
      requestId,
      metadata: { ...passthroughMeta({ baseMeta, method: req.method, status: upstream.status, latencyMs }), promptHash },
    }).catch((err) => console.error("logUsage failed:", err));
    return { status: upstream.status, headers: { "Content-Type": contentType }, body: responseText };
  }

  if (isStreaming && upstream.ok && upstream.body) {
    const nodeStream = Readable.fromWeb(upstream.body as unknown as ReadableStream<Uint8Array>);
    const clientPass = new PassThrough();
    const logPass = new PassThrough();
    nodeStream.pipe(clientPass);
    nodeStream.pipe(logPass);
    void extractGeminiStreamUsage(logPass, {
      provider: PROVIDER,
      pricingProvider: PROVIDER,
      model,
      department,
      userEmail,
      latencyMs,
      aiSystemId,
      requestId,
      agent,
      sse: isGeminiSseStream(search) || contentType.includes("text/event-stream"),
      promptHash,
      baseMeta,
    }).catch((err: unknown) => {
      console.error("extractGeminiStreamUsage failed:", err);
    });
    return {
      status: upstream.status,
      headers: { "Content-Type": contentType, "Cache-Control": "no-cache", Connection: "keep-alive" },
      body: clientPass,
    };
  }

  const responseText = await upstream.text();
  let responseBody: Record<string, unknown> | null = null;
  try {
    const value: unknown = JSON.parse(responseText);
    if (value && typeof value === "object" && !Array.isArray(value)) {
      responseBody = value as Record<string, unknown>;
    }
  } catch {
    // non-JSON upstream body
  }

  const tokenUsage = usageFromGemini(responseBody?.usageMetadata as GeminiUsageMetadata | undefined);
  const accounted = accountTokens(tokenUsage);
  const pricing = calculateCost(PROVIDER, model, tokenUsage);
  const toolUses = upstream.ok ? extractGeminiToolUses(responseBody) : [];

  let flagged = false;
  let flagCategory: "upstream_error" | "sensitive_response" | null = null;
  let flagReason: string | null = null;
  if (upstream.ok) {
    const dlp = await scanResponseForSensitiveInfo({
      provider: PROVIDER,
      model,
      aiSystemId,
      responseText: extractGeminiResponseText(responseBody),
    });
    if (dlp.flagged) {
      flagged = true;
      flagCategory = "sensitive_response";
      flagReason = dlp.summary;
    }
  } else {
    flagged = true;
    flagCategory = "upstream_error";
    const message = (responseBody?.error as { message?: string } | undefined)?.message ?? "";
    flagReason = `API error: ${upstream.status} ${message}`.trim();
  }

  await logUsage({
    provider: PROVIDER,
    model,
    department,
    userEmail,
    promptTokens: accounted.promptTokens,
    completionTokens: accounted.completionTokens,
    totalTokens: accounted.totalTokens,
    cacheReadTokens: accounted.cacheReadTokens,
    cacheCreationTokens: accounted.cacheCreationTokens,
    cost: pricing.cost ?? 0,
    flagged,
    flagCategory,
    flagReason,
    requestId,
    metadata: {
      ...baseMeta,
      latencyMs,
      status: upstream.status,
      promptHash,
      ...usageMetadata(tokenUsage, pricing),
      mcp: toolUses.length > 0 ? summarizeMcpForMetadata([], toolUses) : undefined,
    },
  }).catch((err) => console.error("logUsage failed:", err));

  await recordToolActivity({
    agent,
    aiSystemId,
    provider: PROVIDER,
    model,
    requestId,
    userEmail,
    department,
    declaredServers: [],
    toolUses,
  });

  return { status: upstream.status, headers: { "Content-Type": contentType }, body: responseText };
}

app.http("gemini-proxy", {
  methods: ["GET", "POST"],
  authLevel: "anonymous",
  route: "proxy/gemini/{*path}",
  handler: geminiProxy,
});
