# Alerts

Centralized alert inbox for governance signals.

## Lifecycle

`OPEN` → `ACKNOWLEDGED` → `RESOLVED` / `DISMISSED`

- **Acknowledge** — marks as seen / being worked.
- **Create Investigation** — opens an Investigation pre-linked to this alert.
- **Resolve** — addressed.
- **Dismiss** — not a real issue (for non-prompt-risk alerts).
- **False Positive** — for dangerous prompt alerts only. Requires a reason and optionally creates suppression exceptions.

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
- `dangerous_prompt` — proxy-scanned traffic matched a risky prompt pattern.

## Dangerous prompt alerts

When traffic flows through the proxy, prompts are analyzed for jailbreak attempts, credential extraction, data exfiltration, malware generation, and unsafe autonomy patterns. These alerts show structured investigation detail:

- **Provider & model badges** — which AI provider and model were used.
- **Category badges** — which risk rules triggered, color-coded by severity.
- **Matched signals** — the exact phrases that matched, shown as code elements.
- **Sanitized excerpt** — a redacted snippet of the prompt text (full prompts are never stored).
- **Related usage logs** — expandable panel showing flagged API calls near the alert.

## False positive marking

If a dangerous prompt alert is benign (e.g. legitimate security testing), click **False Positive**:

1. Enter a reason explaining why it is a false positive.
2. Optionally check **Create exception** to suppress similar future alerts for the matched categories.
3. The alert is dismissed and tagged with a "False Positive" badge.

Manage exceptions at **Alerts → Manage prompt risk exceptions**. Exceptions can be deactivated or reactivated. The system only suppresses alert creation — usage is still logged for audit.

## Tuning the detection engine

The dangerous-prompt engine is rule-based and fully tunable at **Alerts → Tune detection rules**. Each rule has:

- A stable **key** (`prompt_injection`, `secret_extraction`, etc.) — this is the identifier referenced by exceptions, so it is **immutable** once created.
- A **label** and optional **description**.
- A **severity** — `critical` → CRITICAL alerts, `warning` → HIGH alerts.
- Up to 10 **regex patterns**, matched case-insensitively against user-authored prompt text only (assistant, tool, and system content are never scanned).

Five built-in rules are seeded on install. Built-ins can be edited, disabled, or reset to their original definition, but cannot be deleted. Custom rules can be created with fresh keys and deleted when no longer needed.

Patterns are validated on save: they must compile as JavaScript regex, fit within 500 chars, and not contain obvious ReDoS shapes (e.g. `(.*)+`). A short probe string is run against each pattern; patterns that take more than 50 ms are rejected.

Use the **Test a prompt** panel on the rules page to dry-run a prompt against the current enabled ruleset without creating an alert. Rule changes take effect within 30 seconds (runtime cache) or immediately on mutation.

## Severity

`CRITICAL` / `HIGH` / `MEDIUM` / `LOW` / `INFO` — drives the badge color and sort order.
