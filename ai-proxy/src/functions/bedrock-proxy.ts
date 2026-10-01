import { app, HttpRequest, HttpResponseInit } from "@azure/functions";
import { Readable, PassThrough } from "stream";
import {
  accountTokens,
  calculateCost,
  normalizeModelId,
  usageFromAnthropic,
  usageMetadata,
  type AnthropicUsagePayload,
} from "../lib/pricing";
import { logUsage } from "../lib/db";
import { computePromptHash, extractUserPromptText } from "../lib/prompt-hash";
import { loadPromptHashSalt } from "../lib/prompt-hash-salt";
import { extractBedrockStreamUsage } from "../lib/stream-parser";
import { scanResponseForSensitiveInfo } from "../lib/sensitive-detect";
import { recordToolActivity } from "../lib/tool-activity";
import { extractAnthropicToolUses, summarizeMcpForMetadata } from "../lib/mcp-tool-governance";
import {
  bedrockRuntimeHost,
  canonicalizeRequest,
  isValidAwsRegion,
  parseBedrockPath,
  parseSigV4Authorization,
  policyViewOf,
  selectBedrockForwardHeaders,
  isCanonicalProxyPath,
} from "../lib/proxy-providers";
import {
  authenticate,
  passthroughMeta,
  resolveAttribution,
  runPolicyGate,
  subpathOf,
} from "../lib/proxy-gate";

/**
 * Amazon Bedrock proxy (v1: log only, no credential injection).
 *
 * Forwards `/model/{modelId}/invoke` and `/invoke-with-response-stream` (the
 * Anthropic Messages API on Bedrock) to `bedrock-runtime.{region}.amazonaws.com`
 * with the client's own AWS credentials: a Bedrock API key
 * (`Authorization: Bearer …`) or a SigV4-signed request, which is forwarded
 * byte-for-byte with every header the client signed. The region comes from
 * `x-aws-region`, else the SigV4 credential scope, else BEDROCK_REGION /
 * AWS_REGION. Model ids are normalised so pricing resolves.
 */
const PROVIDER = "bedrock";

async function bedrockProxy(req: HttpRequest): Promise<HttpResponseInit> {
  const authError = authenticate(req);
  if (authError) return authError;

  const authorization = req.headers.get("authorization");
  const sigv4 = parseSigV4Authorization(authorization);
  const isBearer = !!authorization?.startsWith("Bearer ");
  if (!sigv4 && !isBearer) {
    return {
      status: 400,
      jsonBody: {
        error:
          "Missing AWS credentials. Send Authorization: Bearer <Bedrock API key>, or a SigV4-signed request (AWS4-HMAC-SHA256).",
      },
    };
  }
  const region =
    req.headers.get("x-aws-region") ??
    sigv4?.region ??
    process.env.BEDROCK_REGION ??
    process.env.AWS_REGION ??
    null;
  const host = isValidAwsRegion(region) ? bedrockRuntimeHost(region) : null;
  if (!host) {
    return {
      status: 400,
      jsonBody: { error: "Unknown AWS region. Send x-aws-region (e.g. us-east-1) or sign the request for a region." },
    };
  }

  const url = new URL(req.url);
  const subpath = subpathOf(req, "/");
  if (!isCanonicalProxyPath(subpath)) {
    return { status: 400, jsonBody: { error: "Invalid proxy path" } };
  }
  const parsed = parseBedrockPath(subpath);
  const targetUrl = `https://${host}${parsed.path}${url.search}`;
  const rawModelId = parsed.modelId;
  const model = rawModelId ? normalizeModelId(rawModelId) : "unknown";

  const { attribution, response: attributionError } = await resolveAttribution(req);
  if (attributionError) return attributionError;
  const { department, userEmail, aiSystemId, agent, client } = attribution;

  // The body must reach Bedrock byte-for-byte (SigV4 covers its hash).
  const rawBody = req.method === "GET" || req.method === "HEAD" ? null : Buffer.from(await req.arrayBuffer());
  let bodyJson: Record<string, unknown> | null = null;
  if (rawBody && rawBody.length > 0) {
    try {
      const value: unknown = JSON.parse(rawBody.toString("utf8"));
      if (value && typeof value === "object" && !Array.isArray(value)) {
        bodyJson = value as Record<string, unknown>;
      }
    } catch {
      // not JSON
    }
  }
  const forwardHeaders = selectBedrockForwardHeaders(req.headers, sigv4?.signedHeaders ?? []);
  const isMessages =
    (parsed.operation === "invoke" || parsed.operation === "invoke-with-response-stream") && !!bodyJson;
  const isStreaming = parsed.operation === "invoke-with-response-stream";
  const baseMeta = {
    path: parsed.path,
    endpoint: parsed.operation,
    region,
    bedrockModelId: rawModelId,
    authMode: sigv4 ? "sigv4" : "bearer",
    aiSystemId,
    agentId: agent?.id ?? null,
    client,
  };

  const canonical = { ...canonicalizeRequest("anthropic", bodyJson), model };
  const policyBody = isMessages ? policyViewOf(canonical) : bodyJson;
  // Cross-surface correlation hash of the user-authored prompt (never the
  // prompt itself) — see anthropic-proxy.ts. The Bedrock body is the Anthropic
  // Messages shape, so the same prompt hashes identically on either route.
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
      requestMetadata: { endpoint: parsed.operation, path: parsed.path, region },
    });
    if (denied) return denied;
  }

  const startTime = Date.now();
  let upstream: Response;
  try {
    upstream = await fetch(targetUrl, {
      method: req.method,
      headers: forwardHeaders,
      body: rawBody && rawBody.length > 0 ? rawBody : undefined,
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
    return { status: 502, jsonBody: { error: "Failed to reach Amazon Bedrock" } };
  }

  const latencyMs = Date.now() - startTime;
  const contentType = upstream.headers.get("content-type") ?? "application/json";
  const requestId = upstream.headers.get("x-amzn-requestid") ?? upstream.headers.get("x-amzn-request-id");
  const responseHeaders: Record<string, string> = { "Content-Type": contentType };
  for (const name of ["x-amzn-requestid", "x-amzn-bedrock-input-token-count", "x-amzn-bedrock-output-token-count"]) {
    const value = upstream.headers.get(name);
    if (value) responseHeaders[name] = value;
  }

  if (!isMessages) {
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
    return { status: upstream.status, headers: responseHeaders, body: responseText };
  }

  if (isStreaming && upstream.ok && upstream.body) {
    const nodeStream = Readable.fromWeb(upstream.body as unknown as ReadableStream<Uint8Array>);
    const clientPass = new PassThrough();
    const logPass = new PassThrough();
    nodeStream.pipe(clientPass);
    nodeStream.pipe(logPass);
    void extractBedrockStreamUsage(logPass, {
      provider: PROVIDER,
      pricingProvider: PROVIDER,
      model,
      department,
      userEmail,
      latencyMs,
      aiSystemId,
      requestId,
      agent,
      promptHash,
      baseMeta,
    }).catch((err: unknown) => {
      console.error("extractBedrockStreamUsage failed:", err);
    });
    return {
      status: upstream.status,
      headers: { ...responseHeaders, "Cache-Control": "no-cache", Connection: "keep-alive" },
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

  const tokenUsage = usageFromAnthropic(responseBody?.usage as AnthropicUsagePayload | undefined);
  const accounted = accountTokens(tokenUsage);
  const pricing = calculateCost(PROVIDER, model, tokenUsage);
  const toolUses = upstream.ok ? extractAnthropicToolUses(responseBody?.content) : [];

  let flagged = false;
  let flagCategory: "upstream_error" | "sensitive_response" | null = null;
  let flagReason: string | null = null;
  if (upstream.ok) {
    const text = Array.isArray(responseBody?.content)
      ? (responseBody!.content as Array<{ type?: string; text?: string }>)
          .filter((b) => b?.type === "text" && typeof b.text === "string")
          .map((b) => b.text as string)
          .join("\n")
      : "";
    const dlp = await scanResponseForSensitiveInfo({ provider: PROVIDER, model, aiSystemId, responseText: text });
    if (dlp.flagged) {
      flagged = true;
      flagCategory = "sensitive_response";
      flagReason = dlp.summary;
    }
  } else {
    flagged = true;
    flagCategory = "upstream_error";
    const message =
      (responseBody?.message as string | undefined) ??
      (responseBody?.error as { message?: string } | undefined)?.message ??
      "";
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

  return { status: upstream.status, headers: responseHeaders, body: responseText };
}

app.http("bedrock-proxy", {
  methods: ["POST"],
  authLevel: "anonymous",
  route: "proxy/bedrock/{*path}",
  handler: bedrockProxy,
});
