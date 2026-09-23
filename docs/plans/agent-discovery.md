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
               | "endpoint_agent"
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

## Gap 2 — platform inventory imports (PR B, stacked on A)

Each importer lists agents with credentials we already hold where possible and
writes through `upsertDiscoveredAgent()`. They run from the relevant provider
sync or a discovery-scan source, and each is a no-op when unconfigured.

- **Anthropic Managed Agents** — list agents with the workspace API key.
- **Microsoft Copilot Studio / M365 agents** — through the existing Microsoft
  365 app registration; any extra consent scope is documented.
- **Salesforce Agentforce** — a new connected-app integration (client
  credentials) and a Settings section.
- **OpenAI** — `discoverOpenAIAssistants` moves onto `DiscoveredAgent`
  (existing registry rows are linked, not duplicated), plus any newer agent
  objects the API exposes. ChatGPT Enterprise custom GPTs, which the compliance
  sync already pulls, are included.

## Gap 3 — endpoint MCP and agent framework scanning (PR C, stacked on A)

A new endpoint-agent collector, `agents`, reads known MCP client config files
(Claude Desktop, Claude Code, Cursor, Windsurf, VS Code, Cline, Zed, …) and
detects agent frameworks installed in well-known locations. Holding the
endpoint agent's rule — *identifiers and counts only* — it sends per server
the **name, transport, and bare remote host** — never the command, args, env,
headers, or file paths, which routinely hold secrets. Each (device, client,
server) rolls into a `DiscoveredAgent` with `source = endpoint_agent`.

## Rollout

Each PR carries its own migration where needed; after merge the user runs
`prisma migrate deploy` on prod, and PR A additionally needs the Azure proxy
redeployed (`func azure functionapp publish nammu-ai-proxy --build remote`).
PR C needs a new signed endpoint-agent release before the collector reaches
devices.
