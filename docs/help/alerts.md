# Alerts

Centralized alert inbox for governance signals.

## Lifecycle

`OPEN` → `ACKNOWLEDGED` → `RESOLVED` / `DISMISSED`

- **Acknowledge** — marks as seen / being worked.
- **Create Investigation** — opens an Investigation pre-linked to this alert.
- **Resolve** — addressed.
- **Dismiss** — not a real issue.

## Alert sources

- `policy_violation` — a policy rule evaluated to a violation.
- `risk_reassessment` — a system's `nextReviewDate` is approaching or overdue.
- `discovery` — new shadow-AI tool discovered.
- `compliance_gap` — AI compliance analysis found a gap.
- `incident` — a governance incident was opened.
- `renewal` — vendor contract renewal is approaching.
- `escalation` — a review is overdue past the escalation threshold.
- `model_drift` — usage pattern deviates from baseline.
- `data_exposure` — restricted-sensitivity data observed in provider telemetry.
- `cost_anomaly` — spend crossed a budget or anomaly threshold.
- `ownership_escalation` — system has no owner assigned.

## Severity

`CRITICAL` / `HIGH` / `MEDIUM` / `LOW` / `INFO` — drives the badge color and sort order.
