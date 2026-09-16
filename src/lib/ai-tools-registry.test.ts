import test from "node:test";
import assert from "node:assert/strict";
import {
  AI_TOOL_CATEGORIES,
  AI_TOOL_CATEGORY_IDS,
  KNOWN_AI_TOOLS,
  categoryLabel,
  damerauLevenshtein,
  findKnownTool,
  isAIToolCategory,
  matchDomain,
  matchDomainHeuristic,
  normalizeToolName,
  resolveAIToolMatch,
  resolveToolCategory,
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

test("matchDomain recognizes the hostnames GitHub Copilot actually uses", () => {
  // These are what the IDE extensions resolve and what DNS/proxy logs record.
  for (const host of [
    "copilot-proxy.githubusercontent.com",
    "api.githubcopilot.com",
    "proxy.individual.githubcopilot.com",
    "copilot-telemetry.githubusercontent.com",
    "copilot.github.com",
  ]) {
    assert.equal(matchDomain(host)?.toolName, "GitHub Copilot", `${host} should match GitHub Copilot`);
  }
  // A URL path is not a hostname and can never be matched; it must not be in
  // the registry, and plain github.com traffic must not be flagged as Copilot.
  assert.equal(matchDomain("github.com"), null);
  assert.equal(matchDomain("raw.githubusercontent.com"), null);
});

test("matchDomain prefers the most specific registry host when several match", () => {
  // labs.openai.com is DALL·E even though openai.com belongs to ChatGPT.
  assert.equal(matchDomain("labs.openai.com")?.toolName, "DALL·E");
  assert.equal(matchDomain("api.openai.com")?.toolName, "ChatGPT");
  assert.equal(matchDomain("sora.chatgpt.com")?.toolName, "Sora");
  assert.equal(matchDomain("chatgpt.com")?.toolName, "ChatGPT");
});

// ---------- registry integrity ----------

test("registry has at least 120 entries", () => {
  assert.ok(
    KNOWN_AI_TOOLS.length >= 120,
    `expected >= 120 entries, found ${KNOWN_AI_TOOLS.length}`
  );
});

test("every registry entry has a domain and a valid category", () => {
  for (const tool of KNOWN_AI_TOOLS) {
    assert.ok(tool.domains.length >= 1, `${tool.toolName} has no domains`);
    assert.ok(
      isAIToolCategory(tool.category),
      `${tool.toolName} has invalid category ${String(tool.category)}`
    );
    assert.ok(tool.clientNamePatterns.length >= 1, `${tool.toolName} has no name patterns`);
    assert.ok(tool.vendor.trim().length > 0, `${tool.toolName} has no vendor`);
  }
});

test("registry domains are bare lowercase hostnames", () => {
  for (const tool of KNOWN_AI_TOOLS) {
    for (const domain of tool.domains) {
      assert.ok(!domain.includes("/"), `${tool.toolName}: "${domain}" contains a path`);
      assert.equal(domain, domain.toLowerCase(), `${tool.toolName}: "${domain}" has uppercase`);
      assert.ok(!/\s/.test(domain), `${tool.toolName}: "${domain}" contains whitespace`);
      assert.ok(!domain.includes("://"), `${tool.toolName}: "${domain}" contains a scheme`);
      assert.ok(domain.includes("."), `${tool.toolName}: "${domain}" is not a hostname`);
      assert.ok(!domain.startsWith("www."), `${tool.toolName}: "${domain}" — www. is stripped from input`);
    }
  }
});

test("registry toolNames are unique (case-insensitive)", () => {
  const seen = new Map<string, string>();
  for (const tool of KNOWN_AI_TOOLS) {
    const key = tool.toolName.toLowerCase();
    assert.ok(!seen.has(key), `duplicate toolName: "${tool.toolName}" and "${seen.get(key)}"`);
    seen.set(key, tool.toolName);
  }
});

test("category catalog exposes labels for every id", () => {
  assert.equal(AI_TOOL_CATEGORIES.length, AI_TOOL_CATEGORY_IDS.length);
  for (const { id, label } of AI_TOOL_CATEGORIES) {
    assert.ok(isAIToolCategory(id));
    assert.ok(label.length > 0);
    assert.equal(categoryLabel(id), label);
  }
  assert.equal(categoryLabel(null), "Uncategorized");
  assert.equal(categoryLabel("not_a_category"), "Uncategorized");
  assert.equal(isAIToolCategory("chat_assistant"), true);
  assert.equal(isAIToolCategory("chat-assistant"), false);
});

test("resolveToolCategory resolves by registry name, then by domain", () => {
  assert.equal(resolveToolCategory({ toolName: "ChatGPT" }), "chat_assistant");
  assert.equal(resolveToolCategory({ toolName: "github copilot" }), "coding_assistant");
  assert.equal(resolveToolCategory({ toolName: "unknown", domain: "api.elevenlabs.io" }), "audio_voice");
  assert.equal(resolveToolCategory({ toolName: "brandnewtool.ai", domain: "brandnewtool.ai" }), null);
  assert.equal(findKnownTool("Perplexity")?.category, "search");
  assert.equal(findKnownTool(null), null);
});

// ---------- fuzzy name matching ----------

test("normalizeToolName lowercases, strips punctuation and filler tokens", () => {
  assert.deepEqual(normalizeToolName("Character.ai"), ["character"]);
  assert.deepEqual(normalizeToolName("The Jasper AI App, Inc."), ["jasper"]);
  assert.deepEqual(normalizeToolName("Github Co-pilot"), ["github", "co", "pilot"]);
  assert.deepEqual(normalizeToolName("AI Inc LLC"), []);
});

test("damerauLevenshtein counts insert, delete, substitute and transpose as one edit", () => {
  assert.equal(damerauLevenshtein("perplexity", "perplexity"), 0);
  assert.equal(damerauLevenshtein("perplexity", "perplexty"), 1); // deletion
  assert.equal(damerauLevenshtein("midjourney", "midjournay"), 1); // substitution
  assert.equal(damerauLevenshtein("grammarly", "grammarlyy"), 1); // insertion
  assert.equal(damerauLevenshtein("claude", "cluade"), 1); // transposition
  assert.equal(damerauLevenshtein("claude", "gemini"), 6);
  assert.equal(damerauLevenshtein("", "abc"), 3);
});

test("fuzzy positives resolve to the right tool", () => {
  const cases: Array<[string, string]> = [
    ["Chat GPT", "ChatGPT"],
    ["Perplexty", "Perplexity"],
    ["mid journey", "Midjourney"],
    ["Github Co-pilot", "GitHub Copilot"],
  ];
  for (const [input, expected] of cases) {
    const result = resolveAIToolMatch({ clientName: input });
    assert.ok(result, `"${input}" should match`);
    assert.equal(result.tool.toolName, expected, `"${input}" -> ${result.tool.toolName}`);
  }
});

test("fuzzy hits score +4 and record a fuzzy_name reason; exact names keep +6", () => {
  const typo = resolveAIToolMatch({ clientName: "Perplexty" });
  assert.ok(typo);
  assert.equal(typo.score, 4);
  assert.ok(typo.reasons.includes("fuzzy_name:perplexty"), typo.reasons.join("; "));

  const split = resolveAIToolMatch({ clientName: "mid journey" });
  assert.ok(split);
  assert.ok(split.reasons.some((r) => r.startsWith("fuzzy_name:")), split.reasons.join("; "));

  const hyphen = resolveAIToolMatch({ clientName: "Github Co-pilot" });
  assert.ok(hyphen);
  assert.ok(hyphen.reasons.some((r) => r === "fuzzy_name:github copilot"), hyphen.reasons.join("; "));

  const exact = resolveAIToolMatch({ clientName: "Perplexity" });
  assert.ok(exact);
  assert.ok(exact.reasons.some((r) => r.startsWith("name matched")));
  assert.ok(!exact.reasons.some((r) => r.startsWith("fuzzy_name:")));
  assert.ok(exact.score >= 6);
});

test("fuzzy negatives never produce a name-based match", () => {
  for (const input of ["google", "microsoft", "slack"]) {
    const result = resolveAIToolMatch({ clientName: input });
    if (result) {
      // A bare vendor name may still hit a publisher pattern; that is the
      // pre-existing publisher signal, which endpoint scanners reject on its
      // own. It must not be dressed up as a name match.
      assert.ok(
        result.reasons.every((r) => r.startsWith("publisher matched")),
        `"${input}" produced a name match: ${result.reasons.join("; ")}`
      );
    }
  }
  assert.equal(resolveAIToolMatch({ clientName: "slack" }), null);
});

test("fuzzy matching ignores plain-word collisions and short tokens", () => {
  for (const input of ["Beautiful Weather", "Meta Quest", "Studio", "Sparkling Water", "Modify", "Continue"]) {
    const result = resolveAIToolMatch({ clientName: input });
    assert.equal(result, null, `"${input}" should not match (got ${result?.tool.toolName})`);
  }
});

test("fuzzy matching never looks at the publisher name", () => {
  // Publisher alone: no name signal, so endpoint scanners can reject it.
  const result = resolveAIToolMatch({ clientName: "Some Utility", publisherName: "Anthropc" });
  assert.ok(!result || result.reasons.every((r) => !r.startsWith("fuzzy_name:")));
});

test("on equal scores the more specific name pattern wins", () => {
  assert.equal(resolveAIToolMatch({ clientName: "OpenAI Codex" })?.tool.toolName, "OpenAI Codex");
  assert.equal(resolveAIToolMatch({ clientName: "Microsoft 365 Copilot" })?.tool.toolName, "Microsoft Copilot");
  assert.equal(resolveAIToolMatch({ clientName: "Gemini Code Assist" })?.tool.toolName, "Gemini Code Assist");
  assert.equal(resolveAIToolMatch({ clientName: "Ollama" })?.tool.toolName, "Ollama");
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
  assert.equal(result.tool.category, "other");
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
