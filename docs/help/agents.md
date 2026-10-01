# AI Agents

Agents represent autonomous (or semi-autonomous) behavior layered on top of a system.

## When to register an agent vs. a system

- Register a **system** for the AI capability (e.g. "Claude-based support assistant").
- Register an **agent** when that capability runs autonomously with defined tools, triggers, or human-review rules. Agents link back to a parent system via **Connected Systems**.

## Charter and approval

Every agent carries a **charter**: its purpose, the actions it may take (in scope), the actions it must never take (out of scope), the decision boundaries where it has to stop and hand off, and its success criteria. Purpose, at least one in-scope action and the decision boundaries are required before approval; the rest is recommended. Edit it on the agent form; it shows on the **Agent Charter** card.

Approval works like it does for systems. The **Governance checklist** at the top of the detail page lists what is left; the **Governance Workflow** card gives the stage and the next actions; **Stage Reviews** collects the required sign-offs (Owner, Security and Compliance by default, Legal optional — set on the agent form under **Approval Requirements**); **Approval Review** records the decision. Approving sets the agent to APPROVED (a DEPLOYED agent stays DEPLOYED) and restarts the review interval; **Request Changes** and **Revoke** return it to UNDER REVIEW.

Approval is refused while any of these hold:

- the charter is incomplete;
- the agent is **suspended** (resume it first, or keep it suspended and do not approve);
- autonomy is **FULL_AUTONOMY** and MCP enforcement is not **Enforce** with at least one allowed server — there is no human to catch a bad tool call;
- risk is **HIGH** or **CRITICAL** and there is no risk basis: neither a Risk Center assessment on the parent system nor an agent risk review;
- a required stage review is missing;
- there is no next-review date, or it has passed.

Softer items (optional charter fields, SUPERVISED without enforcement, human-review settings that contradict the autonomy level, unapproved observed tools, no parent system) are listed as recommendations and do not block.

Moving an agent to **APPROVED** or **DEPLOYED** on the edit form also requires a recorded approval; agents that are already live can be edited freely.

## Autonomy levels

- `FULL_AUTONOMY` — agent acts with no human in the loop. Highest scrutiny.
- `SUPERVISED` — agent acts, but a human monitors and can intervene.
- `HUMAN_IN_THE_LOOP` — agent proposes; a human approves every action.
- `HUMAN_ON_THE_LOOP` — agent acts by default; a human may override during or after.
- `MANUAL` — human takes every action; the agent only assists.

## Human review triggers

The conditions under which an agent's tool call must stop for a person. Both proxies evaluate them against the **arguments** of every tool call the model makes (`tool_use.input`, OpenAI `function.arguments`, `mcp_call.arguments`), in streaming and non-streaming responses, on the Anthropic, OpenAI and Azure OpenAI paths.

Trigger kinds (agent form → **Human Review Triggers**):

- **Argument condition** — a tool pattern, an argument path (`amount`, `payment.total`, `items.0.sku`) and a comparison: greater than, at least, less than, at most, equals, does not equal, contains, matches regex, is present. Numbers are coerced, so `"$1,200.50"` compares as 1200.5.
- **Any call of a tool** — the tool pattern alone: `issue_refund`, every tool on the `payments` server, or a name prefix such as `delete_`.
- **Sensitive data in arguments** — the proxy's sensitive-data detector runs over the call's arguments; optionally restrict to categories such as `pii` or `credentials`.
- **Note** — free text for reviewers; never evaluated. Triggers written before this release as plain text were kept as notes.

Tool patterns accept a bare tool name (any server), `server/tool`, or a glob with a wildcard for a whole server or a name prefix.

**Enforcement** decides what a match does:

- **Monitor** records a dry-run denial under **Compliance → Denials** (rule `human_review_required`) and raises a **HIGH** alert (source `human_review_trigger`, deduped 24 h per agent and trigger). The response is forwarded.
- **Enforce** withholds the model's response and returns `403 human_review_required` with the matched trigger, tool and detail in `violations`. The agent loop stops until a person acts. Streaming responses are buffered until the model finishes so the arguments can be checked, so the client waits for the full generation before seeing anything.

Matches are flagged on the tool-call rows (**Oversight → MCP Activity**) and listed on the agent's **Human Review Triggers** card. Gemini and Bedrock traffic is not evaluated yet.

## MCP tool governance

The **MCP Tool Governance** card on the agent detail page shows which MCP servers the agent has declared and which tools its model actually invoked, as seen by the proxy. Traffic is attributed with the `x-agent-id` request header (the agent's id is shown on the card); `x-ai-system-id` still links usage to the parent system.

- **Allowed MCP servers** — server names, URL hosts, or wildcards such as `*.example.com`. Empty means observe only.
- **Allowed MCP tools** — `tool`, `server/tool`, or `server/*`. Empty means any tool on an allowed server.
- **Monitor** records a dry-run denial for unlisted servers and raises an alert for unapproved or never-seen tools, but forwards every request.
- **Enforce** returns `403` for unlisted servers and rewrites each server's `allowed_tools` so the provider only exposes allowlisted tools to the model.

**Approve** on an unapproved row adds it to the allowlist. **Oversight → MCP Activity** shows the same data across all agents.

## Accountability

Four roles per agent: the **business owner** (whoever registered it; accountable for outcomes), a **technical owner** (runs it), a **risk owner** (signs off the risk basis and decides on incidents) and an **escalation contact** (email, Slack channel or pager to page when a review trigger fires or an incident opens). Set them on the agent form under **Accountability**. The approval gate recommends a risk owner for HIGH/CRITICAL agents and an escalation contact for agents that act without a human in the loop; the governance checklist expects both.

## Incidents

**Governance Incidents** on the agent page logs misuse, policy breaches or other governance events against the agent itself (not only its parent system). Opening one raises an alert, hard-blocks the agent's approval until it is resolved or dismissed, and shows in the workflow notifications bell. If the behaviour must stop now, use **Suspend** in the page header; the incident record stays.

## Retirement

**Retire** in the page header is the controlled shutdown. It sets the agent to RETIRED (both proxies refuse its `x-agent-id`), revokes a standing approval so reactivating it means going back through the approval gate, and records who retired it, when, optional notes and whether disposal of credentials, data and artifacts was attested. A **Retirement checklist** appears for DEPRECATED and RETIRED agents: stop the traffic, confirm it has actually stopped (no tool calls in 7 days), close open incidents, revoke the approval, attest disposal, record the retirement.

## Kill switch (Suspend / Resume)

**Suspend** on the agent detail page stops the agent at the proxy: both proxies refuse every request that carries its `x-agent-id` with `403` and record each refusal as an enforced denial under **Compliance → Denials** (rule `agent_suspended`). Traffic that does not carry the header is unaffected, and the agent's status, allowlists and history are untouched. **Resume** clears it. Both actions are audit-logged with the optional reason.

- Applies regardless of the MCP enforcement mode. A kill switch that only recorded would not be one.
- Agents with status **RETIRED** are refused the same way (rule `agent_retired`); change the status to allow traffic again. DRAFT and DEPRECATED agents are not blocked.
- The Azure proxy caches agent state for 30 seconds, so a suspension takes effect within that window; the Vercel proxy checks every request.
- A **Traffic blocked at the proxy** banner shows on the detail page while either condition holds, and a **SUSPENDED** badge on the registry card.

## Behaviour baseline

The **Behaviour Baseline** card shows what normal looks like for the agent over the last 28 days of attributed proxy traffic: requests and tool calls per day, denial and review rates, the models, callers and tools seen, and the hours it is active. A daily job recomputes every agent's baseline and compares the last 24 hours against it; once an agent has 7 active days of history, departures raise `agent_behavior_drift` alerts: request or tool-call volume spikes and denial-rate jumps are HIGH; a new model, a new caller or activity outside the usual hours are MEDIUM. **Recompute** rebuilds the baseline now, for example after a deliberate change in how the agent runs.

## Org-approved MCP catalog

**Oversight → MCP Activity → Approved MCP catalog** lists servers (and optionally tools) approved once for every agent that has **Inherit the org-approved MCP catalog** ticked on its form. Inherited servers show on the agent's MCP card with a dashed "catalog" chip, and both proxies apply the catalog within a minute. Tool lists in the catalog narrow only agents that keep their own tool allowlist; agents without one get every tool on a catalog server. Existing agents do not inherit until the box is ticked; new agents inherit by default.

## Discovered agents

**Agents → Discovered** lists AI agents UrNammu has seen that nobody registered, with the signals that flagged each one and the tools, MCP servers, models and users observed.

- **Proxy traffic** — hourly, callers of the proxy that send no `x-agent-id` are scored on agent signals: an agent framework in the `User-Agent` (Claude Agent SDK, OpenAI Agents SDK, LangGraph, CrewAI and others), tool calls, MCP tool use, volume and round-the-clock activity. Callers scoring 40+ are queued. Interactive coding assistants such as Claude Code and Cursor are skipped. **Run proxy detection** runs it now.
- **Endpoints** — the endpoint agent contributes one row per machine and MCP client (for example "Cursor MCP config on alice-mbp") listing the MCP servers configured there, scored higher when a server is an unrecognized remote host or package, a bridge to an unseen remote, or reaches the file system, a shell, a database, a browser, payments or a cloud control plane. Registering a row creates a draft agent whose MCP allowlist is seeded with those servers in monitor mode. Installed agent frameworks appear as a low-confidence row per machine — a lead that someone builds agents there.
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
