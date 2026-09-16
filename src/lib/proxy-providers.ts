/**
 * Provider-dialect helpers shared by every proxy path: which upstream endpoint
 * a request targets, how to read its usage and text back out, how to map an
 * Azure deployment to a model, how to read a Bedrock SigV4 request, and how to
 * fold every dialect's prompt into one canonical shape for policy-as-code and
 * prompt-risk evaluation.
 *
 * MIRRORED FILE — `src/lib/proxy-providers.ts` and
 * `ai-proxy/src/lib/proxy-providers.ts` must stay byte-identical
 * (`npm run check:mirror-drift`). The Azure Functions project cannot import
 * from the Next.js app, so this module has no imports and no runtime
 * dependencies beyond Node globals (TextDecoder, Buffer, URLSearchParams).
 */

// ─── Providers ──────────────────────────────────────────────────────────────

/** `APIUsageLog.provider` values written by the proxies. */
export type ProxyProvider = "claude" | "chatgpt" | "azure_openai" | "gemini" | "bedrock";

/**
 * `UsageBucket` / `CostBucket` provider for a proxy row. The legacy
 * `APIUsageLog` keeps `claude` / `chatgpt`; the normalized tables use the
 * admin-sync provider names so proxy rows roll into the same totals. Azure
 * OpenAI and Bedrock are billed by Microsoft / AWS, not by the model vendor,
 * so they stay their own providers.
 */
export function bucketProviderFor(provider: string): string | null {
  switch (provider) {
    case "claude":
      return "anthropic";
    case "chatgpt":
      return "openai";
    case "azure_openai":
    case "gemini":
    case "bedrock":
      return provider;
    default:
      return null;
  }
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function leadingSlash(path: string): string {
  return path.startsWith("/") ? path : `/${path}`;
}

// ─── OpenAI (api.openai.com and Azure OpenAI) ───────────────────────────────

export type OpenAIEndpoint =
  | "chat_completions"
  | "completions"
  | "responses"
  | "embeddings"
  | "other";

/**
 * Normalise a subpath the client sent under `/proxy/openai`. The SDKs append
 * `/chat/completions` to whatever `baseURL` they were given, so a client
 * configured with the proxy root (no `/v1`) arrives as `/chat/completions`;
 * one configured with `/v1` arrives as `/v1/chat/completions`. Both forward
 * to `https://api.openai.com/v1/...`.
 */
export function normalizeOpenAIPath(subpath: string): string {
  const path = leadingSlash(subpath.trim()).replace(/\/+$/, "") || "/";
  if (path === "/" || path === "/v1") return "/v1/chat/completions";
  return path.startsWith("/v1/") ? path : `/v1${path}`;
}

function endpointForTail(tail: string): OpenAIEndpoint {
  switch (tail) {
    case "/chat/completions":
      return "chat_completions";
    case "/completions":
      return "completions";
    case "/responses":
      return "responses";
    case "/embeddings":
      return "embeddings";
    default:
      return "other";
  }
}

/** Classify a normalised `/v1/...` path. Only the exact usage-bearing endpoints match. */
export function classifyOpenAIPath(subpath: string): { path: string; endpoint: OpenAIEndpoint } {
  const path = normalizeOpenAIPath(subpath);
  return { path, endpoint: endpointForTail(path.slice("/v1".length)) };
}

/**
 * Azure OpenAI paths take two forms:
 *   - deployment-scoped: `/openai/deployments/{deployment}/chat/completions?api-version=…`
 *   - v1 (model in body):  `/openai/v1/chat/completions`
 * Both are forwarded verbatim (path + query) to the resource endpoint.
 */
export function classifyAzureOpenAIPath(subpath: string): {
  path: string;
  endpoint: OpenAIEndpoint;
  deployment: string | null;
} {
  const path = leadingSlash(subpath.trim()).replace(/\/+$/, "");
  const deploymentMatch = /^\/openai\/deployments\/([^/]+)(\/.*)?$/.exec(path);
  if (deploymentMatch) {
    let deployment: string | null = deploymentMatch[1];
    try {
      deployment = decodeURIComponent(deployment);
    } catch {
      // keep the raw segment
    }
    return { path, endpoint: endpointForTail(deploymentMatch[2] ?? ""), deployment };
  }
  if (path.startsWith("/openai/v1/")) {
    return { path, endpoint: endpointForTail(path.slice("/openai/v1".length)), deployment: null };
  }
  return { path, endpoint: "other", deployment: null };
}

const AZURE_OPENAI_HOST_SUFFIXES = [
  ".openai.azure.com",
  ".cognitiveservices.azure.com",
  ".services.ai.azure.com",
];

/**
 * Accept either a bare resource name (`my-resource` →
 * `https://my-resource.openai.azure.com`) or a full `https://` endpoint on one
 * of the Azure OpenAI / AI Foundry domains. Anything else is rejected so a
 * client header can never point the proxy at an arbitrary host.
 */
export function normalizeAzureOpenAIEndpoint(value: string | null | undefined): string | null {
  if (!value) return null;
  let raw = value.trim();
  if (!raw) return null;
  if (/^[a-z0-9][a-z0-9-]{0,62}$/i.test(raw)) raw = `https://${raw}.openai.azure.com`;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password) return null;
  const host = url.hostname.toLowerCase();
  const ok = AZURE_OPENAI_HOST_SUFFIXES.some(
    (suffix) => host.endsWith(suffix) && host.length > suffix.length
  );
  return ok ? `https://${host}` : null;
}

/**
 * Parse the `azure_openai_deployments` setting: a JSON object mapping
 * deployment name → model id (`{"gpt4o-prod": "gpt-4o"}`). Keys are matched
 * case-insensitively. Malformed input yields an empty map, never a throw.
 */
export function parseAzureDeploymentMap(json: string | null | undefined): Record<string, string> {
  if (!json) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return {};
  }
  if (!isRecord(parsed)) return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed)) {
    const k = key.trim().toLowerCase();
    const v = str(value)?.trim();
    if (k && v) out[k] = v;
  }
  return out;
}

/**
 * Model id to price an Azure OpenAI call under: the deployment map first, then
 * the body's `model` (the v1 path and most SDKs send it), then the deployment
 * name itself — teams often name deployments after the model, and the pricing
 * table's prefix match picks those up.
 */
export function resolveAzureModel(input: {
  deployment: string | null;
  bodyModel: unknown;
  map: Record<string, string>;
}): string {
  const mapped = input.deployment ? input.map[input.deployment.toLowerCase()] : undefined;
  return mapped ?? str(input.bodyModel) ?? input.deployment ?? "unknown";
}

/** Text of an OpenAI response for inline DLP (chat, legacy completions, responses). */
export function extractOpenAIResponseText(endpoint: OpenAIEndpoint, body: unknown): string {
  if (!isRecord(body)) return "";
  const parts: string[] = [];
  if (endpoint === "responses") {
    if (typeof body.output_text === "string") return body.output_text;
    if (Array.isArray(body.output)) {
      for (const item of body.output) {
        if (!isRecord(item) || item.type !== "message" || !Array.isArray(item.content)) continue;
        for (const block of item.content) {
          if (isRecord(block) && block.type === "output_text" && typeof block.text === "string") {
            parts.push(block.text);
          }
        }
      }
    }
    return parts.join("\n");
  }
  if (Array.isArray(body.choices)) {
    for (const choice of body.choices) {
      if (!isRecord(choice)) continue;
      if (typeof choice.text === "string") parts.push(choice.text);
      const message = choice.message;
      if (!isRecord(message)) continue;
      if (typeof message.content === "string") parts.push(message.content);
      else if (Array.isArray(message.content)) {
        for (const block of message.content) {
          if (isRecord(block) && typeof block.text === "string") parts.push(block.text);
        }
      }
    }
  }
  return parts.join("\n");
}

/** Streamed text delta from one OpenAI SSE event, or null. */
export function extractOpenAIStreamText(endpoint: OpenAIEndpoint, event: unknown): string | null {
  if (!isRecord(event)) return null;
  if (endpoint === "responses") {
    return event.type === "response.output_text.delta" && typeof event.delta === "string"
      ? event.delta
      : null;
  }
  const choice = Array.isArray(event.choices) ? event.choices[0] : null;
  if (!isRecord(choice)) return null;
  if (typeof choice.text === "string") return choice.text;
  const delta = choice.delta;
  return isRecord(delta) && typeof delta.content === "string" ? delta.content : null;
}

// ─── Gemini ─────────────────────────────────────────────────────────────────

export type GeminiMethod =
  | "generateContent"
  | "streamGenerateContent"
  | "countTokens"
  | "embedContent"
  | "batchEmbedContents"
  | "other";

/**
 * `POST /v1beta/models/{model}:generateContent` (also `/v1/`, `/v1alpha/`).
 * The model id is the path segment before the colon; the method after it.
 */
export function parseGeminiPath(subpath: string): {
  path: string;
  model: string | null;
  method: GeminiMethod;
} {
  const path = leadingSlash(subpath.trim());
  const match = /^\/v1(?:alpha|beta)?\/models\/([^/:]+):([A-Za-z]+)$/.exec(path);
  if (!match) return { path, model: null, method: "other" };
  const method = match[2];
  const known: GeminiMethod[] = [
    "generateContent",
    "streamGenerateContent",
    "countTokens",
    "embedContent",
    "batchEmbedContents",
  ];
  return {
    path,
    model: match[1],
    method: (known as string[]).includes(method) ? (method as GeminiMethod) : "other",
  };
}

/** `streamGenerateContent` emits SSE only with `?alt=sse`; otherwise a JSON array. */
export function isGeminiSseStream(search: string): boolean {
  return new URLSearchParams(search.startsWith("?") ? search.slice(1) : search).get("alt") === "sse";
}

/** Concatenated candidate text from one Gemini response or stream chunk. */
export function extractGeminiResponseText(body: unknown): string {
  if (!isRecord(body) || !Array.isArray(body.candidates)) return "";
  const parts: string[] = [];
  for (const candidate of body.candidates) {
    if (!isRecord(candidate) || !isRecord(candidate.content)) continue;
    const blocks = candidate.content.parts;
    if (!Array.isArray(blocks)) continue;
    for (const block of blocks) {
      if (isRecord(block) && typeof block.text === "string") parts.push(block.text);
    }
  }
  return parts.join("");
}

/** Gemini function calls (`parts[].functionCall.name`) as observed tool uses. */
export function extractGeminiToolUses(
  body: unknown
): Array<{ kind: "tool_use"; toolName: string; serverName: null }> {
  if (!isRecord(body) || !Array.isArray(body.candidates)) return [];
  const out: Array<{ kind: "tool_use"; toolName: string; serverName: null }> = [];
  for (const candidate of body.candidates) {
    if (!isRecord(candidate) || !isRecord(candidate.content)) continue;
    const blocks = candidate.content.parts;
    if (!Array.isArray(blocks)) continue;
    for (const block of blocks) {
      if (!isRecord(block) || !isRecord(block.functionCall)) continue;
      const name = str(block.functionCall.name);
      if (name) out.push({ kind: "tool_use", toolName: name, serverName: null });
    }
  }
  return out;
}

// ─── Bedrock ────────────────────────────────────────────────────────────────

export type BedrockOperation =
  | "invoke"
  | "invoke-with-response-stream"
  | "converse"
  | "converse-stream"
  | "other";

/**
 * `/model/{modelId}/invoke` and `/model/{modelId}/invoke-with-response-stream`
 * (the Anthropic Messages API on Bedrock). `modelId` may be a URL-encoded
 * inference-profile ARN; the bare id after the last `/` is what prices.
 */
export function parseBedrockPath(subpath: string): {
  path: string;
  modelId: string | null;
  operation: BedrockOperation;
} {
  const path = leadingSlash(subpath.trim());
  const match = /^\/model\/([^/]+)\/(invoke|invoke-with-response-stream|converse|converse-stream)$/.exec(
    path
  );
  if (!match) return { path, modelId: null, operation: "other" };
  let raw = match[1];
  try {
    raw = decodeURIComponent(raw);
  } catch {
    // keep the raw segment
  }
  const slash = raw.lastIndexOf("/");
  const modelId = raw.startsWith("arn:") && slash !== -1 ? raw.slice(slash + 1) : raw;
  return { path, modelId: modelId || null, operation: match[2] as BedrockOperation };
}

export type SigV4Authorization = {
  accessKeyId: string;
  date: string;
  region: string;
  service: string;
  signedHeaders: string[];
};

/**
 * Parse `Authorization: AWS4-HMAC-SHA256 Credential=AKIA…/20260916/us-east-1/
 * bedrock/aws4_request, SignedHeaders=content-type;host;x-amz-date,
 * Signature=…`. The credential scope tells the proxy which regional endpoint
 * the client signed for; SignedHeaders tells it which headers must be
 * forwarded untouched for the signature to verify.
 */
export function parseSigV4Authorization(header: string | null | undefined): SigV4Authorization | null {
  if (!header || !header.startsWith("AWS4-HMAC-SHA256 ")) return null;
  const fields = new Map<string, string>();
  for (const part of header.slice("AWS4-HMAC-SHA256 ".length).split(",")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    fields.set(part.slice(0, eq).trim(), part.slice(eq + 1).trim());
  }
  const credential = fields.get("Credential");
  const signedHeaders = fields.get("SignedHeaders");
  if (!credential || !signedHeaders) return null;
  const scope = credential.split("/");
  if (scope.length !== 5 || scope[4] !== "aws4_request") return null;
  return {
    accessKeyId: scope[0],
    date: scope[1],
    region: scope[2],
    service: scope[3],
    signedHeaders: signedHeaders
      .split(";")
      .map((h) => h.trim().toLowerCase())
      .filter(Boolean),
  };
}

/** `us-east-1`, `eu-central-1`, `ap-southeast-2`, `us-gov-west-1`. */
export function isValidAwsRegion(region: string | null | undefined): region is string {
  return !!region && /^[a-z]{2}(?:-[a-z]+){1,2}-\d$/.test(region);
}

export function bedrockRuntimeHost(region: string): string | null {
  return isValidAwsRegion(region) ? `bedrock-runtime.${region}.amazonaws.com` : null;
}

/** Headers the proxy never forwards, even if a client signed them. */
const BEDROCK_NEVER_FORWARD = new Set([
  "host",
  "content-length",
  "connection",
  "transfer-encoding",
  "x-proxy-key",
  "x-user-email",
  "x-department",
  "x-ai-system-id",
  "x-agent-id",
  "x-aws-region",
]);

/** Headers always forwarded when present (the SigV4 material plus content negotiation). */
const BEDROCK_ALWAYS_FORWARD = new Set([
  "authorization",
  "content-type",
  "accept",
  "x-amz-date",
  "x-amz-security-token",
  "x-amz-content-sha256",
  "x-amz-user-agent",
  "amz-sdk-invocation-id",
  "amz-sdk-request",
]);

/**
 * Pick the request headers to forward to Bedrock: everything the client
 * signed (so the signature still verifies), the SigV4 material itself, and
 * any `x-amz*` / `x-amzn-*` header. The proxy's own attribution headers and
 * hop-by-hop headers are dropped.
 */
export function selectBedrockForwardHeaders(
  headers: Iterable<[string, string]>,
  signedHeaders: string[]
): Record<string, string> {
  const signed = new Set(signedHeaders.map((h) => h.toLowerCase()));
  const out: Record<string, string> = {};
  for (const [rawName, value] of headers) {
    const name = rawName.toLowerCase();
    if (BEDROCK_NEVER_FORWARD.has(name)) continue;
    if (
      BEDROCK_ALWAYS_FORWARD.has(name) ||
      signed.has(name) ||
      name.startsWith("x-amz")
    ) {
      out[name] = value;
    }
  }
  return out;
}

/**
 * Split an `application/vnd.amazon.eventstream` byte buffer into complete
 * message payloads. Frame layout: total length (4), headers length (4),
 * prelude CRC (4), headers, payload, message CRC (4). CRCs are not verified —
 * the client copy of the stream is untouched; this is the telemetry branch.
 * Returns the payloads found and the unconsumed tail to prepend to the next
 * chunk.
 */
export function splitEventStreamFrames(buffer: Uint8Array): {
  frames: Uint8Array[];
  rest: Uint8Array;
} {
  const frames: Uint8Array[] = [];
  let offset = 0;
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  while (buffer.length - offset >= 12) {
    const total = view.getUint32(offset);
    const headersLength = view.getUint32(offset + 4);
    if (total < 16 || headersLength > total - 16) {
      // Malformed prelude: drop everything rather than loop forever.
      return { frames, rest: new Uint8Array(0) };
    }
    if (buffer.length - offset < total) break;
    const payloadStart = offset + 12 + headersLength;
    const payloadEnd = offset + total - 4;
    frames.push(buffer.slice(payloadStart, payloadEnd));
    offset += total;
  }
  return { frames, rest: buffer.slice(offset) };
}

function base64ToUtf8(value: string): string {
  if (typeof Buffer !== "undefined") return Buffer.from(value, "base64").toString("utf8");
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

/**
 * Decode one Bedrock event-stream payload. `chunk` events wrap the Anthropic
 * stream event as `{"bytes": "<base64 JSON>"}`; exception events are plain
 * JSON (`{"message": "..."}`) and are returned as-is. Null when not JSON.
 */
export function decodeBedrockEventPayload(payload: Uint8Array): unknown {
  let outer: unknown;
  try {
    outer = JSON.parse(new TextDecoder().decode(payload));
  } catch {
    return null;
  }
  if (!isRecord(outer) || typeof outer.bytes !== "string") return outer;
  try {
    return JSON.parse(base64ToUtf8(outer.bytes));
  } catch {
    return null;
  }
}

// ─── Canonical request (policy + prompt-risk input) ─────────────────────────

export type ProxyDialect =
  | "anthropic"
  | "openai_chat"
  | "openai_responses"
  | "openai_embeddings"
  | "gemini";

export type CanonicalMessage = { role: "user" | "assistant" | "system"; content: string };

export type CanonicalRequest = {
  model: string;
  stream: boolean;
  system: string | null;
  messages: CanonicalMessage[];
  maxTokens: number | null;
};

function textOf(content: unknown, textKeys: string[] = ["text"]): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const block of content) {
    if (typeof block === "string") {
      parts.push(block);
      continue;
    }
    if (!isRecord(block)) continue;
    // Tool payloads are the model's own output echoed back — never user intent.
    if (block.type === "tool_result" || block.type === "tool_use") continue;
    for (const key of textKeys) {
      if (typeof block[key] === "string") {
        parts.push(block[key] as string);
        break;
      }
    }
  }
  return parts.join("\n");
}

function positiveInt(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

function canonicalRole(role: unknown): CanonicalMessage["role"] | null {
  switch (role) {
    case "user":
      return "user";
    case "assistant":
    case "model":
      return "assistant";
    case "system":
    case "developer":
      return "system";
    default:
      return null;
  }
}

/**
 * Fold a request body of any supported dialect into one shape: the model, the
 * streaming flag, the system prompt, the conversation as role/text pairs and
 * the requested output cap. Policy-as-code rules (blocked prompt patterns,
 * max_tokens caps) and prompt-risk detection read this instead of knowing
 * each provider's wire format.
 */
export function canonicalizeRequest(
  dialect: ProxyDialect,
  body: Record<string, unknown> | null | undefined
): CanonicalRequest {
  const empty: CanonicalRequest = {
    model: "unknown",
    stream: false,
    system: null,
    messages: [],
    maxTokens: null,
  };
  if (!isRecord(body)) return empty;
  const model = str(body.model) ?? "unknown";

  if (dialect === "anthropic" || dialect === "openai_chat") {
    const messages: CanonicalMessage[] = [];
    let system = typeof body.system === "string" ? body.system : textOf(body.system) || null;
    if (Array.isArray(body.messages)) {
      for (const raw of body.messages) {
        if (!isRecord(raw)) continue;
        const role = canonicalRole(raw.role);
        if (!role) continue;
        const content = textOf(raw.content);
        if (role === "system") {
          system = system ? `${system}\n${content}` : content || null;
          continue;
        }
        if (content) messages.push({ role, content });
      }
    }
    const maxTokens =
      positiveInt(body.max_tokens) ?? positiveInt(body.max_completion_tokens) ?? null;
    return { model, stream: body.stream === true, system, messages, maxTokens };
  }

  if (dialect === "openai_embeddings") {
    // `input` is a string or an array of strings (token arrays carry no text).
    const messages: CanonicalMessage[] = [];
    const input = body.input;
    if (typeof input === "string") messages.push({ role: "user", content: input });
    else if (Array.isArray(input)) {
      for (const item of input) {
        if (typeof item === "string" && item) messages.push({ role: "user", content: item });
      }
    }
    return { model, stream: false, system: null, messages, maxTokens: null };
  }

  if (dialect === "openai_responses") {
    const messages: CanonicalMessage[] = [];
    let system = str(body.instructions);
    const input = body.input;
    if (typeof input === "string") {
      messages.push({ role: "user", content: input });
    } else if (Array.isArray(input)) {
      for (const raw of input) {
        if (!isRecord(raw)) continue;
        if (raw.type !== undefined && raw.type !== "message") continue; // function_call_output etc.
        const role = canonicalRole(raw.role);
        if (!role) continue;
        const content = textOf(raw.content);
        if (role === "system") {
          system = system ? `${system}\n${content}` : content || null;
          continue;
        }
        if (content) messages.push({ role, content });
      }
    }
    return {
      model,
      stream: body.stream === true,
      system,
      messages,
      maxTokens: positiveInt(body.max_output_tokens),
    };
  }

  // gemini
  const messages: CanonicalMessage[] = [];
  const systemInstruction = body.systemInstruction ?? body.system_instruction;
  const system = isRecord(systemInstruction) ? textOf(systemInstruction.parts) || null : null;
  const contents = Array.isArray(body.contents)
    ? body.contents
    : isRecord(body.contents)
      ? [body.contents]
      : [];
  for (const raw of contents) {
    if (!isRecord(raw)) continue;
    // Gemini lets a single-turn request omit `role`; treat it as the user turn.
    const role = canonicalRole(raw.role ?? "user");
    if (!role || role === "system") continue;
    const content = textOf(raw.parts);
    if (content) messages.push({ role, content });
  }
  const generationConfig = isRecord(body.generationConfig)
    ? body.generationConfig
    : isRecord(body.generation_config)
      ? body.generation_config
      : null;
  return {
    model,
    stream: false,
    system,
    messages,
    maxTokens: generationConfig
      ? positiveInt(generationConfig.maxOutputTokens) ?? positiveInt(generationConfig.max_output_tokens)
      : null,
  };
}

/**
 * The canonical request as an Anthropic/OpenAI-shaped body — what the
 * policy evaluator (`extractPromptText`, `max_tokens`) and prompt-risk
 * analyzer (`messages[].role === "user"`) already understand.
 */
export function policyViewOf(canonical: CanonicalRequest): Record<string, unknown> {
  const view: Record<string, unknown> = {
    model: canonical.model,
    stream: canonical.stream,
    messages: canonical.messages.map((m) => ({ role: m.role, content: m.content })),
  };
  if (canonical.system) view.system = canonical.system;
  if (canonical.maxTokens !== null) view.max_tokens = canonical.maxTokens;
  return view;
}
