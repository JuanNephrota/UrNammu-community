import { test } from "node:test";
import assert from "node:assert/strict";
import { applyMcpPassthrough } from "./mcp-passthrough";

function buildHeaders(entries: Record<string, string>): Headers {
  const h = new Headers();
  for (const [k, v] of Object.entries(entries)) h.set(k, v);
  return h;
}

test("returns detected:false when no MCP signals are present", () => {
  const fwd: Record<string, string> = { "x-api-key": "sk-org" };
  const result = applyMcpPassthrough(
    fwd,
    buildHeaders({ "anthropic-version": "2023-06-01" }),
    { model: "claude-sonnet-4-20250514" }
  );
  assert.equal(result.detected, false);
  assert.deepEqual(result.forwarded, []);
  assert.deepEqual(fwd, { "x-api-key": "sk-org" });
});

test("detects MCP via mcp_servers in the body and forwards Authorization", () => {
  const fwd: Record<string, string> = { "x-api-key": "sk-org" };
  const result = applyMcpPassthrough(
    fwd,
    buildHeaders({ Authorization: "Bearer client-token" }),
    {
      mcp_servers: [
        { type: "url", url: "https://mcp.example.com", name: "example" },
      ],
    }
  );
  assert.equal(result.detected, true);
  assert.equal(result.mcpServerCount, 1);
  assert.deepEqual(result.forwarded.map((s) => s.toLowerCase()), ["authorization"]);
  assert.equal(fwd["authorization"], "Bearer client-token");
});

test("detects MCP via anthropic-beta mcp-client token and forwards mcp-* headers", () => {
  const fwd: Record<string, string> = { "x-api-key": "sk-org" };
  const result = applyMcpPassthrough(
    fwd,
    buildHeaders({
      "anthropic-beta": "mcp-client-2025-04-04,prompt-caching-2024-07-31",
      "mcp-protocol-version": "2025-04-04",
      "MCP-Session-Id": "abc-123",
    }),
    null
  );
  assert.equal(result.detected, true);
  assert.equal(fwd["mcp-protocol-version"], "2025-04-04");
  // Headers normalized to lowercase by Web Headers API
  assert.equal(fwd["mcp-session-id"], "abc-123");
});

test("does not forward unrelated headers", () => {
  const fwd: Record<string, string> = { "x-api-key": "sk-org" };
  const result = applyMcpPassthrough(
    fwd,
    buildHeaders({
      "mcp-protocol-version": "2025-04-04",
      "x-custom-trace": "should-not-pass",
      cookie: "should-not-pass",
    }),
    null
  );
  assert.equal(result.detected, true);
  assert.equal(fwd["x-custom-trace"], undefined);
  assert.equal(fwd["cookie"], undefined);
});

test("preserves the proxy's own x-api-key (does not let client override)", () => {
  const fwd: Record<string, string> = { "x-api-key": "sk-org" };
  applyMcpPassthrough(
    fwd,
    buildHeaders({
      "x-api-key": "sk-client-trying-to-override",
      "mcp-protocol-version": "2025-04-04",
    }),
    null
  );
  assert.equal(fwd["x-api-key"], "sk-org");
});
