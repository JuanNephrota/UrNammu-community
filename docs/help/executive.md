# Executive Dashboard

A board-ready posture overview. Where the **Dashboard** is a working queue, this page is the narrative you take into a governance review or board meeting.

## Governance score

A single 0–100 score, computed as a weighted blend of five dimensions:

- **Compliance** (25%) — share of policy assignments in a compliant state.
- **Risk Posture** (25%) — distribution of system risk levels across the portfolio.
- **Governance Coverage** (20%) — how much of the registry has assessments, owners, and approvals on file.
- **Shadow AI** (15%) — unresolved discoveries relative to governed systems.
- **Incident Health** (15%) — open incidents and critical alerts in the period.

Because the dimensions are weighted, a strong compliance rate will not hide a growing shadow-AI backlog — each dimension is also shown on its own so you can see which one is dragging the score.

## Board metrics

Six headline figures, each with a period-over-period delta: **Governance Score**, **Compliance Rate**, **Avg Risk Score**, **Monthly Spend**, **Shadow AI Backlog**, and **Open Incidents**.

Deltas compare the selected period against the immediately preceding one of equal length, so a "improving" arrow always means improving **relative to last period**, not against an absolute target.

## Posture narrative

A written summary generated from the metrics — what moved, by how much, and the likely driver. Use it as the starting point for a governance update rather than a final draft; it describes the numbers but does not know your organization's context.

## Charts

- **12-Month Posture Trend** — rolling monthly governance score, so drift is visible before it becomes a finding.
- **Risk by Department** and **Risk by Vendor** — the same heat maps as the Dashboard, included here so a single export covers the whole story.

## Notes on the numbers

- Spend figures deduplicate proxy traffic against provider-reported usage, so a request logged by both the proxy and a provider admin API is counted once.
- Systems are counted as of the period end, so retroactively registering a system changes historical counts.
- The score is recomputed on each page load; it is not snapshotted. Use **Reports → Executive Summary** if you need a fixed artifact for a specific date.
