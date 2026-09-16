# Oversight

Provider-level usage, cost, anomaly, vendor, and investigation telemetry.

## How provider sync works

With an Anthropic admin key, an OpenAI admin key, a Cursor Admin API key, and/or Google Gemini billing export configured in **Settings → Provider Admin APIs** (plus any AI gateway keys under **Settings → Integrations**), the maintenance cron pulls data on the shared provider sync interval and writes into:

- `UsageBucket` — tokens / requests per provider / model / project / actor / time bucket.
- `CostBucket` — amount and line-item cost.
- `ProviderProject` / `ProviderActor` — workspace membership discovered upstream.
- `ProviderSyncRun` — a record of each sync attempt.

**If a provider's admin key is not configured, that provider is skipped cleanly** — no sync-run row, no upstream call. The manual-sync panel reports this as "Skipped (not configured): …" so it is clear which providers are actually active.

What each sync records, beyond the shared bucket shape:

- **Anthropic** — organization usage and cost per model and API key, plus the Claude Code analytics feed (sessions, lines, commits, estimated cost per developer) that backs Usage by Person when a machine is not instrumented with OTel.
- **OpenAI** — usage per model and project, including prompt-cache hits as `cacheReadTokens`, and request counts. Usage and cost results are paginated; if the page cap is hit the sync-run metadata records `truncated: true` so a partial day is never mistaken for a quiet one.
- **Cursor Admin API** — per-user, per-day requests, tokens, accepted lines, and charged spend. This is where Cursor tokens and cost come from; the Cursor OTel hook carries neither.
- **Portkey** — one usage and cost bucket per day per model, and one usage bucket per day per user. Portkey reports cost in cents; the sync divides by 100 and records a `reconciliation` block in the sync-run metadata comparing the org-level graph total with the summed per-model and per-user totals so the unit assumption is auditable.
- **Gemini** — spend and best-effort project attribution from the BigQuery billing export.

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
- **Cursor** — developer activity from Cursor via OTel spans. Last 7 days. **Cursor's OTel hook carries no token or cost data**; tokens and spend on this page come from the Cursor Admin API sync when it is configured. Without that sync these are activity metrics only — do not read the absence of spend here as zero spend.

## Usage by Person

**Oversight → Usage by Person** answers "who is using what, and what does it cost?" with one row per human across every surface UrNammu observes:

- **Claude Code** and **Cowork** — live OTel metrics (Cowork is the Claude Desktop `local-agent` surface; everything else counts as Claude Code, so the two never overlap). When a person has no OTel data, the Anthropic Admin API analytics sync fills in sessions, lines, commits, and an estimated cost, marked "est."
- **Cursor** — the Cursor Admin API sync. Per-user spend is recorded from the usage-events feed on each sync; days synced before that field existed show Cursor cost as "n/a" rather than zero.
- **API (proxy)** — Anthropic and OpenAI calls through the governance proxy, attributed by the `x-user-email` header, with a count of flagged requests.

People are matched by lower-cased email. Name and department come from the UrNammu user profile when one exists, otherwise from the provider's member directory. Anything without an email identity (anonymous proxy calls, API-key actors, un-tagged OTel clients) is kept out of the table and totalled in the **Unattributed cost** card so totals stay honest. Anthropic Console usage is reported per API key, not per person, and is intentionally excluded — see **Claude Platform** for that view.

Pick a **7 / 30 / 90-day** window, search by name, email, or department, click a surface chip to open that dashboard filtered to the person, or **Download CSV** for the full column set. **Save as report** (`ADMIN` / `COMPLIANCE_OFFICER`) creates a report from the **Usage by Person** template so the view can be exported as PDF/CSV/JSON and scheduled for email delivery.

## Session traces

**Oversight → Claude Code → Session Traces** reconstructs a session as turns, model calls, and tool use in execution order, rendered as a waterfall.

Spans are **derived from event timing**, not emitted as spans by the client — so treat durations as close approximations rather than instrumented measurements. Long idle gaps are compressed in the rendering so a session with a lunch break in the middle stays readable; each span carries a status of `ok`, `error`, `denied`, or `flagged`.

Traces cover a 30-day window and are metadata only — no prompt text and no code content, on this page or in the audit log.

## Dangerous prompt monitoring

When traffic flows through the proxy, prompts are scanned for 5 risk categories: prompt injection, secret extraction, data exfiltration, malware/phishing generation, and dangerous autonomy. Findings appear as structured alerts with matched signals, sanitized excerpts, and related usage logs. False positives can be marked with exceptions that suppress similar future alerts.

## Proxy attribution

Proxy traffic is attributed via optional headers: `x-user-email` (per-user cost tracking), `x-department` (cost center), `x-ai-system-id` (link to registry), and `x-agent-id` (link to a registered agent, which also enables MCP tool governance). Configure these in **Settings → Proxy Setup**.

## Proxy token accounting

Every proxy path (Vercel and Azure, Anthropic and OpenAI) records the same four token buckets, so proxy rows and admin-sync rows add up the same way:

- `inputTokens` is **all** input the provider processed: uncached + cache read + cache creation. `cacheReadTokens` and `cacheCreationTokens` are the breakdown, not extra tokens on top.
- Cost is uncached × input price + cache read × cache-read price + cache creation × cache-write price + output × output price, from one pricing table matched by exact model id first, then model family.
- A model missing from the pricing table is **never charged a default**. Its cost is stored as 0 and the usage row's metadata carries `pricingMatched: false`, so unpriced models are visible rather than silently mispriced.
- OpenAI streaming responses now record usage too (the proxy asks OpenAI for the trailing usage chunk when the client did not) and run response DLP like non-streaming calls.
- Anthropic `count_tokens` and `batches` calls pass through the proxy without producing usage rows.

## MCP Activity

**Oversight → MCP Activity** lists every MCP server agents declare and every tool the model invokes through the proxy, with the allowlist verdict for each. Tools invoked outside an agent's allowlist appear under **Needs a decision**; open the agent to approve them or tighten the allowlist.

## Spend budgets

Create a budget by **provider**, **system**, or **department**. Monthly budget + warning threshold % (default 80%). Crossing the threshold raises a `cost_anomaly` alert.

## Anomaly detection

Thresholds live in **Settings → Provider Admin APIs**: recent vs. baseline windows, min token/cost thresholds, per-dimension sensitivity multipliers. When recent usage exceeds baseline × multiplier, a `cost_anomaly` or `model_drift` alert fires.
