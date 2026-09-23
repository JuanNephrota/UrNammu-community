# AI Agents

Agents represent autonomous (or semi-autonomous) behavior layered on top of a system.

## When to register an agent vs. a system

- Register a **system** for the AI capability (e.g. "Claude-based support assistant").
- Register an **agent** when that capability runs autonomously with defined tools, triggers, or human-review rules. Agents link back to a parent system via **Connected Systems**.

## Autonomy levels

- `FULL_AUTONOMY` — agent acts with no human in the loop. Highest scrutiny.
- `SUPERVISED` — agent acts, but a human monitors and can intervene.
- `HUMAN_IN_THE_LOOP` — agent proposes; a human approves every action.
- `HUMAN_ON_THE_LOOP` — agent acts by default; a human may override during or after.
- `MANUAL` — human takes every action; the agent only assists.

## Human review triggers

JSON list of conditions that force a human step — e.g. "dollar amount > $1000", "contains PII", "new vendor". Feeds the AI risk review and shows on the agent detail page.

## MCP tool governance

The **MCP Tool Governance** card on the agent detail page shows which MCP servers the agent has declared and which tools its model actually invoked, as seen by the proxy. Traffic is attributed with the `x-agent-id` request header (the agent's id is shown on the card); `x-ai-system-id` still links usage to the parent system.

- **Allowed MCP servers** — server names, URL hosts, or wildcards such as `*.example.com`. Empty means observe only.
- **Allowed MCP tools** — `tool`, `server/tool`, or `server/*`. Empty means any tool on an allowed server.
- **Monitor** records a dry-run denial for unlisted servers and raises an alert for unapproved or never-seen tools, but forwards every request.
- **Enforce** returns `403` for unlisted servers and rewrites each server's `allowed_tools` so the provider only exposes allowlisted tools to the model.

**Approve** on an unapproved row adds it to the allowlist. **Oversight → MCP Activity** shows the same data across all agents.

## Discovered agents

**Agents → Discovered** lists AI agents UrNammu has seen that nobody registered, with the signals that flagged each one and the tools, MCP servers, models and users observed.

- **Proxy traffic** — hourly, callers of the proxy that send no `x-agent-id` are scored on agent signals: an agent framework in the `User-Agent` (Claude Agent SDK, OpenAI Agents SDK, LangGraph, CrewAI and others), tool calls, MCP tool use, volume and round-the-clock activity. Callers scoring 40+ are queued. Interactive coding assistants such as Claude Code and Cursor are skipped. **Run proxy detection** runs it now.
- **Register agent** creates a draft agent from the entry, with observed MCP servers seeded into its allowlist in Monitor mode. Then have the agent send `x-agent-id` so its traffic is governed and attributed.
- **Start review**, **Approve without registering**, **Mark blocked** and **Reopen** change the review status only. Marking blocked does not stop traffic.

A new entry raises one `agent_discovery` alert; later sightings update it silently.

**Platform imports** also feed the queue:

- **OpenAI Assistants** — after each OpenAI sync. Assistants an earlier release put straight into the registry are linked, not duplicated. OpenAI retired the Assistants API on 2026-08-26.
- **ChatGPT Enterprise custom GPTs** — with the ChatGPT Enterprise compliance sync: owner, tool types and custom-action domains. The first sync imports without per-GPT alerts.
- **Anthropic Managed Agents** — a workspace API key on the **Agent Platforms** card in **Settings → Shadow AI**.
- **Microsoft 365 Copilot / Copilot Studio** — the Microsoft 365 app registration plus the `CopilotPackages.Read.All` application permission and an Agent 365 license. Microsoft-built agents are skipped.
- **Salesforce Agentforce** — the org's My Domain URL and a connected app with the client credentials flow.

Only metadata is imported — never system prompts, instructions, knowledge or conversations.

## AI-assisted risk review

The **AI Agent Risk Review** card on the agent detail page shows two things side by side:

- A **heuristic** recommended risk level, computed locally from the agent's autonomy, capabilities, and connected systems. It is always present, with no AI call. A **Dedicated review suggested** badge appears when the heuristic thinks the agent warrants a full assessment.
- An **AI review**, produced on demand with **Generate AI Review** (**Refresh AI Review** once one exists). This calls the configured AI provider with the agent's capabilities, autonomy, triggers, and connected systems, and returns a recommended risk tier, written summary, concerns, and recommendations.

Both are starting points. The human reviewer makes the final call, and a formal risk assessment in the **Risk Center** is what actually sets the agent's recorded risk level.
