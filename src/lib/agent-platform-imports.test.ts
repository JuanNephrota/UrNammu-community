import test from "node:test";
import assert from "node:assert/strict";
import type { DiscoveredAgentInput } from "./agent-discovery";
import { applyAgentImport, hostOfUrl, toDate, type FetchLike } from "./agent-import";
import {
  importAnthropicManagedAgents,
  listManagedAgents,
  managedAgentTools,
  mapManagedAgent,
  MANAGED_AGENTS_BETA,
} from "./anthropic-managed-agents";
import {
  COPILOT_PACKAGES_PERMISSION,
  importMicrosoftCopilotAgents,
  listCopilotAgentPackages,
  mapCopilotPackage,
} from "./microsoft-copilot-agents";
import {
  getSalesforceAccessToken,
  importSalesforceAgentforce,
  listAgentforceAgents,
  mapBotDefinition,
  normalizeSalesforceInstanceUrl,
  summarizeBotVersions,
} from "./salesforce-agentforce";
import {
  importOpenAIAssistants,
  isAssistantsApiGone,
  mapOpenAIAssistant,
} from "./openai-assistant-discovery";
import { gptToDiscoveredAgent } from "./chatgpt-enterprise-compliance";
import { runAgentPlatformImports, summarizeAgentPlatformRun } from "./agent-platform-imports";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

/** A stub fetch that answers from a queue and records each call. */
function stubFetch(responses: Array<Response | ((url: string, init?: RequestInit) => Response)>) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const impl: FetchLike = async (url, init) => {
    calls.push({ url, init });
    const next = responses.shift();
    if (!next) throw new Error(`unexpected fetch ${url}`);
    return typeof next === "function" ? next(url, init) : next;
  };
  return { impl, calls };
}

function recordingUpsert(existing: Set<string> = new Set()) {
  const seen: DiscoveredAgentInput[] = [];
  const upsert = async (input: DiscoveredAgentInput) => {
    seen.push(input);
    const key = `${input.source}:${input.externalId}`;
    const created = !existing.has(key);
    existing.add(key);
    return { id: key, created };
  };
  return { seen, upsert };
}

// ─── shared helpers ────────────────────────────────────────────────────────

test("applyAgentImport counts created vs updated and keeps going after a failure", async () => {
  const inputs: DiscoveredAgentInput[] = ["a", "b", "c"].map((id) => ({
    source: "salesforce_agentforce",
    externalId: id,
    name: id,
  }));
  const summary = await applyAgentImport(inputs, async (input) => {
    if (input.externalId === "b") throw new Error("boom");
    return { id: input.externalId, created: input.externalId === "a" };
  });
  assert.equal(summary.found, 3);
  assert.equal(summary.created, 1);
  assert.equal(summary.updated, 1);
  assert.match(summary.error ?? "", /1 of 3 agent\(s\) failed to save: boom/);
});

test("toDate accepts unix seconds, milliseconds and ISO strings", () => {
  assert.equal(toDate(1700000000)?.toISOString(), "2023-11-14T22:13:20.000Z");
  assert.equal(toDate("1700000000")?.toISOString(), "2023-11-14T22:13:20.000Z");
  assert.equal(toDate(1700000000000)?.toISOString(), "2023-11-14T22:13:20.000Z");
  assert.equal(toDate("2026-01-06T00:07:20Z")?.toISOString(), "2026-01-06T00:07:20.000Z");
  assert.equal(toDate(null), null);
  assert.equal(toDate("not a date"), null);
});

test("hostOfUrl keeps only the hostname", () => {
  assert.equal(hostOfUrl("https://mcp.linear.app/sse?token=secret"), "mcp.linear.app");
  assert.equal(hostOfUrl("not a url"), null);
});

// ─── Anthropic Managed Agents ──────────────────────────────────────────────

const managedAgent = {
  id: "agent_01",
  type: "agent",
  name: "Release notes bot",
  description: "Drafts release notes",
  system: "SECRET SYSTEM PROMPT",
  model: { id: "claude-opus-5", effort: "high" },
  tools: [
    { type: "agent_toolset_20260401" },
    { type: "mcp_toolset", mcp_server_name: "github" },
    { type: "custom", name: "lookup_ticket", input_schema: { type: "object" } },
  ],
  mcp_servers: [{ type: "url", name: "github", url: "https://api.githubcopilot.com/mcp/?x=1" }],
  skills: [{ type: "anthropic", skill_id: "xlsx" }],
  version: 3,
  created_at: "2026-09-01T10:00:00Z",
  updated_at: "2026-09-10T10:00:00Z",
  archived_at: null,
};

test("mapManagedAgent maps tools, MCP servers and model, never the system prompt", () => {
  const input = mapManagedAgent(managedAgent);
  assert.ok(input);
  assert.equal(input.source, "anthropic_managed_agents");
  assert.equal(input.externalId, "agent_01");
  assert.equal(input.name, "Release notes bot");
  assert.deepEqual(input.models, ["claude-opus-5"]);
  assert.deepEqual(input.tools, ["agent_toolset_20260401", "mcp:github", "lookup_ticket"]);
  assert.deepEqual(input.mcpServers, ["github"]);
  assert.deepEqual(input.metadata?.mcpServerHosts, ["api.githubcopilot.com"]);
  assert.deepEqual(input.metadata?.skills, ["xlsx"]);
  assert.equal(input.firstSeenAt?.toISOString(), "2026-09-01T10:00:00.000Z");
  assert.ok(!JSON.stringify(input).includes("SECRET SYSTEM PROMPT"));
});

test("mapManagedAgent accepts a bare model string and skips archived or id-less agents", () => {
  assert.deepEqual(mapManagedAgent({ id: "a", model: "claude-sonnet-5" })?.models, ["claude-sonnet-5"]);
  assert.equal(mapManagedAgent({ ...managedAgent, archived_at: "2026-09-11T00:00:00Z" }), null);
  assert.equal(mapManagedAgent({ name: "no id" }), null);
  assert.deepEqual(managedAgentTools({ tools: [{ type: "mcp_toolset" }, {}] }), []);
});

test("listManagedAgents sends the beta header and follows next_page", async () => {
  const { impl, calls } = stubFetch([
    json({ data: [managedAgent], next_page: "cursor_2" }),
    json({ data: [{ ...managedAgent, id: "agent_02" }], next_page: null }),
  ]);
  const { agents, truncated } = await listManagedAgents("sk-ant-api-test", impl);
  assert.equal(agents.length, 2);
  assert.equal(truncated, false);
  assert.match(calls[0].url, /^https:\/\/api\.anthropic\.com\/v1\/agents\?limit=100$/);
  assert.match(calls[1].url, /page=cursor_2/);
  const headers = calls[0].init?.headers as Record<string, string>;
  assert.equal(headers["anthropic-beta"], MANAGED_AGENTS_BETA);
  assert.equal(headers["x-api-key"], "sk-ant-api-test");
});

test("importAnthropicManagedAgents is a no-op without a key and reports API errors", async () => {
  const none = await importAnthropicManagedAgents({ apiKey: null });
  assert.deepEqual(none, { found: 0, created: 0, updated: 0, configured: false });

  const { impl } = stubFetch([json({ error: { type: "authentication_error", message: "invalid x-api-key" } }, 401)]);
  const failed = await importAnthropicManagedAgents({ apiKey: "bad", fetchImpl: impl });
  assert.equal(failed.configured, true);
  assert.match(failed.error ?? "", /\(401\): invalid x-api-key/);
});

test("importAnthropicManagedAgents upserts every live agent", async () => {
  const { impl } = stubFetch([
    json({ data: [managedAgent, { ...managedAgent, id: "agent_old", archived_at: "2026-01-01T00:00:00Z" }], next_page: null }),
  ]);
  const { seen, upsert } = recordingUpsert();
  const result = await importAnthropicManagedAgents({ apiKey: "k", fetchImpl: impl, upsert });
  assert.equal(result.found, 1);
  assert.equal(result.created, 1);
  assert.deepEqual(seen.map((s) => s.externalId), ["agent_01"]);
});

// ─── Microsoft Copilot ─────────────────────────────────────────────────────

const copilotPackage = {
  id: "P_19ae1zz1-56bc-505a-3d42-156df75a4xxy",
  displayName: "Contoso HR Agent",
  type: "custom",
  shortDescription: "Agent that can answer HR questions",
  isBlocked: false,
  supportedHosts: ["Copilot"],
  lastModifiedDateTime: "2026-01-06T00:07:20.1467852Z",
  availableTo: "all",
  deployedTo: "some",
  elementTypes: ["declarativeAgent"],
  platform: "Copilot Studio",
  publisher: "Contoso",
  appId: "aaaaaaaa-1111-2222-3333-bbbbbbbbbbbb",
};

test("mapCopilotPackage maps a custom Copilot Studio agent", () => {
  const input = mapCopilotPackage(copilotPackage);
  assert.ok(input);
  assert.equal(input.source, "microsoft_copilot");
  assert.equal(input.externalId, copilotPackage.id);
  assert.equal(input.name, "Contoso HR Agent");
  assert.equal(input.platform, "Copilot Studio");
  assert.equal(input.framework, "declarativeAgent");
  assert.equal(input.metadata?.deployedTo, "some");
  assert.equal(input.metadata?.packageType, "custom");
  assert.equal(input.metadata?.lastModifiedAt, "2026-01-06T00:07:20.146Z");
});

test("mapCopilotPackage skips Microsoft-built packages and falls back to the M365 label", () => {
  assert.equal(mapCopilotPackage({ ...copilotPackage, type: "microsoft" }), null);
  assert.equal(mapCopilotPackage({ ...copilotPackage, platform: "teams" })?.platform, "Microsoft 365 Copilot");
  assert.equal(mapCopilotPackage({ displayName: "no id" }), null);
});

test("listCopilotAgentPackages filters to Copilot hosts and follows Graph nextLinks only", async () => {
  const { impl, calls } = stubFetch([
    json({
      value: [copilotPackage],
      "@odata.nextLink": "https://graph.microsoft.com/v1.0/copilot/admin/catalog/packages?$skiptoken=2",
    }),
    json({ value: [{ ...copilotPackage, id: "P_2" }], "@odata.nextLink": "https://evil.example.com/next" }),
  ]);
  const { packages, truncated } = await listCopilotAgentPackages("token", impl);
  assert.equal(packages.length, 2);
  assert.equal(truncated, false);
  assert.equal(calls.length, 2);
  assert.ok(calls[0].url.includes("supportedHosts/any(h:h eq 'Copilot')"));
  assert.equal((calls[0].init?.headers as Record<string, string>).Authorization, "Bearer token");
});

test("listCopilotAgentPackages turns a 403 into a permission hint", async () => {
  const { impl } = stubFetch([json({ error: { code: "Forbidden", message: "Insufficient privileges" } }, 403)]);
  await assert.rejects(listCopilotAgentPackages("token", impl), (err: Error) => {
    assert.match(err.message, /Insufficient privileges/);
    assert.ok(err.message.includes(COPILOT_PACKAGES_PERMISSION));
    return true;
  });
});

test("importMicrosoftCopilotAgents is a no-op until enabled", async () => {
  const result = await importMicrosoftCopilotAgents({ enabled: false });
  assert.deepEqual(result, { found: 0, created: 0, updated: 0, configured: false });

  const { impl } = stubFetch([json({ value: [copilotPackage, { ...copilotPackage, id: "ms", type: "microsoft" }] })]);
  const { upsert } = recordingUpsert();
  const imported = await importMicrosoftCopilotAgents({
    enabled: true,
    getToken: async () => "token",
    fetchImpl: impl,
    upsert,
  });
  assert.equal(imported.found, 1);
  assert.equal(imported.created, 1);
});

// ─── Salesforce Agentforce ─────────────────────────────────────────────────

test("normalizeSalesforceInstanceUrl accepts My Domain hosts only", () => {
  assert.equal(normalizeSalesforceInstanceUrl("acme.my.salesforce.com"), "https://acme.my.salesforce.com");
  assert.equal(
    normalizeSalesforceInstanceUrl("https://acme--dev.sandbox.my.salesforce.com/lightning/page/home"),
    "https://acme--dev.sandbox.my.salesforce.com"
  );
  assert.equal(normalizeSalesforceInstanceUrl("http://acme.my.salesforce.com"), null);
  assert.equal(normalizeSalesforceInstanceUrl("https://login.salesforce.com"), null);
  assert.equal(normalizeSalesforceInstanceUrl("https://salesforce.com.evil.example"), null);
  assert.equal(normalizeSalesforceInstanceUrl(""), null);
});

test("summarizeBotVersions finds the active and latest version per bot", () => {
  const map = summarizeBotVersions([
    { BotDefinitionId: "0Xx1", VersionNumber: 1, Status: "Inactive" },
    { BotDefinitionId: "0Xx1", VersionNumber: 2, Status: "Active" },
    { BotDefinitionId: "0Xx1", VersionNumber: 3, Status: "Inactive" },
    { BotDefinitionId: "0Xx2", VersionNumber: 1, Status: "Inactive" },
  ]);
  assert.deepEqual(map.get("0Xx1"), { active: true, latestVersion: 3, activeVersion: 2 });
  assert.deepEqual(map.get("0Xx2"), { active: false, latestVersion: 1, activeVersion: null });
});

test("mapBotDefinition maps a BotDefinition record", () => {
  const input = mapBotDefinition(
    {
      Id: "0XxAA000000001",
      DeveloperName: "Service_Agent",
      MasterLabel: "Service Agent",
      Description: "Answers cases",
      AgentType: "EinsteinServiceAgent",
      CreatedDate: "2026-05-01T12:00:00.000+0000",
      LastModifiedDate: "2026-09-01T12:00:00.000+0000",
    },
    { active: true, latestVersion: 2, activeVersion: 2 },
    "https://acme.my.salesforce.com"
  );
  assert.ok(input);
  assert.equal(input.source, "salesforce_agentforce");
  assert.equal(input.externalId, "0XxAA000000001");
  assert.equal(input.name, "Service Agent");
  assert.equal(input.framework, "EinsteinServiceAgent");
  assert.equal(input.metadata?.active, true);
  assert.equal(input.metadata?.instanceHost, "acme.my.salesforce.com");
  assert.equal(input.firstSeenAt?.toISOString(), "2026-05-01T12:00:00.000Z");
});

test("getSalesforceAccessToken posts client credentials to My Domain and ignores a foreign instance_url", async () => {
  const { impl, calls } = stubFetch([
    json({ access_token: "00D!tok", instance_url: "https://evil.example.com", token_type: "Bearer" }),
  ]);
  const config = { instanceUrl: "https://acme.my.salesforce.com", clientId: "cid", clientSecret: "csecret" };
  const { accessToken, instanceUrl } = await getSalesforceAccessToken(config, impl);
  assert.equal(accessToken, "00D!tok");
  assert.equal(instanceUrl, "https://acme.my.salesforce.com");
  assert.equal(calls[0].url, "https://acme.my.salesforce.com/services/oauth2/token");
  assert.equal(calls[0].init?.method, "POST");
  const body = new URLSearchParams(String(calls[0].init?.body));
  assert.equal(body.get("grant_type"), "client_credentials");
  assert.equal(body.get("client_id"), "cid");
});

test("listAgentforceAgents retries without AgentType on INVALID_FIELD and follows nextRecordsUrl", async () => {
  const { impl, calls } = stubFetch([
    json([{ message: "No such column 'AgentType' on entity 'BotDefinition'", errorCode: "INVALID_FIELD" }], 400),
    json({
      done: false,
      nextRecordsUrl: "/services/data/v62.0/query/01gXX-2000",
      records: [{ Id: "0Xx1", MasterLabel: "A" }],
    }),
    json({ done: true, records: [{ Id: "0Xx2", MasterLabel: "B" }] }),
    json({ done: true, records: [{ BotDefinitionId: "0Xx1", VersionNumber: 1, Status: "Active" }] }),
  ]);
  const { bots, versions } = await listAgentforceAgents("https://acme.my.salesforce.com", "tok", impl);
  assert.deepEqual(bots.map((b) => b.Id), ["0Xx1", "0Xx2"]);
  assert.equal(versions.length, 1);
  assert.ok(decodeURIComponent(calls[0].url).includes("AgentType"));
  assert.ok(!decodeURIComponent(calls[1].url).includes("AgentType"));
  assert.equal(calls[2].url, "https://acme.my.salesforce.com/services/data/v62.0/query/01gXX-2000");
});

test("importSalesforceAgentforce is a no-op when unconfigured and imports bots when configured", async () => {
  assert.deepEqual(await importSalesforceAgentforce({ config: null }), {
    found: 0,
    created: 0,
    updated: 0,
    configured: false,
  });
  const { impl } = stubFetch([
    json({ access_token: "tok", instance_url: "https://acme.my.salesforce.com" }),
    json({ done: true, records: [{ Id: "0Xx1", MasterLabel: "A", AgentType: "AgentforceEmployeeAgent" }] }),
    json([{ message: "insufficient access", errorCode: "INSUFFICIENT_ACCESS" }], 403),
  ]);
  const { seen, upsert } = recordingUpsert();
  const result = await importSalesforceAgentforce({
    config: { instanceUrl: "https://acme.my.salesforce.com", clientId: "c", clientSecret: "s" },
    fetchImpl: impl,
    upsert,
  });
  assert.equal(result.found, 1);
  assert.equal(result.error, undefined);
  assert.equal(seen[0].metadata?.active, null);
});

// ─── OpenAI Assistants ─────────────────────────────────────────────────────

test("mapOpenAIAssistant keeps tool types and function names but not instructions", () => {
  const input = mapOpenAIAssistant({
    id: "asst_1",
    name: "Support bot",
    description: "Tier 1 support",
    instructions: "SECRET INSTRUCTIONS",
    model: "gpt-4o",
    created_at: 1700000000,
    tools: [{ type: "file_search" }, { type: "function", function: { name: "refund" } }],
  });
  assert.ok(input);
  assert.equal(input.source, "openai_assistants");
  assert.deepEqual(input.tools, ["file_search", "function:refund"]);
  assert.deepEqual(input.models, ["gpt-4o"]);
  assert.equal(input.linkedAgentId, null);
  assert.ok(!JSON.stringify(input).includes("SECRET INSTRUCTIONS"));
});

test("importOpenAIAssistants links legacy AIAgent rows by name instead of duplicating", async () => {
  const { seen, upsert } = recordingUpsert(new Set(["openai_assistants:asst_2"]));
  const result = await importOpenAIAssistants({
    list: async () => ({ data: [{ id: "asst_1", name: "Legacy" }, { id: "asst_2", name: "New" }] }),
    findLinkedAgentId: async (name) => (name === "Legacy" ? "agent_legacy" : null),
    upsert,
  });
  assert.deepEqual(result, { found: 2, created: 1, updated: 1 });
  assert.equal(seen[0].linkedAgentId, "agent_legacy");
  assert.equal(seen[1].linkedAgentId, null);
});

test("importOpenAIAssistants treats the retired Assistants API as empty, other errors as errors", async () => {
  const gone = await importOpenAIAssistants({
    list: async () => {
      throw new Error("OpenAI API error (404): Not found");
    },
  });
  assert.deepEqual(gone, { found: 0, created: 0, updated: 0 });
  assert.equal(isAssistantsApiGone(new Error("OpenAI API error (410): gone")), true);

  const failed = await importOpenAIAssistants({
    list: async () => {
      throw new Error("OpenAI API error (401): bad key");
    },
  });
  assert.match(failed.error ?? "", /401/);
});

// ─── ChatGPT Enterprise GPTs ───────────────────────────────────────────────

test("gptToDiscoveredAgent maps owner, tools and custom-action domains", () => {
  const input = gptToDiscoveredAgent(
    {
      id: "g-abc",
      created_at: 1700000000,
      owner_email: "Owner@Example.com",
      builder_name: "Owner",
      sharing: { visibility: "workspace" },
      latest_config: {
        data: [
          {
            id: "cfg1",
            name: "Contract reviewer",
            created_at: 1700001000,
            version_author: { email: "editor@example.com" },
            instructions: "SECRET GPT INSTRUCTIONS",
            tools: {
              data: [
                { type: "browser" },
                { type: "custom_action", action_domain: "API.Vendor.com", auth_type: "oauth" },
              ],
            },
          },
        ],
      },
    },
    { suppressAlert: true }
  );
  assert.ok(input);
  assert.equal(input.source, "chatgpt_gpts");
  assert.equal(input.externalId, "g-abc");
  assert.equal(input.name, "Contract reviewer");
  assert.equal(input.ownerEmail, "owner@example.com");
  assert.deepEqual(input.userEmails, ["owner@example.com", "editor@example.com"]);
  assert.deepEqual(input.tools, ["browser", "custom_action:api.vendor.com"]);
  assert.deepEqual(input.metadata?.actionDomains, ["api.vendor.com"]);
  assert.equal(input.metadata?.visibility, "workspace");
  assert.equal(input.suppressAlert, true);
  assert.ok(!JSON.stringify(input).includes("SECRET GPT INSTRUCTIONS"));
  assert.equal(gptToDiscoveredAgent({ owner_email: "x@example.com" }), null);
});

// ─── Orchestrator ──────────────────────────────────────────────────────────

test("runAgentPlatformImports isolates a throwing importer and summarizes the run", async () => {
  const run = await runAgentPlatformImports({
    anthropic_managed_agents: async () => ({ found: 2, created: 1, updated: 1, configured: true }),
    microsoft_copilot: async () => ({ found: 0, created: 0, updated: 0, configured: false }),
    salesforce_agentforce: async () => {
      throw new Error("token expired");
    },
  });
  assert.equal(run.salesforce_agentforce.error, "token expired");
  const summary = summarizeAgentPlatformRun(run);
  assert.equal(summary.status, "completed");
  assert.equal(summary.toolsFound, 2);
  assert.equal(summary.newToolsAdded, 1);
  assert.equal(summary.updatedTools, 1);
  assert.match(summary.errorMessage ?? "", /salesforce_agentforce: token expired/);
});

test("summarizeAgentPlatformRun fails only when every configured importer failed", () => {
  const failed = summarizeAgentPlatformRun({
    anthropic_managed_agents: { found: 0, created: 0, updated: 0, configured: true, error: "401" },
    microsoft_copilot: { found: 0, created: 0, updated: 0, configured: false },
    salesforce_agentforce: { found: 0, created: 0, updated: 0, configured: false },
  });
  assert.equal(failed.status, "failed");
  const idle = summarizeAgentPlatformRun({
    anthropic_managed_agents: { found: 0, created: 0, updated: 0, configured: false },
    microsoft_copilot: { found: 0, created: 0, updated: 0, configured: false },
    salesforce_agentforce: { found: 0, created: 0, updated: 0, configured: false },
  });
  assert.equal(idle.status, "completed");
  assert.equal(idle.errorMessage, undefined);
});
