import test from "node:test";
import assert from "node:assert/strict";
import {
  aggregateExtensionObservations,
  extractClaudeCodeExtension,
  extractClaudeCodeExtensions,
  extractCursorExtension,
  isThirdPartyPlugin,
  type ExtensionEventInput,
  type ExtensionSpanInput,
} from "./assistant-extensions";

const at = (iso: string) => new Date(iso);

function event(
  eventName: string,
  attributes: Record<string, unknown>,
  overrides: Partial<ExtensionEventInput> = {},
): ExtensionEventInput {
  return {
    eventName,
    timestamp: at("2026-11-10T10:00:00Z"),
    sessionId: "sess-1",
    userId: "u1",
    userEmail: "Dev@Example.com",
    appVersion: "2.1.320",
    attributes,
    ...overrides,
  };
}

test("plugin_loaded becomes a plugin row keyed by its id hash, with provenance", () => {
  const obs = extractClaudeCodeExtension(
    event("plugin_loaded", {
      "plugin.name": "aikido",
      "marketplace.name": "claude-plugins-official",
      "plugin.version": "1.2.11",
      "plugin.scope": "official",
      enabled_via: "user-install",
      plugin_id_hash: "abc123",
      has_hooks: true,
      has_mcp: true,
      skill_path_count: 3,
    }),
  );
  assert.ok(obs);
  assert.equal(obs.kind, "plugin");
  assert.equal(obs.key, "hash:abc123");
  assert.equal(obs.name, "aikido");
  assert.equal(obs.redacted, false);
  assert.equal(obs.userEmail, "dev@example.com");
  assert.equal(obs.source, "official");
  assert.equal(obs.enabledVia, "user-install");
  assert.equal(obs.version, "1.2.11");
  assert.deepEqual(obs.detail, { hasHooks: true, hasMcp: true, skillPaths: 3 });
});

test("a redacted third-party plugin is flagged, and the hash still identifies it", () => {
  const obs = extractClaudeCodeExtension(
    event("plugin_loaded", {
      "plugin.name": "third-party",
      "marketplace.name": "third-party",
      "plugin.scope": "community",
      plugin_id_hash: "deadbeef",
    }),
  );
  assert.ok(obs);
  assert.equal(obs.redacted, true);
  assert.equal(obs.key, "hash:deadbeef");
  assert.equal(isThirdPartyPlugin(obs), true);
});

test("mcp_server_connection without a server name is an unnamed, redacted row", () => {
  const obs = extractClaudeCodeExtension(
    event("mcp_server_connection", {
      status: "failed",
      transport_type: "stdio",
      server_scope: "project",
      is_plugin: false,
      error_code: "ENOENT",
    }),
  );
  assert.ok(obs);
  assert.equal(obs.kind, "mcp_server");
  assert.equal(obs.redacted, true);
  assert.equal(obs.key, "unnamed:stdio:project");
  assert.equal(obs.failed, true);
  assert.equal(obs.status, "failed");
  assert.equal(obs.transport, "stdio");
  assert.equal(obs.source, "project");
  assert.deepEqual(obs.detail, { isPlugin: false, lastErrorCode: "ENOENT" });
});

test("mcp_server_connection with a server name keys on the name; plugin servers carry the owning plugin", () => {
  const named = extractClaudeCodeExtension(
    event("mcp_server_connection", {
      status: "connected",
      transport_type: "http",
      server_scope: "user",
      server_name: "github",
      is_plugin: false,
    }),
  );
  assert.ok(named);
  assert.equal(named.key, "server:github");
  assert.equal(named.name, "github");
  assert.equal(named.redacted, false);

  const fromPlugin = extractClaudeCodeExtension(
    event("mcp_server_connection", {
      status: "connected",
      transport_type: "stdio",
      server_scope: "user",
      is_plugin: true,
      "plugin.name": "aikido",
      plugin_id_hash: "abc123",
    }),
  );
  assert.ok(fromPlugin);
  assert.equal(fromPlugin.key, "plugin:abc123");
  assert.equal(fromPlugin.name, "aikido plugin server");
  assert.equal(fromPlugin.pluginName, "aikido");
  assert.equal(fromPlugin.redacted, true);
});

test("skill, hook and subagent events map to their kinds with placeholder detection", () => {
  const skill = extractClaudeCodeExtension(
    event("skill_activated", {
      "skill.name": "custom_skill",
      "skill.source": "userSettings",
      invocation_trigger: "user-slash",
    }),
  );
  assert.ok(skill);
  assert.equal(skill.kind, "skill");
  assert.equal(skill.redacted, true);
  assert.equal(skill.key, "userSettings:custom_skill");
  assert.deepEqual(skill.detail, { lastTrigger: "user-slash" });

  const pluginSkill = extractClaudeCodeExtension(
    event("skill_activated", {
      "skill.name": "code-review",
      "skill.source": "plugin",
      "plugin.name": "claude-code-tools",
      "marketplace.name": "claude-plugins-official",
    }),
  );
  assert.ok(pluginSkill);
  assert.equal(pluginSkill.key, "plugin:claude-code-tools:code-review");
  assert.equal(pluginSkill.redacted, false);
  assert.equal(pluginSkill.pluginName, "claude-code-tools");

  const hook = extractClaudeCodeExtension(
    event("hook_registered", {
      hook_event: "PreToolUse",
      hook_type: "command",
      hook_source: "projectSettings",
      hook_matcher: "Bash",
    }),
  );
  assert.ok(hook);
  assert.equal(hook.kind, "hook");
  assert.equal(hook.name, "PreToolUse (command)");
  assert.equal(hook.key, "projectSettings:PreToolUse:command:");
  assert.equal(hook.redacted, false);
  assert.deepEqual(hook.detail, { hookEvent: "PreToolUse", hookType: "command", matcher: "Bash" });

  const pluginHook = extractClaudeCodeExtension(
    event("hook_registered", {
      hook_event: "Stop",
      hook_type: "command",
      hook_source: "pluginHook",
      "plugin.name": "third-party",
      plugin_id_hash: "h1",
    }),
  );
  assert.ok(pluginHook);
  assert.equal(pluginHook.redacted, true);
  assert.equal(pluginHook.key, "pluginHook:Stop:command:h1");

  const agent = extractClaudeCodeExtension(
    event("subagent_completed", {
      agent_type: "Explore",
      "agent.source": "built-in",
      is_built_in: true,
      total_tool_uses: 12,
    }),
  );
  assert.ok(agent);
  assert.equal(agent.kind, "agent");
  assert.equal(agent.key, "built-in:Explore");
  assert.deepEqual(agent.detail, { builtIn: true });
});

test("events that are not about extensions are ignored", () => {
  assert.equal(extractClaudeCodeExtension(event("tool_result", { tool_name: "mcp_tool" })), null);
  assert.equal(extractClaudeCodeExtension(event("user_prompt", {})), null);
  assert.equal(extractClaudeCodeExtension(event("api_request", { "mcp_server.name": "custom" })), null);
});

test("cursor MCP spans name the server from the metadata key or the dotted tool name", () => {
  const span = (overrides: Partial<ExtensionSpanInput>): ExtensionSpanInput => ({
    hookEvent: "beforeMCPExecution",
    timestamp: at("2026-11-10T11:00:00Z"),
    sessionId: "cs-1",
    userId: null,
    userEmail: null,
    appVersion: "1.7.0",
    genAiToolName: "github.list_issues",
    success: null,
    attributes: {},
    ...overrides,
  });

  const fromTool = extractCursorExtension(span({}));
  assert.ok(fromTool);
  assert.equal(fromTool.client, "cursor");
  assert.equal(fromTool.kind, "mcp_server");
  assert.equal(fromTool.name, "github");
  assert.equal(fromTool.key, "server:github");
  assert.equal(fromTool.status, null);
  assert.deepEqual(fromTool.detail, { tools: ["list_issues"] });

  const fromMeta = extractCursorExtension(
    span({
      hookEvent: "afterMCPExecution",
      success: false,
      genAiToolName: null,
      attributes: {
        "langsmith.metadata.mcp_server": "jira",
        "langsmith.metadata.mcp_tool": "search",
        "langsmith.metadata.user_email": "Someone@Example.com",
      },
    }),
  );
  assert.ok(fromMeta);
  assert.equal(fromMeta.name, "jira");
  assert.equal(fromMeta.userEmail, "someone@example.com");
  assert.equal(fromMeta.failed, true);
  assert.equal(fromMeta.status, "failed");

  assert.equal(extractCursorExtension(span({ hookEvent: "beforeShellExecution" })), null);
  assert.equal(extractCursorExtension(span({ genAiToolName: null })), null);
});

test("aggregation merges repeats per person and key, keeps the named row over a placeholder, and unions tools", () => {
  const observations = extractClaudeCodeExtensions([
    event("mcp_server_connection", { status: "connected", transport_type: "http", server_scope: "user", server_name: "github" }),
    event("mcp_server_connection", { status: "failed", transport_type: "http", server_scope: "user", server_name: "github" }, {
      timestamp: at("2026-11-10T12:00:00Z"),
      sessionId: "sess-2",
    }),
    event("mcp_server_connection", { status: "connected", transport_type: "http", server_scope: "user", server_name: "github" }, {
      userEmail: "other@example.com",
    }),
    event("plugin_loaded", { "plugin.name": "third-party", plugin_id_hash: "h9", "plugin.scope": "community" }, {
      timestamp: at("2026-11-10T09:00:00Z"),
    }),
    event("plugin_loaded", { "plugin.name": "mempalace", "marketplace.name": "mempalace", plugin_id_hash: "h9", "plugin.scope": "community" }, {
      timestamp: at("2026-11-10T13:00:00Z"),
      sessionId: "sess-3",
    }),
    event("plugin_loaded", { "plugin.name": "third-party", plugin_id_hash: "h9", "plugin.scope": "community" }, {
      timestamp: at("2026-11-10T14:00:00Z"),
      sessionId: "sess-3",
    }),
  ]);

  const aggregates = aggregateExtensionObservations(observations);
  assert.equal(aggregates.length, 3);

  const github = aggregates.find((a) => a.key === "server:github" && a.userEmail === "dev@example.com");
  assert.ok(github);
  assert.equal(github.observations, 2);
  assert.equal(github.failures, 1);
  assert.equal(github.sessionIds.size, 2);
  assert.equal(github.lastStatus, "failed");
  assert.equal(github.firstSeenAt.toISOString(), "2026-11-10T10:00:00.000Z");
  assert.equal(github.lastSeenAt.toISOString(), "2026-11-10T12:00:00.000Z");

  const other = aggregates.find((a) => a.key === "server:github" && a.userEmail === "other@example.com");
  assert.ok(other);
  assert.equal(other.observations, 1);

  const plugin = aggregates.find((a) => a.key === "hash:h9");
  assert.ok(plugin);
  assert.equal(plugin.observations, 3);
  assert.equal(plugin.name, "mempalace", "the later placeholder must not overwrite the real name");
  assert.equal(plugin.redacted, false);
  assert.equal(plugin.marketplace, "mempalace");
  assert.equal(plugin.sessionIds.size, 2);

  const cursor = aggregateExtensionObservations([
    {
      client: "cursor",
      userEmail: "",
      userId: null,
      kind: "mcp_server",
      key: "server:github",
      name: "github",
      redacted: false,
      source: null,
      marketplace: null,
      pluginName: null,
      pluginIdHash: null,
      version: null,
      transport: null,
      status: null,
      enabledVia: null,
      failed: false,
      detail: { tools: ["list_issues"] },
      sessionId: "c1",
      appVersion: null,
      seenAt: at("2026-11-10T10:00:00Z"),
    },
    {
      client: "cursor",
      userEmail: "",
      userId: null,
      kind: "mcp_server",
      key: "server:github",
      name: "github",
      redacted: false,
      source: null,
      marketplace: null,
      pluginName: null,
      pluginIdHash: null,
      version: null,
      transport: null,
      status: "connected",
      enabledVia: null,
      failed: false,
      detail: { tools: ["create_issue", "list_issues"] },
      sessionId: "c1",
      appVersion: null,
      seenAt: at("2026-11-10T10:05:00Z"),
    },
  ]);
  assert.equal(cursor.length, 1);
  assert.deepEqual(cursor[0].detail, { tools: ["create_issue", "list_issues"] });
  assert.equal(cursor[0].lastStatus, "connected");
});
