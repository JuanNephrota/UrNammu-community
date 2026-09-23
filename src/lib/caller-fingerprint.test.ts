import { test } from "node:test";
import assert from "node:assert/strict";
import {
  classifyClient,
  extractCallerCredential,
  fingerprintCaller,
  hashCallerCredential,
  USER_AGENT_MAX_CHARS,
} from "./caller-fingerprint";

const headers = (init: Record<string, string>) => new Headers(init);

test("classifyClient separates the Claude Agent SDK from interactive Claude Code", () => {
  assert.deepEqual(classifyClient("claude-cli/2.0.14 (external, sdk-ts)"), {
    framework: "claude_agent_sdk",
    kind: "agent_framework",
  });
  assert.deepEqual(classifyClient("claude-cli/2.0.14 (external, sdk-py)").framework, "claude_agent_sdk");
  assert.deepEqual(classifyClient("claude-cli/2.0.14 (external, cli)"), {
    framework: "claude_code",
    kind: "assistant",
  });
});

test("classifyClient recognises agent frameworks, libraries and assistants", () => {
  assert.equal(classifyClient("Agents/Python 0.4.2").framework, "openai_agents");
  assert.equal(classifyClient("pydantic-ai/1.0.3").kind, "agent_framework");
  assert.equal(classifyClient("Semantic-Kernel").framework, "semantic_kernel");
  assert.equal(classifyClient("langchain-anthropic/0.3.1").kind, "llm_library");
  assert.equal(classifyClient("ai/5.0.10 ai-sdk/provider-utils/3.0.1 runtime/node").framework, "vercel_ai_sdk");
  assert.equal(classifyClient("codex_cli_rs/0.40.0").kind, "assistant");
  assert.deepEqual(classifyClient("Anthropic/Python 0.49.0"), { framework: null, kind: "unknown" });
  assert.deepEqual(classifyClient(null), { framework: null, kind: "unknown" });
});

test("extractCallerCredential reads each provider's header, and only the SigV4 key id", () => {
  assert.equal(extractCallerCredential(headers({ "x-api-key": "sk-ant-1" })), "sk-ant-1");
  assert.equal(extractCallerCredential(headers({ "api-key": "az-1" })), "az-1");
  assert.equal(extractCallerCredential(headers({ authorization: "Bearer sk-proj-1" })), "sk-proj-1");
  assert.equal(extractCallerCredential(headers({ "x-goog-api-key": "g-1" })), "g-1");
  assert.equal(
    extractCallerCredential(
      headers({
        authorization:
          "AWS4-HMAC-SHA256 Credential=AKIAEXAMPLE123/20260922/us-east-1/bedrock/aws4_request, SignedHeaders=host, Signature=deadbeef",
      })
    ),
    "aws:AKIAEXAMPLE123"
  );
  assert.equal(extractCallerCredential(headers({}), "/v1beta/models/x:generateContent?key=g-2"), "g-2");
  assert.equal(extractCallerCredential(headers({})), null);
});

test("hashCallerCredential is salted, stable, short and never the key", () => {
  const a = hashCallerCredential("salt", "sk-secret");
  assert.equal(a, hashCallerCredential("salt", "sk-secret"));
  assert.notEqual(a, hashCallerCredential("other", "sk-secret"));
  assert.equal(a?.length, 16);
  assert.ok(!a?.includes("sk-secret"));
  assert.equal(hashCallerCredential(null, "sk-secret"), null);
  assert.equal(hashCallerCredential("salt", null), null);
});

test("fingerprintCaller combines framework, SDK, truncated UA and key hash", () => {
  const fp = fingerprintCaller({
    headers: headers({
      "user-agent": "Agents/Python 0.4.2 " + "x".repeat(400),
      "x-stainless-lang": "python",
      "x-stainless-package-version": "1.99.0",
      authorization: "Bearer sk-proj-1",
    }),
    salt: "salt",
  });
  assert.equal(fp.framework, "openai_agents");
  assert.equal(fp.kind, "agent_framework");
  assert.equal(fp.sdk, "python 1.99.0");
  assert.equal(fp.userAgent?.length, USER_AGENT_MAX_CHARS);
  assert.equal(fp.keyHash, hashCallerCredential("salt", "sk-proj-1"));

  const plain = fingerprintCaller({ headers: headers({ "user-agent": "Anthropic/Python 0.49.0" }), salt: null });
  assert.equal(plain.kind, "sdk");
  assert.equal(plain.sdk, "anthropic-python 0.49.0");
  assert.equal(plain.keyHash, null);
});
