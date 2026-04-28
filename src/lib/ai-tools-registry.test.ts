import test from "node:test";
import assert from "node:assert/strict";
import { matchDomain, resolveAIToolMatch } from "./ai-tools-registry";

test("resolveAIToolMatch uses publisher and domain signals for Microsoft discoveries", () => {
  const result = resolveAIToolMatch({
    clientName: "Enterprise Chat Workspace",
    publisherName: "OpenAI",
    domains: ["chat.openai.com"],
    scopes: ["https://chat.openai.com/user.read"],
  });

  assert.ok(result);
  assert.equal(result?.tool.toolName, "ChatGPT");
  assert.equal(result?.confidence, "high");
});

test("resolveAIToolMatch recognizes Microsoft Copilot coverage", () => {
  const result = resolveAIToolMatch({
    clientName: "Copilot for Microsoft 365",
    publisherName: "Microsoft",
    domains: ["copilot.microsoft.com"],
  });

  assert.ok(result);
  assert.equal(result?.tool.toolName, "Microsoft Copilot");
});

test("matchDomain still supports direct domain fallback", () => {
  const result = matchDomain("console.mistral.ai");
  assert.equal(result?.toolName, "Mistral");
});
