# Agent discovery — finding AI agents nobody registered

Status: **in progress** (started 2026-09-22).

The Agent Registry (`AIAgent`) is populated two ways today: by hand, and by
`discoverOpenAIAssistants` in `background-jobs.ts`, which writes OpenAI
Assistants straight into the registry. Everything else we collect finds AI
*tools* (`DiscoveredAITool`), and the proxy only governs an agent once a caller
volunteers `x-agent-id`. Three gaps follow:

1. **Proxy traffic.** Agent-shaped traffic without `x-agent-id` is logged and
   its tool calls recorded (`AgentToolCall` with `agentId = null`), but
   nothing notices that a key is running a tool loop around the clock.
2. **Agent platforms.** Agents built on Anthropic Managed Agents, Microsoft
   Copilot Studio / M365 Copilot, Salesforce Agentforce, and OpenAI's newer
   agent objects are invisible.
3. **Endpoints.** The endpoint agent reports apps, browser hosts, network hosts
   and local runtimes, but not the MCP servers configured on a laptop or the
   agent frameworks installed there.

## Shared foundation — `DiscoveredAgent`

A new table, deliberately separate from `DiscoveredAITool`: an agent carries
tools, MCP servers, models, a caller fingerprint and a promotion target that a
SaaS tool does not.

```
DiscoveredAgent
  source       "proxy_traffic" | "anthropic_managed_agents" | "microsoft_copilot"
               | "salesforce_agentforce" | "openai_assistants" | "openai_agents"
               | "chatgpt_gpts" | "endpoint_agent"
  externalId   stable key within the source (platform id, caller fingerprint,
               device + config hash). @@unique([source, externalId])
  name, description, platform, framework
  status       DiscoveryStatus  (DISCOVERED → UNDER_REVIEW → REGISTERED | APPROVED | BLOCKED)
  confidence   "high" | "medium" | "low";  score 0–100;  signals Json[{key,label,weight}]
  tools[], mcpServers[], models[], userEmails[], ownerEmail, department
  aiSystemId, linkedAgentId → AIAgent (set on register)
  requestCount, firstSeenAt, lastSeenAt, metadata Json, notes
```

Every source writes through **one helper**, `upsertDiscoveredAgent()` in
`src/lib/agent-discovery.ts`:

- merges arrays (union, capped), keeps the earliest `firstSeenAt` and the
  latest `lastSeenAt`, never lowers a reviewer-set `status`;
- raises one MEDIUM alert (source `agent_discovery`) the first time a row is
  created, never on update;
- returns `{ created, updated }` so each sync can report counts.

`registerDiscoveredAgent()` promotes a row into an `AIAgent` (or links it to an
existing one), sets `status = REGISTERED`, and audit-logs both sides. Registered,
approved and blocked rows keep receiving `lastSeenAt` updates, so re-detection
never re-alerts.

API: `GET /api/discovered-agents` (filter by status/source),
`PUT /api/discovered-agents/[id]` (status, notes), and
`POST /api/discovered-agents/[id]/register`. UI: a **Discovered** tab on the
Agents page.

## Gap 1 — proxy traffic detection (PR A, with the foundation)

**Capture.** Both proxies (Vercel `/api/proxy/*` and Azure Functions) add a
`client` block to the usage metadata they already write:

```
client: { framework, sdk, userAgent (≤160 chars), keyHash }
```

`framework` / `sdk` come from `User-Agent` and the `x-stainless-*` SDK headers,
matched against a closed table (Claude Agent SDK, OpenAI Agents SDK, LangChain /
LangGraph, CrewAI, AutoGen, LlamaIndex, Pydantic AI, Semantic Kernel, Vercel AI
SDK, Mastra, …). `keyHash` is an HMAC of the upstream API key with the existing
prompt-hash salt — the key itself never leaves the request. The parsing lives in
`caller-fingerprint.ts`, a mirrored module added to `check-mirror-drift.mjs`.
No content is captured; this is header metadata only.

**Detect.** An hourly job (`/api/cron/agent-discovery`) aggregates the last 7
days of `APIUsageLog` rows with no `agentId`, grouped by caller
(`provider`, `keyHash` or `userEmail`, `aiSystemId`), and joins `AgentToolCall`
on `requestId`. Signals and weights:

| Signal | Weight |
| --- | --- |
| agent framework in User-Agent | 40 |
| model returned tool calls | 30 |
| MCP tools invoked | 15 |
| ≥ 20 tool calls in the window | 10 |
| active in ≥ 12 distinct hours | 10 |
| no user identity (service key) | 5 |

Only rows carrying `metadata.client` (proxy traffic since this change) are
considered, and rows whose client is an interactive assistant are dropped
*before* grouping, so a key shared between Claude Code and an agent is judged
on the agent's traffic alone.

Known limits: callers with no credential hash, user or system (the proxy's
own fallback key, no attribution headers) collapse into one bucket and are
skipped as anonymous; an agent that sends a different `x-user-email` per end
user splits into several callers; and `keyHash` depends on the prompt-hash
salt, so rotating it re-queues every caller.

A caller scoring ≥ 40 becomes a `DiscoveredAgent` (`source = proxy_traffic`,
`externalId = sha256(provider|keyHash|userEmail|aiSystemId)`). Confidence is
high ≥ 70, medium ≥ 50, low otherwise. Known interactive assistants (Claude
Code, Cursor, Copilot, Cline, Continue) are excluded by User-Agent: they are
already governed as tools and would otherwise dominate the queue.

## Gap 2 — platform inventory imports (PR B, stacked on A) — built

Branch `feat/agent-discovery-platforms`. Every importer keeps its response
mapping pure (`map*`, fetch injected, unit-tested in
`src/lib/agent-platform-imports.test.ts`) and writes through
`upsertDiscoveredAgent()` via `applyAgentImport()` (`src/lib/agent-import.ts`),
reporting `{ found, created, updated, error? }`. Each is a no-op when
unconfigured. No schema change and no migration: settings live in
`AppSetting` (`AGENT_PLATFORM_SETTINGS_KEYS`), runs in `ScanHistory`.

**Scheduling.** A new discovery-scan source, `agent_platforms`
(`/api/cron/discovery-scan/agent_platforms`, `42 * * * *`), runs the
Anthropic, Microsoft and Salesforce importers in parallel through
`executeAgentPlatformScan()` (`src/lib/agent-platform-imports.ts`) and writes
one `ScanHistory` row (`scanType = agent_platforms`, counts are agents).
Settings `agent_platforms_scan_enabled` (default off) and
`agent_platforms_scan_interval_hours` (default 24). Manual run:
`POST /api/discovered-agents/import`. OpenAI and ChatGPT stay on their
provider syncs, which already hold those keys.

**Foundation change.** `DiscoveredAgentInput` gained an optional
`suppressAlert` (default false, backward compatible) so a source's baseline
run can import an existing estate without one alert per row. Used only by
the ChatGPT GPT import's first run.

| Source | Endpoint | Credential / permission | Notes |
| --- | --- | --- | --- |
| `openai_assistants` | `GET https://api.openai.com/v1/assistants` | existing `openai_admin_key` | Runs after each scheduled OpenAI sync. Legacy `AIAgent` rows (name + `department: "OpenAI"`) are passed as `linkedAgentId`, so they become REGISTERED discoveries and are no longer modified. **OpenAI shut the Assistants API down on 2026-08-26** ([deprecations](https://developers.openai.com/api/docs/deprecations)); a 404/410 is an empty import, not an error. |
| `openai_agents` | — | — | **Not built.** The Agents API beta (2026-09-10) has saved agents (`POST /v1/agents`, reused via `agent_id`) and `GET /v1/agents/sessions`, but no documented list/retrieve endpoint for agents; Agent Builder is being shut down 2026-11-30, and Workspace Agents (`api.chatgpt.com/v1/workspace_agents`) only expose trigger/run endpoints. Revisit when a list endpoint ships. |
| `chatgpt_gpts` | Compliance API `GET /v1/compliance/workspaces/{ws}/gpts` (already pulled by `syncChatGPTEnterprise`) | existing ChatGPT Enterprise admin key with **GPTs** read | `gptToDiscoveredAgent()` maps every GPT: owner email, config authors, tool types, `custom_action:<domain>`, sharing. Baseline run (no `chatgpt_enterprise:GPTS` watermark) is silent. Counts in run metadata `gpts.discoveredAgents`. |
| `anthropic_managed_agents` | `GET https://api.anthropic.com/v1/agents?limit=100&page=…` with `anthropic-version: 2023-06-01`, `anthropic-beta: managed-agents-2026-04-01` | new `anthropic_managed_agents_api_key` (encrypted, masked): a **regular workspace API key** — Managed Agents endpoints reject Admin keys; one key = one workspace | Source: the `claude-api` skill's Managed Agents API reference. Archived agents skipped. Imports name, description, model, tool types / custom tool names / `mcp:<server>`, MCP server names (hosts in metadata), skill ids, version. Never `system`. |
| `microsoft_copilot` | `GET https://graph.microsoft.com/v1.0/copilot/admin/catalog/packages?$filter=supportedHosts/any(h:h eq 'Copilot')` ([list](https://learn.microsoft.com/en-us/microsoft-365/copilot/extensibility/api/admin-settings/package/copilotpackages-list), [resource](https://learn.microsoft.com/en-us/microsoft-365/copilot/extensibility/api/admin-settings/package/resources/copilotpackage)) | existing Microsoft 365 Shadow AI app registration + **`CopilotPackages.Read.All` application permission with admin consent**; tenant needs a **Microsoft Agent 365 license**. Opt-in `microsoft_copilot_agents_enabled` | Chosen over the Teams app catalog (misses Copilot Studio agents) and Dataverse `bots` (per-environment URL and application user per environment). Skips `type: microsoft`. Metadata only (publisher, type, platform, element types, available/deployed scope, blocked). |
| `salesforce_agentforce` | `POST https://<MyDomain>/services/oauth2/token` (`grant_type=client_credentials`), then `GET /services/data/v62.0/query?q=SELECT Id, DeveloperName, MasterLabel, Description, AgentType, CreatedDate, LastModifiedDate FROM BotDefinition` and `SELECT BotDefinitionId, VersionNumber, Status FROM BotVersion` | new `salesforce_instance_url`, `salesforce_client_id`, `salesforce_client_secret` (encrypted, masked). Connected app / external client app with **Enable Client Credentials Flow** and a **Run As** user (integration user) that can read Bot setup objects | `BotDefinition` is the agent (its Id is the Agent API agent ID); `GenAiPlannerDefinition` is the planner, and `GenAiPlannerBundle` / `GenAiFunction` are not SOQL-queryable, so topics/actions are not imported. Instance URL restricted to Salesforce hosts. |

**Unverified from docs.** Salesforce developer docs returned 403 to automated
fetches, so the `BotDefinition` field list (notably `AgentType` and its
values) is from search snippets and the `forcedotcom/sf-skills` reference; the
importer retries without `AgentType` on `INVALID_FIELD`. Microsoft Q&A threads
report 403s on the package API even with the permission granted — the test
button's error names the permission and the Agent 365 license. No importer was
exercised against a live tenant.

**UI.** Settings → Shadow AI → **Agent Platforms** card (schedule, Anthropic
key, Copilot toggle, Salesforce credentials, three Test buttons, Import Now);
test routes `/api/settings/test-anthropic-managed-agents`,
`/api/settings/test-microsoft-copilot-agents`, `/api/settings/test-salesforce`.

## Gap 3 — endpoint MCP and agent framework scanning (PR C, stacked on A)

A new endpoint-agent collector, `agents`, reads known MCP client config files
(Claude Desktop, Claude Code, Cursor, Windsurf, VS Code, Cline, Zed, …) and
detects agent frameworks installed in well-known locations. Holding the
endpoint agent's rule — *identifiers and counts only* — it sends per server
the **name, transport, and bare remote host** — never the command, args, env,
headers, or file paths, which routinely hold secrets. Each (device, client,
server) rolls into a `DiscoveredAgent` with `source = endpoint_agent`.

## Rollout

Each PR carries its own migration where needed (PR B has none); after merge the user runs
`prisma migrate deploy` on prod, and PR A additionally needs the Azure proxy
redeployed (`func azure functionapp publish nammu-ai-proxy --build remote`).
PR C needs a new signed endpoint-agent release before the collector reaches
devices.
