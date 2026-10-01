/**
 * OpenAI + Azure OpenAI handler shared by the `openai-proxy` and
 * `azure-openai-proxy` functions.
 *
 * Path-based: `/api/proxy/openai/{*path}` forwards any `/v1/*` path to
 * api.openai.com; `/api/proxy/azure-openai/{*path}` forwards
 * `/openai/deployments/{deployment}/…?api-version=` (and `/openai/v1/…`) to
 * the configured resource endpoint with the client's `api-key`. Usage is
 * read for chat completions, legacy completions, the Responses API and
 * Embeddings; every other endpoint passes through with a 0-token row.
 */
import { HttpRequest, HttpResponseInit } from "@azure/functions";
import { Readable, PassThrough, Transform, type TransformCallback } from "stream";
import {
  accountTokens,
  calculateCost,
  isOpenAIUsageOnlyChunk,
  usageFromOpenAI,
  usageFromOpenAIResponses,
  usageMetadata,
  type PricingProviderInput,
} from "./pricing";
import { logUsage } from "./db";
import { computePromptHash, extractUserPromptText } from "./prompt-hash";
import { loadPromptHashSalt } from "./prompt-hash-salt";
import { extractOpenAIStreamUsage, type StreamContext } from "./stream-parser";
import { scanResponseForSensitiveInfo } from "./sensitive-detect";
import {
  agentEnforcesReview,
  evaluateAgentReviewTriggers,
  recordHumanReviewMatches,
  recordToolActivity,
} from "./tool-activity";
import { humanReviewBlockedBody } from "./human-review-triggers";
import {
  collectOpenAIToolUsesFromSse,
  extractDeclaredMcpServers,
  extractOpenAIToolUses,
  summarizeMcpForMetadata,
} from "./mcp-tool-governance";
import {
  canonicalizeRequest,
  classifyAzureOpenAIPath,
  classifyOpenAIPath,
  extractOpenAIResponseText,
  normalizeAzureOpenAIEndpoint,
  parseAzureDeploymentMap,
  policyViewOf,
  resolveAzureModel,
  type OpenAIEndpoint,
  isCanonicalProxyPath,
} from "./proxy-providers";
import { loadSetting } from "./settings-loader";
import {
  authenticate,
  passthroughMeta,
  readJsonBody,
  resolveAttribution,
  runMcpServerGate,
  runPolicyGate,
  subpathOf,
} from "./proxy-gate";

const OPENAI_BASE = "https://api.openai.com";

export type OpenAIProxyFlavor = "openai" | "azure";

/** OpenAI returns `x-request-id`; Azure OpenAI returns `apim-request-id`. */
function upstreamRequestId(res: Response): string | null {
  return (
    res.headers.get("x-request-id") ??
    res.headers.get("apim-request-id") ??
    res.headers.get("request-id")
  );
}

const SSE_EVENT_BOUNDARY = /\r?\n\r?\n/;

function parseSseJson(eventText: string): unknown {
  const data: string[] = [];
  for (const line of eventText.split(/\r?\n/)) {
    if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
  }
  if (data.length === 0) return null;
  const payload = data.join("\n");
  if (payload === "[DONE]") return null;
  try {
    return JSON.parse(payload);
  } catch {
    return null;
  }
}

/** Node Transform that drops the trailing usage-only SSE chunk. */
function createUsageChunkFilter(): Transform {
  let buffer = "";
  const emit = (self: Transform, eventText: string) => {
    if (isOpenAIUsageOnlyChunk(parseSseJson(eventText))) return;
    self.push(eventText);
  };
  return new Transform({
    transform(chunk: Buffer | string, _encoding: BufferEncoding, callback: TransformCallback) {
      buffer += typeof chunk === "string" ? chunk : chunk.toString("utf8");
      let match: RegExpExecArray | null;
      while ((match = SSE_EVENT_BOUNDARY.exec(buffer)) !== null) {
        const end = match.index + match[0].length;
        emit(this, buffer.slice(0, end));
        buffer = buffer.slice(end);
      }
      callback();
    },
    flush(callback: TransformCallback) {
      if (buffer) emit(this, buffer);
      buffer = "";
      callback();
    },
  });
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function createOpenAIProxyHandler(flavor: OpenAIProxyFlavor) {
  const provider = flavor === "azure" ? "azure_openai" : "chatgpt";
  const pricingProvider: PricingProviderInput = flavor === "azure" ? "azure_openai" : "openai";
  const upstreamName = flavor === "azure" ? "Azure OpenAI" : "OpenAI";

  return async function openaiProxy(req: HttpRequest): Promise<HttpResponseInit> {
    const authError = authenticate(req);
    if (authError) return authError;

    const url = new URL(req.url);
    const search = url.search;
    const subpath = subpathOf(req, "/v1/chat/completions");
    if (!isCanonicalProxyPath(subpath)) {
      return { status: 400, jsonBody: { error: "Invalid proxy path" } };
    }

    // ── Upstream credentials + target ──
    const forwardHeaders: Record<string, string> = {
      "Content-Type": req.headers.get("content-type") ?? "application/json",
    };
    let targetBase: string;
    let path: string;
    let endpoint: OpenAIEndpoint;
    let deployment: string | null = null;
    let azureEndpoint: string | null = null;

    if (flavor === "openai") {
      const authHeader = req.headers.get("authorization");
      if (!authHeader?.startsWith("Bearer ")) {
        return { status: 400, jsonBody: { error: "Missing Authorization: Bearer <key> header" } };
      }
      forwardHeaders.Authorization = authHeader;
      for (const name of ["openai-organization", "openai-project", "openai-beta"]) {
        const value = req.headers.get(name);
        if (value) forwardHeaders[name] = value;
      }
      ({ path, endpoint } = classifyOpenAIPath(subpath));
      targetBase = OPENAI_BASE;
    } else {
      const headerResource = req.headers.get("x-azure-openai-resource");
      if (headerResource !== null) {
        azureEndpoint = normalizeAzureOpenAIEndpoint(headerResource);
        if (!azureEndpoint) {
          return {
            status: 400,
            jsonBody: {
              error:
                "Invalid x-azure-openai-resource. Send the resource name or an https://<resource>.openai.azure.com endpoint.",
            },
          };
        }
      } else {
        azureEndpoint = normalizeAzureOpenAIEndpoint(
          await loadSetting("azure_openai_endpoint", "AZURE_OPENAI_ENDPOINT")
        );
      }
      if (!azureEndpoint) {
        return {
          status: 400,
          jsonBody: {
            error:
              "Azure OpenAI endpoint not configured. Set azure_openai_endpoint in Settings → Proxy Setup (or AZURE_OPENAI_ENDPOINT) or send x-azure-openai-resource.",
          },
        };
      }
      const apiKey = req.headers.get("api-key");
      const bearer = req.headers.get("authorization");
      if (apiKey) forwardHeaders["api-key"] = apiKey;
      else if (bearer?.startsWith("Bearer ")) forwardHeaders.Authorization = bearer;
      else {
        return {
          status: 400,
          jsonBody: { error: "Missing api-key header (or Authorization: Bearer <Entra token>)" },
        };
      }
      const classified = classifyAzureOpenAIPath(subpath);
      path = classified.path;
      endpoint = classified.endpoint;
      deployment = classified.deployment;
      targetBase = azureEndpoint;
    }
    const targetUrl = `${targetBase}${path}${search}`;

    const { attribution, response: attributionError } = await resolveAttribution(req, provider);
    if (attributionError) return attributionError;
    const { department, userEmail, aiSystemId, agent, client } = attribution;

    let { bodyText, bodyJson } = await readJsonBody(req);
    const model =
      flavor === "azure"
        ? resolveAzureModel({
            deployment,
            bodyModel: bodyJson?.model,
            map: parseAzureDeploymentMap(
              await loadSetting("azure_openai_deployments", "AZURE_OPENAI_DEPLOYMENTS")
            ),
          })
        : (str(bodyJson?.model) ?? "unknown");

    const baseMeta = {
      path,
      endpoint,
      deployment: deployment ?? undefined,
      azureEndpoint: azureEndpoint ?? undefined,
      aiSystemId,
      agentId: agent?.id ?? null,
      client,
    };
    const startTime = Date.now();

    // ── Pass-through: nothing to read usage from ──
    if (endpoint === "other" || !bodyJson) {
      // Cross-surface correlation hash of the user-authored prompt (never the
      // prompt itself) — see anthropic-proxy.ts. A JSON body here may still
      // carry `prompt` / `messages` (images, audio).
      const promptHash = computePromptHash(await loadPromptHashSalt(), extractUserPromptText(bodyJson));
      if (bodyJson) {
        const denied = await runPolicyGate({
          provider,
          model,
          aiSystemId,
          userEmail,
          department,
          policyBody: bodyJson,
          isStreaming: false,
          requestMetadata: { endpoint: path },
        });
        if (denied) return denied;
      }
      let upstream: Response;
      try {
        upstream = await fetch(targetUrl, {
          method: req.method,
          headers: forwardHeaders,
          body: bodyText || undefined,
        });
      } catch (err) {
        await logUsage({
          provider,
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
          metadata: { ...baseMeta, passthrough: true, method: req.method, promptHash },
        }).catch((logErr) => console.error("logUsage failed:", logErr));
        return { status: 502, jsonBody: { error: `Failed to reach ${upstreamName} API` } };
      }
      const responseText = await upstream.text();
      await logUsage({
        provider,
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
        requestId: upstreamRequestId(upstream),
        metadata: {
          ...passthroughMeta({
            baseMeta,
            method: req.method,
            status: upstream.status,
            latencyMs: Date.now() - startTime,
          }),
          promptHash,
        },
      }).catch((err) => console.error("logUsage failed:", err));
      return {
        status: upstream.status,
        headers: { "Content-Type": upstream.headers.get("Content-Type") ?? "application/json" },
        body: responseText,
      };
    }

    // ── Usage endpoints ──
    const dialect =
      endpoint === "responses"
        ? "openai_responses"
        : endpoint === "embeddings"
          ? "openai_embeddings"
          : "openai_chat";
    const canonical = { ...canonicalizeRequest(dialect, bodyJson), model };
    const policyBody = policyViewOf(canonical);
    const isStreaming = canonical.stream;

    // Same hash the Vercel proxy computes for this request: taken from the
    // canonical view so Responses / Embeddings bodies hash like Chat Completions.
    const promptHash = computePromptHash(await loadPromptHashSalt(), extractUserPromptText(policyBody));

    const declaredServers = extractDeclaredMcpServers(bodyJson);
    const mcpGate = await runMcpServerGate({
      agent,
      declaredServers,
      provider,
      model,
      aiSystemId,
      userEmail,
      department,
      isStreaming,
      bodyJson,
      bodyText,
    });
    if (mcpGate.response) return mcpGate.response;
    bodyJson = mcpGate.bodyJson ?? bodyJson;
    bodyText = mcpGate.bodyText;

    const denied = await runPolicyGate({
      provider,
      model,
      aiSystemId,
      userEmail,
      department,
      policyBody,
      isStreaming,
      requestMetadata: { endpoint: path, deployment },
    });
    if (denied) return denied;

    // Chat Completions only report streaming usage on request — inject it and
    // strip the resulting usage-only chunk from the client's copy.
    let usageInjected = false;
    if (isStreaming && (endpoint === "chat_completions" || endpoint === "completions")) {
      const streamOptions =
        bodyJson.stream_options && typeof bodyJson.stream_options === "object"
          ? (bodyJson.stream_options as Record<string, unknown>)
          : null;
      if (streamOptions?.include_usage !== true) {
        bodyJson = { ...bodyJson, stream_options: { ...(streamOptions ?? {}), include_usage: true } };
        bodyText = JSON.stringify(bodyJson);
        usageInjected = true;
      }
    }

    let upstream: Response;
    try {
      upstream = await fetch(targetUrl, {
        method: "POST",
        headers: forwardHeaders,
        body: bodyText ?? JSON.stringify(bodyJson),
      });
    } catch (err) {
      await logUsage({
        provider,
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
      return { status: 502, jsonBody: { error: `Failed to reach ${upstreamName} API` } };
    }

    const requestId = upstreamRequestId(upstream);
    const latencyMs = Date.now() - startTime;

    // ── Streaming ──
    if (isStreaming && upstream.ok && upstream.body) {
      const streamCtx: StreamContext = {
        provider,
        pricingProvider,
        endpoint,
        model,
        department,
        userEmail,
        latencyMs,
        aiSystemId,
        requestId,
        agent,
        declaredServers,
        usageInjected,
        promptHash,
        baseMeta,
      };

      // Human-review triggers in enforce mode: hold the whole stream, decide,
      // then either withhold it (403) or replay it to the client unchanged.
      let nodeStream: Readable;
      if (agentEnforcesReview(agent)) {
        const bufferedText = await upstream.text();
        const reviewMatches = await evaluateAgentReviewTriggers(
          agent,
          collectOpenAIToolUsesFromSse(bufferedText, endpoint)
        );
        if (reviewMatches.length > 0) {
          void extractOpenAIStreamUsage(Readable.from([bufferedText]), {
            ...streamCtx,
            reviewDecision: "blocked",
          }).catch((err: unknown) => {
            console.error("extractOpenAIStreamUsage (withheld) failed:", err);
          });
          return { status: 403, jsonBody: humanReviewBlockedBody(agent, reviewMatches) };
        }
        nodeStream = Readable.from([bufferedText]);
      } else {
        nodeStream = Readable.fromWeb(upstream.body as unknown as ReadableStream<Uint8Array>);
      }
      const clientPass = new PassThrough();
      const logPass = new PassThrough();
      nodeStream.pipe(clientPass);
      nodeStream.pipe(logPass);

      // Fire-and-forget with an error handler — Azure Functions has no
      // `waitUntil`, and an unhandled rejection would crash the worker.
      void extractOpenAIStreamUsage(logPass, streamCtx).catch((err: unknown) => {
        console.error("extractOpenAIStreamUsage failed:", err);
      });

      const clientBody = usageInjected ? clientPass.pipe(createUsageChunkFilter()) : clientPass;
      return {
        status: upstream.status,
        headers: {
          "Content-Type": upstream.headers.get("Content-Type") ?? "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        },
        body: clientBody,
      };
    }

    // ── Non-streaming (and streaming errors, returned as JSON) ──
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

    const usagePayload = responseBody?.usage as Record<string, unknown> | undefined;
    const tokenUsage =
      endpoint === "responses" ? usageFromOpenAIResponses(usagePayload) : usageFromOpenAI(usagePayload);
    const accounted = accountTokens(tokenUsage);
    const pricing = calculateCost(pricingProvider, model, tokenUsage);
    const toolUses = upstream.ok ? extractOpenAIToolUses(responseBody) : [];

    let flagged = false;
    let flagCategory: "upstream_error" | "sensitive_response" | null = null;
    let flagReason: string | null = null;
    if (upstream.ok) {
      const dlp = await scanResponseForSensitiveInfo({
        provider,
        model,
        aiSystemId,
        responseText: extractOpenAIResponseText(endpoint, responseBody),
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
      provider,
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
        mcp:
          declaredServers.length > 0 || toolUses.length > 0
            ? summarizeMcpForMetadata(declaredServers, toolUses)
            : undefined,
      },
    }).catch((err) => console.error("logUsage failed:", err));

    const reviewMatches = await evaluateAgentReviewTriggers(agent, toolUses);
    const reviewBlocked = reviewMatches.length > 0 && upstream.ok && agentEnforcesReview(agent);

    await recordToolActivity({
      agent,
      aiSystemId,
      provider,
      model,
      requestId,
      userEmail,
      department,
      declaredServers,
      toolUses,
      reviewMatches,
    });
    if (agent && reviewMatches.length > 0) {
      await recordHumanReviewMatches({
        agent,
        matches: reviewMatches,
        blocked: reviewBlocked,
        provider,
        model,
        aiSystemId,
        userEmail,
        department,
        requestId,
        isStreaming: false,
      });
    }
    if (reviewBlocked && agent) {
      return { status: 403, jsonBody: humanReviewBlockedBody(agent, reviewMatches) };
    }

    return {
      status: upstream.status,
      headers: { "Content-Type": upstream.headers.get("Content-Type") ?? "application/json" },
      body: responseText,
    };
  };
}
