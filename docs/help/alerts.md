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
- `key_usage_rule` — an API key's usage tripped a key usage rule.
- `chatgpt_compliance_api` — the ChatGPT Enterprise sync saw a workspace admin role granted (users export or `USER_ROLE_UPDATED` / `INVITE_USERS` audit events) or a new GPT whose configuration includes custom actions (HIGH when shared by link or in the GPT Store). One open alert per subject; re-syncs do not duplicate it.

## Dangerous prompt alerts

When traffic flows through the proxy, prompts are analyzed for jailbreak attempts, credential extraction, data exfiltration, malware generation, and unsafe autonomy patterns. These alerts show structured investigation detail:

- **Provider & model badges** — which AI provider and model were used.
- **Category badges** — which risk rules triggered, color-coded by severity.
- **Matched signals** — the exact phrases that matched, shown as code elements.
- **Sanitized excerpt** — a redacted snippet of the prompt text (full prompts are never stored).
- **Related usage logs** — expandable panel showing flagged API calls near the alert.
- **Same prompt, other sightings** — shown when the identical prompt was seen more than once or raised other alerts. See below.

## Cross-surface prompt correlation

Every scanned prompt — from the API proxy, Claude Code, and Cursor — is reduced to a **prompt hash**: a salted fingerprint of the normalized text (trimmed, whitespace collapsed, lower-cased). The hash is stored; the prompt is not. It cannot be reversed without the salt, which is never written to the database records it protects.

- If the same prompt is seen again while its alert is still `OPEN` (within 24 hours), no second alert is raised. The existing alert's **Seen N times across …** line counts the repeat and records which surfaces and people sent it.
- **Other alerts with this prompt** lists alerts sharing the hash — the same prompt seen on another day, or after the first alert was resolved. Click one to jump to it.
- The truncated hash in the card header can be copied to search usage logs and Claude Code / Cursor telemetry, which carry the same value.
- Alerts without a hash (older alerts, or installs with no salt configured) fall back to the previous behaviour: repeats of the same signal fold into one alert for an hour.

The salt comes from the `prompt_hash_salt` setting (or the `PROMPT_HASH_SALT` environment variable), falling back to `NEXTAUTH_SECRET`. Configure the same value for the Azure proxy so its hashes match.

## False positive marking

If a dangerous prompt alert is benign (e.g. legitimate security testing), click **False Positive**:

- Enter a reason explaining why it is a false positive.
- Optionally check **Create exception** to suppress similar future alerts for the matched categories.
- The alert is dismissed and tagged with a "False Positive" badge.

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

## Key usage rules

Where dangerous-prompt rules inspect **what** is being asked, key usage rules watch **how a credential behaves**. Manage them at **Alerts → Key usage rules**. Each rule evaluates provider telemetry per API key and raises a `key_usage_rule` alert.

Seven condition types are available:

- `VOLUME_THRESHOLD` — absolute tokens, cost, or requests over a window past a ceiling.
- `SPIKE_MULTIPLIER` — a recent window compared against the immediately preceding baseline window.
- `NEW_KEY` — a key seen for the first time, with non-trivial volume.
- `DORMANT_REACTIVATION` — a key idle for N days that started transacting again.
- `OFF_HOURS` — activity outside declared business hours and days. Requires hourly buckets.
- `MODEL_ALLOWLIST` — a key used a model outside its allowlist.
- `FAN_OUT` — a key suddenly spanning more distinct projects or actors than expected.

Eight rules ship enabled by default, covering spend spikes, token spikes, a daily spend ceiling, first-time key activity, dormant reactivation, off-hours use, non-approved models, and project fan-out.

Rule keys are **immutable** once created, because alert dedupe references them. Built-in rules can be edited, disabled, or reset to their original definition; custom rules can be created and deleted freely.

Use **Preview** before enabling a rule — it dry-runs the config against recorded telemetry and reports the findings it **would** have raised plus how many keys were evaluated. It writes nothing: no alerts, no profile updates. This is the fastest way to catch a threshold that would bury you in alerts. **Reset** restores a built-in to its shipped defaults.

Off-hours rules carry an explicit timezone offset and business-day list. Set these deliberately: the default will not match a distributed team, and a mis-set timezone makes every normal working day look like off-hours activity.

## Severity

`CRITICAL` / `HIGH` / `MEDIUM` / `LOW` / `INFO` — drives the badge color and sort order.
