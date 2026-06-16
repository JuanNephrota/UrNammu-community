import test from "node:test";
import assert from "node:assert/strict";
import {
  matchDomain,
  matchDomainHeuristic,
  resolveAIToolMatch,
} from "./ai-tools-registry";

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

// ---------- matchDomainHeuristic (DNS/proxy low-confidence fallback) ----------

test("matchDomainHeuristic returns null for domains the registry already covers", () => {
  assert.equal(matchDomainHeuristic("chat.openai.com"), null);
  assert.equal(matchDomainHeuristic("claude.ai"), null);
  // Sanity: the registry does cover these.
  assert.ok(matchDomain("chat.openai.com"));
  assert.ok(matchDomain("claude.ai"));
});

test("matchDomainHeuristic flags unknown .ai domains as low confidence", () => {
  const result = matchDomainHeuristic("brandnewtool.ai");
  assert.ok(result);
  assert.equal(result.confidence, "low");
  assert.equal(result.tool.vendor, "Needs Review");
  assert.equal(result.tool.toolName, "brandnewtool.ai");
  assert.ok(result.reasons.some((r) => r.includes(".ai top-level domain")));
});

test("matchDomainHeuristic flags AI keyword labels", () => {
  for (const domain of ["ai.acme.com", "acme-ai.com", "chatbot.example.com"]) {
    const result = matchDomainHeuristic(domain);
    assert.ok(result, `${domain} should match`);
    assert.equal(result.confidence, "low");
  }
});

test("matchDomainHeuristic flags distinctive substrings", () => {
  for (const domain of ["mygptapp.com", "tryperplexity.io", "somellmtool.dev"]) {
    const result = matchDomainHeuristic(domain);
    assert.ok(result, `${domain} should match`);
  }
});

test("matchDomainHeuristic does not flag ordinary domains", () => {
  for (const domain of [
    "airfrance.com", // "ai" substring must not trigger
    "mail.google.com",
    "github.com",
    "fountain.com", // contains "ai" inside a label
    "example.com",
    "maintenance.acme.com",
  ]) {
    assert.equal(matchDomainHeuristic(domain), null, `${domain} should not match`);
  }
});

test("matchDomainHeuristic ignores garbage input", () => {
  assert.equal(matchDomainHeuristic(""), null);
  assert.equal(matchDomainHeuristic("localhost"), null);
  assert.equal(matchDomainHeuristic("   "), null);
});
