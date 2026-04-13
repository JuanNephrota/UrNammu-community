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
- **Claude Code** — Claude Code sessions, tool accept/reject, lines added/removed.

## Spend budgets

Create a budget by **provider**, **system**, or **department**. Monthly budget + warning threshold % (default 80%). Crossing the threshold raises a `cost_anomaly` alert.

## Anomaly detection

Thresholds live in **Settings → Provider Admin APIs**: recent vs. baseline windows, min token/cost thresholds, per-dimension sensitivity multipliers. When recent usage exceeds baseline × multiplier, a `cost_anomaly` or `model_drift` alert fires.
