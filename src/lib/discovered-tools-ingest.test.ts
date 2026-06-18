import test from "node:test";
import assert from "node:assert/strict";
import { normalizeDomain, parseEntriesFromCsv } from "./discovered-tools-ingest";
import { matchDomain } from "./ai-tools-registry";

test("parseEntriesFromCsv uses generic headers for dns proxy imports", () => {
  const entries = parseEntriesFromCsv(
    "domain,user,department,count\nchat.openai.com,alice@example.com,Legal,4\nclaude.ai,bob@example.com,Security,2",
    "dns_proxy"
  );

  assert.deepEqual(entries, [
    {
      domain: "chat.openai.com",
      user: "alice@example.com",
      department: "Legal",
      count: 4,
    },
    {
      domain: "claude.ai",
      user: "bob@example.com",
      department: "Security",
      count: 2,
    },
  ]);
});

test("parseEntriesFromCsv maps Cisco Umbrella-style identity and query fields", () => {
  const entries = parseEntriesFromCsv(
    "Query Name,Most Granular Identity,Group,Count\nchat.openai.com,jane@example.com,Finance,8",
    "umbrella"
  );

  assert.deepEqual(entries, [
    {
      domain: "chat.openai.com",
      user: "jane@example.com",
      department: "Finance",
      count: 8,
    },
  ]);
});

test("parseEntriesFromCsv maps Cloudflare Gateway host and email fields", () => {
  const entries = parseEntriesFromCsv(
    "Host,Email,Team,Requests\nclaude.ai,ops@example.com,Platform,12",
    "cloudflare_gateway"
  );

  assert.deepEqual(entries, [
    {
      domain: "claude.ai",
      user: "ops@example.com",
      department: "Platform",
      count: 12,
    },
  ]);
});

test("parseEntriesFromCsv falls back to actor identifiers when user columns are absent", () => {
  const entries = parseEntriesFromCsv(
    "Domain,Device Name,Count\nchat.openai.com,HOST-17,3",
    "other"
  );

  assert.deepEqual(entries, [
    {
      domain: "chat.openai.com",
      user: "HOST-17",
      department: undefined,
      count: 3,
    },
  ]);
});

test("normalizeDomain reduces messy web-proxy values to a bare hostname", () => {
  // Clean inputs pass through unchanged (idempotent).
  assert.equal(normalizeDomain("claude.ai"), "claude.ai");
  assert.equal(normalizeDomain("  CHAT.OpenAI.com  "), "chat.openai.com");

  // Full request URLs — the shape secure web gateways (Zscaler, Netskope) log.
  assert.equal(
    normalizeDomain("https://chat.openai.com/c/abc-123?model=gpt-4"),
    "chat.openai.com"
  );
  // Scheme-less host+path, host:port, userinfo.
  assert.equal(normalizeDomain("chat.openai.com/c/abc123"), "chat.openai.com");
  assert.equal(normalizeDomain("claude.ai:443"), "claude.ai");
  assert.equal(normalizeDomain("perplexity.ai:443/search"), "perplexity.ai");
  assert.equal(normalizeDomain("user:pass@gemini.google.com/app"), "gemini.google.com");

  // Wildcard policy rules, leading/trailing dots, www, quotes, annotations.
  assert.equal(normalizeDomain("*.openai.com"), "openai.com");
  assert.equal(normalizeDomain(".www.midjourney.com"), "midjourney.com");
  assert.equal(normalizeDomain("claude.ai."), "claude.ai");
  assert.equal(normalizeDomain("chat.openai.com (allowed)"), "chat.openai.com");
  assert.equal(normalizeDomain('"perplexity.ai"'), "perplexity.ai");

  // Unusable input.
  assert.equal(normalizeDomain(""), null);
  assert.equal(normalizeDomain("   "), null);
});

test("normalizeDomain output resolves against the known-tools registry", () => {
  // The payoff: every messy shape a proxy emits for ChatGPT must still match.
  for (const raw of [
    "https://chat.openai.com/c/abc?x=1",
    "chat.openai.com/c/abc",
    "chat.openai.com:443",
    "*.openai.com",
    "WWW.OpenAI.com",
  ]) {
    const normalized = normalizeDomain(raw);
    assert.ok(normalized, `expected a hostname for "${raw}"`);
    assert.equal(matchDomain(normalized!)?.toolName, "ChatGPT", `match failed for "${raw}"`);
  }
});

test("parseEntriesFromCsv normalizes full URLs and host:port in a mapped column", () => {
  const entries = parseEntriesFromCsv(
    "url,user,requests\nhttps://chat.openai.com/c/abc,alice@acme.com,12\nclaude.ai:443,bob@acme.com,3",
    "zscaler"
  );

  assert.deepEqual(entries, [
    { domain: "chat.openai.com", user: "alice@acme.com", department: undefined, count: 12 },
    { domain: "claude.ai", user: "bob@acme.com", department: undefined, count: 3 },
  ]);
});
