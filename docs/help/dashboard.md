# Dashboard (Command Center)

The dashboard is your daily home screen for governance. Use it to triage open work across every system, agent, and alert.

## What you're looking at

- **Stat cards** — total systems, agents, high-risk systems, and discovered shadow-AI tools.
- **Governance queue** — next-best actions pulled from every system in the registry (systems without assessments, pending approvals, expiring exceptions).
- **Compliance overview** — how many policy assignments are `COMPLIANT` / `PARTIALLY_COMPLIANT` / `NON_COMPLIANT` / `NOT_ASSESSED`.
- **Risk heat map** — systems vs. the 6 risk dimensions, colored by score.
- **Open alerts & investigations** — the active follow-up queue.
- **Recent activity** — the latest governance actions from the audit log.

## Where to start

- **Admins**: check **Settings → Provider Admin APIs** and **Settings → Shadow AI** first so telemetry and discovery are flowing.
- **Compliance officers**: work the governance queue top-down and triage open alerts.
- **Viewers**: browse the Registry and Risk Center to read the current state.

## Tips

- The **Needs Review** count only includes `DISCOVERED` shadow-AI tools — discoveries linked to a governed system are automatically suppressed.
- The **Executive posture chart** reflects overall compliance + risk + approval health; drift shows up here first.
