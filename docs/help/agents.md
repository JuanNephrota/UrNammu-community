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

## AI-assisted risk review

The **AI Agent Risk Review** card on the agent detail page shows two things side by side:

- A **heuristic** recommended risk level, computed locally from the agent's autonomy, capabilities, and connected systems. It is always present, with no AI call. A **Dedicated review suggested** badge appears when the heuristic thinks the agent warrants a full assessment.
- An **AI review**, produced on demand with **Generate AI Review** (**Refresh AI Review** once one exists). This calls the configured AI provider with the agent's capabilities, autonomy, triggers, and connected systems, and returns a recommended risk tier, written summary, concerns, and recommendations.

Both are starting points. The human reviewer makes the final call, and a formal risk assessment in the **Risk Center** is what actually sets the agent's recorded risk level.
