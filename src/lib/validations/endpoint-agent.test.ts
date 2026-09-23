import test from "node:test";
import assert from "node:assert/strict";
import {
  countReportObservations,
  endpointEnrollSchema,
  endpointReportSchema,
} from "./endpoint-agent";

const now = new Date().toISOString();

function report(overrides: Record<string, unknown> = {}) {
  return {
    reportId: "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
    machineId: "TEST-MACHINE-UUID-0001",
    collectedAt: now,
    ...overrides,
  };
}

test("a minimal report parses and defaults every collector to empty", () => {
  const parsed = endpointReportSchema.parse(report());
  assert.deepEqual(parsed.apps, []);
  assert.deepEqual(parsed.browser, []);
  assert.deepEqual(parsed.network, []);
  assert.deepEqual(parsed.runtimes, []);
  assert.equal(countReportObservations(parsed), 0);
});

// The wire contract's whole point: nothing resembling content may be
// expressible. A hostname field that accepted a URL would be a hole straight
// through the agent's privacy story, so it is checked explicitly.
test("domain fields reject anything that is not a bare hostname", () => {
  const rejected = [
    "https://chatgpt.com/c/secret-conversation",
    "chatgpt.com/c/secret",
    "chatgpt.com?q=my+prompt",
    "user:pass@claude.ai",
    "claude.ai:443",
    "localhost",
    "not a host",
    "",
  ];

  for (const domain of rejected) {
    const result = endpointReportSchema.safeParse(
      report({ network: [{ domain, count: 1, firstSeen: now, lastSeen: now }] }),
    );
    assert.equal(result.success, false, `expected ${JSON.stringify(domain)} to be rejected`);
  }
});

test("domain fields accept and normalize real hostnames", () => {
  const parsed = endpointReportSchema.parse(
    report({
      network: [
        { domain: "API.OpenAI.com", count: 3, firstSeen: now, lastSeen: now },
      ],
    }),
  );
  assert.equal(parsed.network[0].domain, "api.openai.com");
});

test("browser observations carry a host and a count, never a URL", () => {
  const parsed = endpointReportSchema.parse(
    report({
      browser: [
        { domain: "claude.ai", browser: "chrome", visits: 12, firstSeen: now, lastSeen: now },
      ],
    }),
  );
  assert.equal(parsed.browser[0].domain, "claude.ai");
  assert.equal(parsed.browser[0].visits, 12);
  // There is no field on the parsed shape that could hold a path or a title.
  assert.deepEqual(Object.keys(parsed.browser[0]).sort(), [
    "browser",
    "domain",
    "firstSeen",
    "lastSeen",
    "visits",
  ]);
});

test("a null collector array is rejected rather than silently defaulted", () => {
  // Go marshals a nil slice as `null` and Zod defaults only fire on
  // `undefined`. This asserts the strict behaviour the agent is written
  // against, so the two halves cannot drift apart unnoticed.
  const result = endpointReportSchema.safeParse(report({ runtimes: null }));
  assert.equal(result.success, false);
});

test("runtime observations require a plausible port", () => {
  for (const port of [0, -1, 70000]) {
    const result = endpointReportSchema.safeParse(
      report({ runtimes: [{ runtime: "ollama", port, firstSeen: now, lastSeen: now }] }),
    );
    assert.equal(result.success, false, `expected port ${port} to be rejected`);
  }

  const ok = endpointReportSchema.parse(
    report({
      runtimes: [
        { runtime: "ollama", port: 11434, models: ["llama3.1:8b"], firstSeen: now, lastSeen: now },
      ],
    }),
  );
  assert.deepEqual(ok.runtimes[0].models, ["llama3.1:8b"]);
});

test("countReportObservations totals every collector", () => {
  const parsed = endpointReportSchema.parse(
    report({
      apps: [{ name: "Ollama", firstSeen: now, lastSeen: now }],
      browser: [
        { domain: "claude.ai", browser: "chrome", visits: 1, firstSeen: now, lastSeen: now },
      ],
      network: [{ domain: "api.openai.com", count: 1, firstSeen: now, lastSeen: now }],
      runtimes: [{ runtime: "ollama", port: 11434, firstSeen: now, lastSeen: now }],
    }),
  );
  assert.equal(countReportObservations(parsed), 4);
});

test("enrollment requires a stable machine id and a known platform", () => {
  assert.equal(
    endpointEnrollSchema.safeParse({
      machineId: "short",
      hostname: "x",
      platform: "darwin",
    }).success,
    false,
  );

  assert.equal(
    endpointEnrollSchema.safeParse({
      machineId: "878AE90D-0000-0000-0000-000000000000",
      hostname: "laptop",
      platform: "linux",
    }).success,
    false,
    "linux is not a supported platform",
  );

  const ok = endpointEnrollSchema.parse({
    machineId: "878AE90D-0000-0000-0000-000000000000",
    hostname: "laptop",
    platform: "darwin",
    userEmail: "person@example.com",
  });
  assert.equal(ok.platform, "darwin");
});

// ─── MCP servers and agent frameworks ────────────────────

// Assembled at runtime so the repo's secret scanner does not flag a fixture.
// Split so the repo secret scanner does not match a fake.
const FAKE_ANTHROPIC_KEY = ["sk", "ant", "api03", "abcdefgh12345678"].join("-");
const FAKE_GITHUB_TOKEN = ["ghp", "abcdefghijklmnopqrstuvwxyz0123456789"].join("_");

function mcp(overrides: Record<string, unknown> = {}) {
  return { client: "claude_desktop", name: "github", transport: "stdio", ...overrides };
}

test("reports from agents without the agents collector still validate", () => {
  // Older agents never send mcpServers/agentFrameworks; both default to [].
  const parsed = endpointReportSchema.parse(report());
  assert.deepEqual(parsed.mcpServers, []);
  assert.deepEqual(parsed.agentFrameworks, []);
});

test("well-formed MCP servers and frameworks parse", () => {
  const parsed = endpointReportSchema.parse(
    report({
      mcpServers: [
        mcp({ launcher: "npx", package: "@modelcontextprotocol/server-github" }),
        mcp({ name: "fetch", launcher: "uvx", package: "mcp-server-fetch" }),
        mcp({ name: "gh", launcher: "docker", package: "github/github-mcp-server" }),
        mcp({ name: "local", launcher: "binary" }),
        mcp({ name: "redacted-0a1b2c3d", launcher: "node" }),
        mcp({ client: "codex", name: "notion", transport: "http", host: "MCP.Notion.com" }),
        mcp({ client: "zed", name: "figma", transport: "http", loopback: true }),
      ],
      agentFrameworks: [
        { framework: "langgraph", ecosystem: "python", source: "pipx", count: 2 },
        { framework: "some_future_sdk", ecosystem: "node", source: "npm_global" },
      ],
    }),
  );
  assert.equal(parsed.mcpServers.length, 7);
  assert.equal(parsed.mcpServers[5].host, "mcp.notion.com");
  assert.equal(parsed.mcpServers[0].loopback, false);
  assert.equal(parsed.agentFrameworks[1].count, 1);
  assert.equal(countReportObservations(parsed), 9);
  // Nothing on the parsed shape can hold args, env, headers, a URL or a path.
  assert.deepEqual(Object.keys(parsed.mcpServers[0]).sort(), [
    "client",
    "launcher",
    "loopback",
    "name",
    "package",
    "transport",
  ]);
});

test("MCP server fields reject URLs, paths, env strings and credentials", () => {
  const rejected: Array<[string, Record<string, unknown>]> = [
    // host must be a bare hostname
    ["url as host", mcp({ transport: "http", host: "https://mcp.example.com/mcp?token=abc" })],
    ["host with path", mcp({ transport: "http", host: "mcp.example.com/mcp" })],
    ["host with creds", mcp({ transport: "http", host: "user:pass@mcp.example.com" })],
    // package ids
    ["package with version", mcp({ launcher: "npx", package: "@scope/pkg@1.2.3" })],
    ["package path", mcp({ launcher: "node", package: "/Users/alice/server.js" })],
    ["relative path", mcp({ launcher: "npx", package: "./server.js" })],
    ["windows path", mcp({ launcher: "npx", package: "C:\\Users\\alice\\server" })],
    ["package url", mcp({ launcher: "npx", package: "https://registry.example.com/x.tgz" })],
    ["git spec", mcp({ launcher: "npx", package: "github:alice/private" })],
    ["env as package", mcp({ launcher: "npx", package: "API_KEY=sk-abc" })],
    ["spaces", mcp({ launcher: "npx", package: "pkg --token abc" })],
    ["deep path", mcp({ launcher: "docker", package: "a/b/c" })],
    ["secret package", mcp({ launcher: "npx", package: FAKE_GITHUB_TOKEN })],
    ["pypi with slash", mcp({ launcher: "uvx", package: "owner/pkg" })],
    ["docker with scope", mcp({ launcher: "docker", package: "@scope/img" })],
    ["npm namespace w/o scope", mcp({ launcher: "npx", package: "owner/pkg" })],
    ["package on a binary", mcp({ launcher: "binary", package: "anything" })],
    ["package without launcher", mcp({ package: "pkg" })],
    // names
    ["url as name", mcp({ name: "https://evil.example.com/x" })],
    ["path as name", mcp({ name: "/Users/alice/secret" })],
    ["env as name", mcp({ name: "TOKEN=abc" })],
    ["credential as name", mcp({ name: FAKE_GITHUB_TOKEN })],
    ["long mixed token", mcp({ name: "AbCdEfGhIjKlMnOpQrStUvWxYz0123456789" })],
    ["overlong name", mcp({ name: "a".repeat(65) })],
    // shape rules
    ["remote with package", mcp({ transport: "http", host: "mcp.example.com", launcher: "npx", package: "x" })],
    ["stdio with host", mcp({ host: "mcp.example.com" })],
    ["unknown client", mcp({ client: "my_editor" })],
    ["unknown transport", mcp({ transport: "carrier-pigeon" })],
    ["unknown launcher", mcp({ launcher: "/usr/local/bin/npx" })],
    // review findings: secrets after a separator, lowercase hex, secret host labels
    ["bearer after space", mcp({ name: `Bearer ${FAKE_ANTHROPIC_KEY}` })],
    ["lowercase hex token", mcp({ name: "3f9a1c7e5b2d4f6a8c0e1b3d5f7a9c1e3b5d7f9a" })],
    ["srv-hex", mcp({ name: "srv-3f9a1c7e5b2d4f6a8c0e1b3d5f7a9c1e" })],
    ["hex package", mcp({ launcher: "npx", package: "3f9a1c7e5b2d4f6a8c0e1b3d5f7a9c1e" })],
    ["secret host label", mcp({ transport: "http", host: `${FAKE_ANTHROPIC_KEY}.example.com` })],
    ["hex host label", mcp({ transport: "http", host: "3f9a1c7e5b2d4f6a8c0e1b3d5f7a.mcp.example.com" })],
    ["tunnel user", mcp({ transport: "http", host: "jdoe.ngrok.io" })],
  ];
  for (const [label, server] of rejected) {
    // Invalid items are dropped, never stored, and the report still lands.
    const result = endpointReportSchema.safeParse(report({ mcpServers: [server, mcp({})] }));
    assert.equal(result.success, true, `"${label}" should not fail the whole report`);
    if (result.success) {
      assert.equal(result.data.mcpServers.length, 1, `expected "${label}" to be dropped`);
      assert.equal(result.data.droppedAgentItems, 1);
    }
  }
});

test("dropping items marks the agents collector partial so nothing is cleared", () => {
  const parsed = endpointReportSchema.parse(
    report({ mcpServers: [mcp({ client: "kiro_from_the_future" })], collectors: { agents: { ok: true } } }),
  );
  assert.equal(parsed.mcpServers.length, 0);
  assert.equal(parsed.collectors.agents?.reason, "dropped_invalid_items");
  const clean = endpointReportSchema.parse(report({ mcpServers: [mcp({})], collectors: { agents: { ok: true } } }));
  assert.equal(clean.collectors.agents?.reason ?? null, null);
  assert.equal(
    endpointReportSchema.parse(report({ mcpServers: [mcp({ transport: "http", host: "ngrok.io" })] })).mcpServers.length,
    1,
    "a bare tunnel suffix is fine",
  );
});

test("MCP server extra keys are dropped, not stored", () => {
  const parsed = endpointReportSchema.parse(
    report({
      mcpServers: [
        {
          ...mcp({ launcher: "npx", package: "pkg" }),
          args: ["--token", "secret"],
          env: { API_KEY: "secret" },
          url: "https://x.example.com/?t=secret",
        },
      ],
    }),
  );
  const serialized = JSON.stringify(parsed.mcpServers);
  assert.equal(serialized.includes("secret"), false);
});

test("framework entries reject paths and unknown location kinds", () => {
  const rejected = [
    { framework: "../../etc", ecosystem: "python", source: "pipx" },
    { framework: "LangGraph", ecosystem: "python", source: "pipx" },
    { framework: "langgraph", ecosystem: "ruby", source: "pipx" },
    { framework: "langgraph", ecosystem: "python", source: "/Users/alice/venv" },
    { framework: "langgraph", ecosystem: "python", source: "pipx", count: 0 },
  ];
  for (const fw of rejected) {
    const result = endpointReportSchema.safeParse(report({ agentFrameworks: [fw] }));
    assert.equal(result.success, true, `${JSON.stringify(fw)} should not fail the whole report`);
    if (result.success) assert.equal(result.data.agentFrameworks.length, 0, `expected ${JSON.stringify(fw)} to be dropped`);
  }
  assert.equal(
    endpointReportSchema.safeParse(report({ mcpServers: null })).success,
    false,
    "a null mcpServers array is rejected like the other collectors",
  );
});
