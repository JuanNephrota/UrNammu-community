# Dashboard (Command Center)

The dashboard is your daily home screen for governance. Use it to triage open work across every system, agent, and alert.

## What you're looking at

- **Stat cards** — total systems, agents, high-risk systems, open alerts, shadow AI discoveries, and compliance rate. Each card is **clickable** and navigates to the relevant module page (Registry, Agents, Risk Center, Alerts, Shadow AI, or Compliance).
- **Executive posture chart** — rolling 12-month trend of approved systems vs. ungoverned discoveries.
- **Governance queue** — next-best actions pulled from every system in the registry (systems without assessments, pending approvals, expiring exceptions).
- **Segment risk heat maps** — risk breakdowns by department, vendor, and data sensitivity.
- **Remediation status** — clickable summary cards for open alerts, investigations, compliance issues, risk issues, renewal alerts, and ownership escalations. Each routes to the relevant page.
- **Automated governance recommendations** — AI-generated next-best-action suggestions per system, linked to the registry.

## Where to start

- **Admins**: check **Settings → Provider Admin APIs** and **Settings → Shadow AI** first so telemetry and discovery are flowing.
- **Compliance officers**: work the governance queue top-down and triage open alerts.
- **Viewers**: browse the Registry and Risk Center to read the current state.

## Tips

- Click any stat card or remediation card to drill into that module.
- The **Needs Review** count only includes high-confidence `DISCOVERED` shadow-AI tools — low-confidence candidates have their own review queue.
- The **Executive posture chart** reflects overall compliance + risk + approval health; drift shows up here first.
