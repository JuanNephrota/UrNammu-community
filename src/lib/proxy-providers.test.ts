import test from "node:test";
import assert from "node:assert/strict";
import {
  bucketProviderFor,
  canonicalizeRequest,
  classifyAzureOpenAIPath,
  classifyOpenAIPath,
  decodeBedrockEventPayload,
  extractGeminiResponseText,
  extractGeminiToolUses,
  extractOpenAIResponseText,
  extractOpenAIStreamText,
  isGeminiSseStream,
  isValidAwsRegion,
  normalizeAzureOpenAIEndpoint,
  normalizeOpenAIPath,
  parseAzureDeploymentMap,
  parseBedrockPath,
  parseGeminiPath,
  parseSigV4Authorization,
  policyViewOf,
  resolveAzureModel,
  selectBedrockForwardHeaders,
  splitEventStreamFrames,
  bedrockRuntimeHost,
} from "./proxy-providers";

// ── providers ───────────────────────────────────────────────────────────────

test("bucketProviderFor maps legacy log providers to normalized bucket providers", () => {
  assert.equal(bucketProviderFor("claude"), "anthropic");
  assert.equal(bucketProviderFor("chatgpt"), "openai");
  assert.equal(bucketProviderFor("azure_openai"), "azure_openai");
  assert.equal(bucketProviderFor("gemini"), "gemini");
  assert.equal(bucketProviderFor("bedrock"), "bedrock");
  assert.equal(bucketProviderFor("mystery"), null);
});

// ── OpenAI paths ────────────────────────────────────────────────────────────

test("openai paths normalise with or without /v1 and classify usage-bearing endpoints", () => {
  assert.equal(normalizeOpenAIPath(""), "/v1/chat/completions");
  assert.equal(normalizeOpenAIPath("/"), "/v1/chat/completions");
  assert.equal(normalizeOpenAIPath("chat/completions"), "/v1/chat/completions");
  assert.equal(normalizeOpenAIPath("/v1/responses/"), "/v1/responses");
  assert.deepEqual(classifyOpenAIPath("/v1/chat/completions"), {
    path: "/v1/chat/completions",
    endpoint: "chat_completions",
  });
  assert.equal(classifyOpenAIPath("/responses").endpoint, "responses");
  assert.equal(classifyOpenAIPath("/v1/embeddings").endpoint, "embeddings");
  assert.equal(classifyOpenAIPath("/v1/completions").endpoint, "completions");
  assert.deepEqual(classifyOpenAIPath("/v1/images/generations"), {
    path: "/v1/images/generations",
    endpoint: "other",
  });
  // Sub-resources are pass-through, not usage endpoints.
  assert.equal(classifyOpenAIPath("/v1/responses/resp_123").endpoint, "other");
  assert.equal(classifyOpenAIPath("/v1/batches").endpoint, "other");
});

test("azure openai paths expose the deployment and the endpoint", () => {
  assert.deepEqual(classifyAzureOpenAIPath("/openai/deployments/gpt4o-prod/chat/completions"), {
    path: "/openai/deployments/gpt4o-prod/chat/completions",
    endpoint: "chat_completions",
    deployment: "gpt4o-prod",
  });
  assert.equal(classifyAzureOpenAIPath("/openai/deployments/emb/embeddings").endpoint, "embeddings");
  assert.equal(classifyAzureOpenAIPath("/openai/deployments/x/images/generations").endpoint, "other");
  assert.deepEqual(classifyAzureOpenAIPath("/openai/v1/responses"), {
    path: "/openai/v1/responses",
    endpoint: "responses",
    deployment: null,
  });
  assert.equal(classifyAzureOpenAIPath("/openai/models").endpoint, "other");
  assert.equal(classifyAzureOpenAIPath("/openai/deployments/my%20dep/chat/completions").deployment, "my dep");
});

test("azure endpoint accepts resource names and Azure hosts only", () => {
  assert.equal(normalizeAzureOpenAIEndpoint("my-resource"), "https://my-resource.openai.azure.com");
  assert.equal(
    normalizeAzureOpenAIEndpoint("https://my-resource.openai.azure.com/"),
    "https://my-resource.openai.azure.com"
  );
  assert.equal(
    normalizeAzureOpenAIEndpoint("https://foundry.cognitiveservices.azure.com/openai/v1"),
    "https://foundry.cognitiveservices.azure.com"
  );
  assert.equal(normalizeAzureOpenAIEndpoint("https://foundry.services.ai.azure.com"), "https://foundry.services.ai.azure.com");
  assert.equal(normalizeAzureOpenAIEndpoint("http://my-resource.openai.azure.com"), null);
  assert.equal(normalizeAzureOpenAIEndpoint("https://evil.example.com/openai.azure.com"), null);
  assert.equal(normalizeAzureOpenAIEndpoint("https://openai.azure.com"), null);
  assert.equal(normalizeAzureOpenAIEndpoint("https://user:pw@x.openai.azure.com"), null);
  assert.equal(normalizeAzureOpenAIEndpoint(""), null);
  assert.equal(normalizeAzureOpenAIEndpoint(null), null);
});

test("azure deployment map parses leniently and resolves in precedence order", () => {
  const map = parseAzureDeploymentMap('{"GPT4o-Prod": "gpt-4o", "emb": "text-embedding-3-small", "bad": 3}');
  assert.deepEqual(map, { "gpt4o-prod": "gpt-4o", emb: "text-embedding-3-small" });
  assert.deepEqual(parseAzureDeploymentMap("not json"), {});
  assert.deepEqual(parseAzureDeploymentMap("[1,2]"), {});
  assert.deepEqual(parseAzureDeploymentMap(null), {});
  assert.equal(resolveAzureModel({ deployment: "gpt4o-prod", bodyModel: "gpt4o-prod", map }), "gpt-4o");
  assert.equal(resolveAzureModel({ deployment: "other", bodyModel: "gpt-4.1", map }), "gpt-4.1");
  assert.equal(resolveAzureModel({ deployment: "gpt-4o-mini-eu", bodyModel: undefined, map }), "gpt-4o-mini-eu");
  assert.equal(resolveAzureModel({ deployment: null, bodyModel: null, map }), "unknown");
});

test("openai response text extraction covers chat, completions and responses", () => {
  assert.equal(
    extractOpenAIResponseText("chat_completions", {
      choices: [{ message: { content: "hello" } }, { message: { content: [{ type: "text", text: "two" }] } }],
    }),
    "hello\ntwo"
  );
  assert.equal(extractOpenAIResponseText("completions", { choices: [{ text: "legacy" }] }), "legacy");
  assert.equal(
    extractOpenAIResponseText("responses", {
      output: [
        { type: "reasoning", summary: [] },
        { type: "message", content: [{ type: "output_text", text: "resp" }, { type: "refusal", refusal: "no" }] },
      ],
    }),
    "resp"
  );
  assert.equal(extractOpenAIResponseText("responses", { output_text: "flat" }), "flat");
  assert.equal(extractOpenAIResponseText("embeddings", { data: [] }), "");
  assert.equal(extractOpenAIStreamText("chat_completions", { choices: [{ delta: { content: "d" } }] }), "d");
  assert.equal(extractOpenAIStreamText("responses", { type: "response.output_text.delta", delta: "x" }), "x");
  assert.equal(extractOpenAIStreamText("responses", { type: "response.completed" }), null);
  assert.equal(extractOpenAIStreamText("chat_completions", "[DONE]"), null);
});

// ── Gemini ──────────────────────────────────────────────────────────────────

test("gemini paths yield model and method", () => {
  assert.deepEqual(parseGeminiPath("/v1beta/models/gemini-2.5-pro:generateContent"), {
    path: "/v1beta/models/gemini-2.5-pro:generateContent",
    model: "gemini-2.5-pro",
    method: "generateContent",
  });
  assert.equal(parseGeminiPath("v1beta/models/gemini-2.5-flash:streamGenerateContent").method, "streamGenerateContent");
  assert.equal(parseGeminiPath("/v1/models/gemini-embedding-001:embedContent").method, "embedContent");
  assert.equal(parseGeminiPath("/v1beta/models/gemini-2.5-pro:frobnicate").method, "other");
  assert.deepEqual(parseGeminiPath("/v1beta/models"), { path: "/v1beta/models", model: null, method: "other" });
  assert.equal(isGeminiSseStream("?alt=sse"), true);
  assert.equal(isGeminiSseStream("alt=sse&key=x"), true);
  assert.equal(isGeminiSseStream(""), false);
});

test("gemini text and function calls are extracted from candidates", () => {
  const body = {
    candidates: [
      {
        content: {
          role: "model",
          parts: [{ text: "Sure, " }, { functionCall: { name: "get_weather", args: {} } }, { text: "done" }],
        },
      },
    ],
  };
  assert.equal(extractGeminiResponseText(body), "Sure, done");
  assert.deepEqual(extractGeminiToolUses(body), [{ kind: "tool_use", toolName: "get_weather", serverName: null }]);
  assert.equal(extractGeminiResponseText({ promptFeedback: {} }), "");
});

// ── Bedrock ─────────────────────────────────────────────────────────────────

test("bedrock paths expose the model id, including inference-profile ARNs", () => {
  assert.deepEqual(parseBedrockPath("/model/anthropic.claude-sonnet-4-5-20250929-v1:0/invoke"), {
    path: "/model/anthropic.claude-sonnet-4-5-20250929-v1:0/invoke",
    modelId: "anthropic.claude-sonnet-4-5-20250929-v1:0",
    operation: "invoke",
  });
  assert.equal(
    parseBedrockPath("/model/us.anthropic.claude-opus-4-6-v1:0/invoke-with-response-stream").operation,
    "invoke-with-response-stream"
  );
  const arn = encodeURIComponent(
    "arn:aws:bedrock:us-east-1:123456789012:inference-profile/us.anthropic.claude-sonnet-4-5-20250929-v1:0"
  );
  assert.equal(parseBedrockPath(`/model/${arn}/invoke`).modelId, "us.anthropic.claude-sonnet-4-5-20250929-v1:0");
  assert.equal(parseBedrockPath("/model/x/converse").operation, "converse");
  assert.equal(parseBedrockPath("/model/x/unknown").operation, "other");
  assert.equal(parseBedrockPath("/foundation-models").modelId, null);
});

test("sigv4 authorization yields region and signed headers", () => {
  const parsed = parseSigV4Authorization(
    "AWS4-HMAC-SHA256 Credential=AKIAEXAMPLE/20260916/us-east-1/bedrock/aws4_request, SignedHeaders=content-type;host;x-amz-date;x-amz-security-token, Signature=abc123"
  );
  assert.deepEqual(parsed, {
    accessKeyId: "AKIAEXAMPLE",
    date: "20260916",
    region: "us-east-1",
    service: "bedrock",
    signedHeaders: ["content-type", "host", "x-amz-date", "x-amz-security-token"],
  });
  assert.equal(parseSigV4Authorization("Bearer abc"), null);
  assert.equal(parseSigV4Authorization("AWS4-HMAC-SHA256 Credential=bad, Signature=x"), null);
  assert.equal(parseSigV4Authorization(null), null);
  assert.equal(isValidAwsRegion("us-east-1"), true);
  assert.equal(isValidAwsRegion("ap-southeast-2"), true);
  assert.equal(isValidAwsRegion("us-gov-west-1"), true);
  assert.equal(isValidAwsRegion("evil.example.com"), false);
  assert.equal(isValidAwsRegion(""), false);
  assert.equal(bedrockRuntimeHost("eu-central-1"), "bedrock-runtime.eu-central-1.amazonaws.com");
  assert.equal(bedrockRuntimeHost("nope"), null);
});

test("bedrock forward headers keep signed + x-amz headers and drop proxy attribution", () => {
  const headers: Array<[string, string]> = [
    ["Authorization", "AWS4-HMAC-SHA256 ..."],
    ["Content-Type", "application/json"],
    ["Host", "proxy.example.com"],
    ["X-Amz-Date", "20260916T000000Z"],
    ["X-Amz-Security-Token", "tok"],
    ["x-amzn-bedrock-guardrailidentifier", "gr-1"],
    ["Amz-Sdk-Invocation-Id", "inv"],
    ["x-proxy-key", "secret"],
    ["x-user-email", "a@b.c"],
    ["x-aws-region", "us-east-1"],
    ["Content-Length", "42"],
    ["User-Agent", "aws-sdk-js/3"],
  ];
  const forwarded = selectBedrockForwardHeaders(headers, ["content-type", "host", "user-agent", "x-amz-date"]);
  assert.deepEqual(forwarded, {
    authorization: "AWS4-HMAC-SHA256 ...",
    "content-type": "application/json",
    "x-amz-date": "20260916T000000Z",
    "x-amz-security-token": "tok",
    "x-amzn-bedrock-guardrailidentifier": "gr-1",
    "amz-sdk-invocation-id": "inv",
    "user-agent": "aws-sdk-js/3",
  });
});

function frame(payload: string, headers: Uint8Array = new Uint8Array(0)): Uint8Array {
  const body = new TextEncoder().encode(payload);
  const total = 12 + headers.length + body.length + 4;
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  view.setUint32(0, total);
  view.setUint32(4, headers.length);
  view.setUint32(8, 0); // prelude crc (not verified)
  out.set(headers, 12);
  out.set(body, 12 + headers.length);
  view.setUint32(total - 4, 0); // message crc (not verified)
  return out;
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

test("bedrock event-stream frames split across chunk boundaries and decode chunk payloads", () => {
  const event1 = { type: "message_start", message: { usage: { input_tokens: 9, output_tokens: 1 } } };
  const event2 = {
    type: "message_stop",
    "amazon-bedrock-invocationMetrics": { inputTokenCount: 9, outputTokenCount: 3 },
  };
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64");
  const f1 = frame(JSON.stringify({ bytes: b64(event1), p: "abc" }), new TextEncoder().encode("hdr"));
  const f2 = frame(JSON.stringify({ bytes: b64(event2) }));
  const all = concat(f1, f2);

  // Deliver in two arbitrary pieces.
  const cut = f1.length + 5;
  const first = splitEventStreamFrames(all.slice(0, cut));
  assert.equal(first.frames.length, 1);
  assert.equal(first.rest.length, 5);
  const second = splitEventStreamFrames(concat(first.rest, all.slice(cut)));
  assert.equal(second.frames.length, 1);
  assert.equal(second.rest.length, 0);

  assert.deepEqual(decodeBedrockEventPayload(first.frames[0]), event1);
  assert.deepEqual(decodeBedrockEventPayload(second.frames[0]), event2);
  // Exception payloads are plain JSON.
  assert.deepEqual(decodeBedrockEventPayload(new TextEncoder().encode('{"message":"throttled"}')), {
    message: "throttled",
  });
  assert.equal(decodeBedrockEventPayload(new TextEncoder().encode("garbage")), null);
  // A malformed prelude drops the buffer instead of looping.
  const bad = new Uint8Array(16);
  new DataView(bad.buffer).setUint32(0, 3);
  assert.deepEqual(splitEventStreamFrames(bad), { frames: [], rest: new Uint8Array(0) });
});

// ── Canonical request ───────────────────────────────────────────────────────

test("canonicalizeRequest folds every dialect into one shape", () => {
  const anthropic = canonicalizeRequest("anthropic", {
    model: "claude-sonnet-5",
    stream: true,
    max_tokens: 500,
    system: [{ type: "text", text: "be terse" }],
    messages: [
      { role: "user", content: "hi" },
      { role: "assistant", content: [{ type: "text", text: "hello" }, { type: "tool_use", name: "x" }] },
      { role: "user", content: [{ type: "tool_result", content: "secret" }, { type: "text", text: "next" }] },
    ],
  });
  assert.deepEqual(anthropic, {
    model: "claude-sonnet-5",
    stream: true,
    system: "be terse",
    messages: [
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello" },
      { role: "user", content: "next" },
    ],
    maxTokens: 500,
  });

  const chat = canonicalizeRequest("openai_chat", {
    model: "gpt-4o",
    max_completion_tokens: 64,
    messages: [
      { role: "developer", content: "rules" },
      { role: "user", content: [{ type: "text", text: "q" }, { type: "image_url", image_url: {} }] },
      { role: "tool", content: "ignored" },
    ],
  });
  assert.deepEqual(chat, {
    model: "gpt-4o",
    stream: false,
    system: "rules",
    messages: [{ role: "user", content: "q" }],
    maxTokens: 64,
  });

  const responses = canonicalizeRequest("openai_responses", {
    model: "gpt-5",
    stream: true,
    instructions: "sys",
    max_output_tokens: 1000,
    input: [
      { role: "user", content: [{ type: "input_text", text: "first" }] },
      { type: "message", role: "assistant", content: [{ type: "output_text", text: "reply" }] },
      { type: "function_call_output", call_id: "c", output: "ignored" },
      { role: "system", content: "more" },
    ],
  });
  assert.deepEqual(responses, {
    model: "gpt-5",
    stream: true,
    system: "sys\nmore",
    messages: [
      { role: "user", content: "first" },
      { role: "assistant", content: "reply" },
    ],
    maxTokens: 1000,
  });
  assert.deepEqual(canonicalizeRequest("openai_responses", { model: "gpt-5", input: "plain" }).messages, [
    { role: "user", content: "plain" },
  ]);

  const gemini = canonicalizeRequest("gemini", {
    systemInstruction: { parts: [{ text: "gsys" }] },
    generationConfig: { maxOutputTokens: 256 },
    contents: [
      { role: "user", parts: [{ text: "ask" }] },
      { role: "model", parts: [{ text: "ans" }] },
      { parts: [{ text: "no role" }] },
    ],
  });
  assert.deepEqual(gemini, {
    model: "unknown",
    stream: false,
    system: "gsys",
    messages: [
      { role: "user", content: "ask" },
      { role: "assistant", content: "ans" },
      { role: "user", content: "no role" },
    ],
    maxTokens: 256,
  });
  assert.deepEqual(canonicalizeRequest("gemini", null).messages, []);

  assert.deepEqual(
    canonicalizeRequest("openai_embeddings", { model: "text-embedding-3-small", input: ["a", "b", ""] }),
    { model: "text-embedding-3-small", stream: false, system: null, messages: [
      { role: "user", content: "a" },
      { role: "user", content: "b" },
    ], maxTokens: null }
  );
  assert.deepEqual(
    canonicalizeRequest("openai_embeddings", { model: "e", input: [[1, 2, 3]] }).messages,
    []
  );
});

test("policyViewOf produces the messages/system/max_tokens body the evaluators read", () => {
  const view = policyViewOf({
    model: "gemini-2.5-pro",
    stream: false,
    system: "s",
    messages: [{ role: "user", content: "u" }],
    maxTokens: 10,
  });
  assert.deepEqual(view, {
    model: "gemini-2.5-pro",
    stream: false,
    messages: [{ role: "user", content: "u" }],
    system: "s",
    max_tokens: 10,
  });
  const bare = policyViewOf({ model: "m", stream: true, system: null, messages: [], maxTokens: null });
  assert.equal("system" in bare, false);
  assert.equal("max_tokens" in bare, false);
});
