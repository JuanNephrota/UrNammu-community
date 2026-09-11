import { test } from "node:test";
import assert from "node:assert/strict";
import {
  allowedToolNamesForServer,
  dedupeToolUses,
  evaluateServers,
  evaluateToolUses,
  extractAnthropicStreamToolUse,
  extractAnthropicToolUses,
  extractDeclaredMcpServers,
  extractOpenAIStreamToolUses,
  extractOpenAIToolUses,
  isServerAllowed,
  isToolAllowed,
  restrictAllowedTools,
  scopeKeyFor,
  summarizeMcpForMetadata,
  type McpGovernanceConfig,
} from "./mcp-tool-governance";

const config = (o: Partial<McpGovernanceConfig>): McpGovernanceConfig => ({
  serverAllowlist: [],
  toolAllowlist: [],
  enforcement: "monitor",
  ...o,
});

test("extracts declared servers from Anthropic and OpenAI request shapes", () => {
  const anthropic = extractDeclaredMcpServers({
    mcp_servers: [
      { type: "url", url: "https://mcp.example.com/sse", name: "jira", authorization_token: "x" },
      { type: "url", url: "https://tools.internal:8443/mcp", tool_configuration: { allowed_tools: ["read"] } },
    ],
  });
  assert.deepEqual(anthropic, [
    { name: "jira", url: "https://mcp.example.com/sse", host: "mcp.example.com", allowedTools: null },
    { name: "tools.internal:8443", url: "https://tools.internal:8443/mcp", host: "tools.internal:8443", allowedTools: ["read"] },
  ]);

  const openai = extractDeclaredMcpServers({
    tools: [
      { type: "mcp", server_label: "github", server_url: "https://api.githubcopilot.com/mcp/", allowed_tools: ["search_repositories"] },
      { type: "function", name: "lookup" },
    ],
  });
  assert.equal(openai.length, 1);
  assert.equal(openai[0].name, "github");
  assert.deepEqual(openai[0].allowedTools, ["search_repositories"]);

  assert.deepEqual(extractDeclaredMcpServers(null), []);
  assert.deepEqual(extractDeclaredMcpServers({ model: "x" }), []);
});

test("extracts observed tool uses from Anthropic responses and stream events", () => {
  const uses = extractAnthropicToolUses([
    { type: "text", text: "hi" },
    { type: "mcp_tool_use", id: "1", name: "search_issues", server_name: "jira", input: {} },
    { type: "server_tool_use", id: "2", name: "web_search", input: {} },
    { type: "tool_use", id: "3", name: "get_weather", input: {} },
    { type: "mcp_tool_result", tool_use_id: "1", content: [] },
  ]);
  assert.deepEqual(uses, [
    { kind: "mcp_tool_use", toolName: "search_issues", serverName: "jira" },
    { kind: "server_tool_use", toolName: "web_search", serverName: null },
    { kind: "tool_use", toolName: "get_weather", serverName: null },
  ]);

  assert.deepEqual(
    extractAnthropicStreamToolUse({ type: "content_block_start", index: 1, content_block: { type: "mcp_tool_use", name: "create_page", server_name: "notion" } }),
    { kind: "mcp_tool_use", toolName: "create_page", serverName: "notion" }
  );
  assert.equal(extractAnthropicStreamToolUse({ type: "content_block_delta", delta: { type: "text_delta", text: "x" } }), null);
  assert.equal(extractAnthropicStreamToolUse({ type: "content_block_start", content_block: { type: "text", text: "" } }), null);
});

test("extracts observed tool uses from OpenAI responses and streams", () => {
  const responses = extractOpenAIToolUses({
    output: [
      { type: "mcp_list_tools", server_label: "github", tools: [] },
      { type: "mcp_call", name: "search_repositories", server_label: "github" },
      { type: "web_search_call", status: "completed" },
      { type: "function_call", name: "lookup_order" },
      { type: "message", content: [] },
    ],
  });
  assert.deepEqual(responses, [
    { kind: "mcp_tool_use", toolName: "search_repositories", serverName: "github" },
    { kind: "server_tool_use", toolName: "web_search", serverName: null },
    { kind: "tool_use", toolName: "lookup_order", serverName: null },
  ]);

  const chat = extractOpenAIToolUses({
    choices: [{ message: { tool_calls: [{ type: "function", function: { name: "get_weather", arguments: "{}" } }] } }],
  });
  assert.deepEqual(chat, [{ kind: "tool_use", toolName: "get_weather", serverName: null }]);

  assert.deepEqual(
    extractOpenAIStreamToolUses({ type: "response.output_item.done", item: { type: "mcp_call", name: "x", server_label: "s" } }),
    [{ kind: "mcp_tool_use", toolName: "x", serverName: "s" }]
  );
  assert.deepEqual(
    extractOpenAIStreamToolUses({ choices: [{ delta: { tool_calls: [{ index: 0, function: { name: "f", arguments: "" } }] } }] }),
    [{ kind: "tool_use", toolName: "f", serverName: null }]
  );
  // Continuation chunks carry only argument fragments, no name.
  assert.deepEqual(extractOpenAIStreamToolUses({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: "{\"a\"" } }] } }] }), []);
});

test("server allowlist matches by name, host, URL, and wildcard; empty allows all", () => {
  const server = { name: "jira", host: "mcp.example.com" };
  assert.equal(isServerAllowed(server, []), true);
  assert.equal(isServerAllowed(server, ["JIRA"]), true);
  assert.equal(isServerAllowed(server, ["mcp.example.com"]), true);
  assert.equal(isServerAllowed(server, ["https://mcp.example.com/sse"]), true);
  assert.equal(isServerAllowed(server, ["*.example.com"]), true);
  assert.equal(isServerAllowed(server, ["notion", "*.other.com"]), false);
  assert.equal(isServerAllowed({ name: "x", host: null }, ["*.example.com"]), false);
});

test("tool allowlist grammar: bare, server/tool, server/*; non-MCP tools are never denied", () => {
  const cfg = config({ toolAllowlist: ["read_page", "jira/search_issues", "notion/*"] });
  const mcp = (serverName: string, toolName: string) => ({ kind: "mcp_tool_use" as const, toolName, serverName });
  assert.equal(isToolAllowed(mcp("anything", "read_page"), cfg), true);
  assert.equal(isToolAllowed(mcp("jira", "search_issues"), cfg), true);
  assert.equal(isToolAllowed(mcp("jira", "delete_issue"), cfg), false);
  assert.equal(isToolAllowed(mcp("notion", "delete_page"), cfg), true);
  assert.equal(isToolAllowed(mcp("github", "push"), cfg), false);
  assert.equal(isToolAllowed({ kind: "server_tool_use", toolName: "web_search", serverName: null }, cfg), true);
  assert.equal(isToolAllowed({ kind: "tool_use", toolName: "rm_rf", serverName: null }, cfg), true);
  // Empty tool allowlist allows everything.
  assert.equal(isToolAllowed(mcp("github", "push"), config({})), true);
  // A server allowlist alone still denies tools from unlisted servers.
  assert.equal(isToolAllowed(mcp("github", "push"), config({ serverAllowlist: ["jira"] })), false);
  assert.equal(isToolAllowed(mcp("jira", "push"), config({ serverAllowlist: ["jira"] })), true);
});

test("evaluateServers / evaluateToolUses return per-item verdicts", () => {
  const cfg = config({ serverAllowlist: ["jira"], toolAllowlist: ["jira/search_issues"] });
  const servers = extractDeclaredMcpServers({ mcp_servers: [{ url: "https://a", name: "jira" }, { url: "https://b", name: "notion" }] });
  assert.deepEqual(evaluateServers(servers, cfg).map((v) => v.allowed), [true, false]);
  const uses = [
    { kind: "mcp_tool_use" as const, toolName: "search_issues", serverName: "jira" },
    { kind: "mcp_tool_use" as const, toolName: "transition", serverName: "jira" },
  ];
  assert.deepEqual(evaluateToolUses(uses, cfg).map((v) => v.allowed), [true, false]);
});

test("allowedToolNamesForServer and restrictAllowedTools narrow the request without widening it", () => {
  const cfg = config({ toolAllowlist: ["jira/search_issues", "jira/get_issue", "read_page", "notion/*"] });
  assert.deepEqual(allowedToolNamesForServer("jira", cfg)?.sort(), ["get_issue", "read_page", "search_issues"]);
  assert.equal(allowedToolNamesForServer("notion", cfg), null); // server/* => unrestricted
  assert.deepEqual(allowedToolNamesForServer("github", cfg), ["read_page"]);
  assert.equal(allowedToolNamesForServer("jira", config({})), null);

  const body = {
    model: "claude",
    mcp_servers: [
      { type: "url", url: "https://j", name: "jira", authorization_token: "secret" },
      { type: "url", url: "https://n", name: "notion" },
      { type: "url", url: "https://g", name: "github", tool_configuration: { allowed_tools: ["read_page", "push"] } },
    ],
    tools: [{ type: "mcp", server_label: "jira", server_url: "https://j" }],
  };
  const { body: out, changed } = restrictAllowedTools(body, cfg);
  assert.equal(changed, true);
  const servers = out!.mcp_servers as Array<Record<string, unknown>>;
  assert.deepEqual((servers[0].tool_configuration as Record<string, unknown>).allowed_tools, ["search_issues", "get_issue", "read_page"]);
  assert.equal(servers[0].authorization_token, "secret"); // untouched
  assert.equal(servers[1].tool_configuration, undefined); // notion/* left alone
  assert.deepEqual((servers[2].tool_configuration as Record<string, unknown>).allowed_tools, ["read_page"]); // intersected, "push" dropped
  assert.deepEqual((out!.tools as Array<Record<string, unknown>>)[0].allowed_tools, ["search_issues", "get_issue", "read_page"]);
  // Original untouched.
  assert.equal((body.mcp_servers[0] as Record<string, unknown>).tool_configuration, undefined);

  assert.equal(restrictAllowedTools(body, config({})).changed, false);
  assert.equal(restrictAllowedTools(null, cfg).changed, false);
});

test("dedupe, scope keys and metadata summary", () => {
  const uses = [
    { kind: "mcp_tool_use" as const, toolName: "a", serverName: "s" },
    { kind: "mcp_tool_use" as const, toolName: "a", serverName: "s" },
    { kind: "tool_use" as const, toolName: "a", serverName: null },
  ];
  assert.equal(dedupeToolUses(uses).length, 2);
  assert.equal(scopeKeyFor("ag1", "sys1"), "agent:ag1");
  assert.equal(scopeKeyFor(null, "sys1"), "system:sys1");
  assert.equal(scopeKeyFor(null, null), "global");
  const summary = summarizeMcpForMetadata(
    extractDeclaredMcpServers({ mcp_servers: [{ url: "https://x", name: "s" }] }),
    uses
  );
  assert.deepEqual(summary, { declaredServers: ["s"], toolCalls: 3, tools: ["s/a", "a"] });
  assert.equal(summarizeMcpForMetadata([], []), undefined);
});
