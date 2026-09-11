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

## AI-assisted risk review

The **AI Agent Risk Review** card on the agent detail page shows two things side by side:

- A **heuristic** recommended risk level, computed locally from the agent's autonomy, capabilities, and connected systems. It is always present, with no AI call. A **Dedicated review suggested** badge appears when the heuristic thinks the agent warrants a full assessment.
- An **AI review**, produced on demand with **Generate AI Review** (**Refresh AI Review** once one exists). This calls the configured AI provider with the agent's capabilities, autonomy, triggers, and connected systems, and returns a recommended risk tier, written summary, concerns, and recommendations.

Both are starting points. The human reviewer makes the final call, and a formal risk assessment in the **Risk Center** is what actually sets the agent's recorded risk level.
