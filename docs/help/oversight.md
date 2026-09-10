# Oversight

Provider-level usage, cost, anomaly, vendor, and investigation telemetry.

## How provider sync works

With an Anthropic admin key, an OpenAI admin key, and/or Google Gemini billing export configured in **Settings → Provider Admin APIs**, the maintenance cron pulls data on each provider's own interval and writes into:

- `UsageBucket` — tokens / requests per provider / model / project / actor / time bucket.
- `CostBucket` — amount and line-item cost.
- `ProviderProject` / `ProviderActor` — workspace membership discovered upstream.
- `ProviderSyncRun` — a record of each sync attempt.

**If a provider's admin key is not configured, that provider is skipped cleanly** — no sync-run row, no upstream call. The manual-sync panel reports this as "Skipped (not configured): …" so it is clear which providers are actually active.

## Pages

- **Overview** — totals, breakdowns, top cost drivers, anomaly findings.
- **Usage** — drill into normalized buckets; link usage to a system for attribution.
- **Vendors** — vendor profiles with contract lifecycle, security review, data residency, subprocessors, approved use cases.
- **Investigations** — follow-up queue for alerts and incidents.
- **Provider Posture** — side-by-side provider comparison: cost, tokens, incidents, risk tier.
- **Provider Security** — audits each configured provider's secure-use and privacy configuration: credentials, encryption, data retention, training-on-data, residency, and vendor governance.

## Per-surface developer-AI dashboards

One page per AI surface, because the telemetry each one emits is different:

- **Claude Platform** — Anthropic Console / API usage, cost, and access, from the Anthropic Admin API sync. Includes active API keys and organization members. Last 30 days.
- **Claude Code** — per-user developer productivity and usage from live OpenTelemetry data. Last 7 days. Has two drilldowns: an **Audit Log** of per-event records, and **Session Traces** (below).
- **Cowork** — productivity, cost, and governance metrics for Claude Cowork (Claude Desktop VM) sessions, from OTel. Last 7 days.
- **Cursor** — developer activity from Cursor via OTel spans. Last 7 days. **Cursor's hook carries no token or cost data**, so these are activity metrics only — do not read the absence of spend here as zero spend.

## Session traces

**Oversight → Claude Code → Session Traces** reconstructs a session as turns, model calls, and tool use in execution order, rendered as a waterfall.

Spans are **derived from event timing**, not emitted as spans by the client — so treat durations as close approximations rather than instrumented measurements. Long idle gaps are compressed in the rendering so a session with a lunch break in the middle stays readable; each span carries a status of `ok`, `error`, `denied`, or `flagged`.

Traces cover a 30-day window and are metadata only — no prompt text and no code content, on this page or in the audit log.

## Dangerous prompt monitoring

When traffic flows through the proxy, prompts are scanned for 5 risk categories: prompt injection, secret extraction, data exfiltration, malware/phishing generation, and dangerous autonomy. Findings appear as structured alerts with matched signals, sanitized excerpts, and related usage logs. False positives can be marked with exceptions that suppress similar future alerts.

## Proxy attribution

Proxy traffic is attributed via optional headers: `x-user-email` (per-user cost tracking), `x-department` (cost center), and `x-ai-system-id` (link to registry). Configure these in **Settings → Proxy Setup**.

## Spend budgets

Create a budget by **provider**, **system**, or **department**. Monthly budget + warning threshold % (default 80%). Crossing the threshold raises a `cost_anomaly` alert.

## Anomaly detection

Thresholds live in **Settings → Provider Admin APIs**: recent vs. baseline windows, min token/cost thresholds, per-dimension sensitivity multipliers. When recent usage exceeds baseline × multiplier, a `cost_anomaly` or `model_drift` alert fires.
