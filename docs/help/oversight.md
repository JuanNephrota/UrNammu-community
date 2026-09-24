# Oversight

Provider-level usage, cost, anomaly, vendor, and investigation telemetry.

## How provider sync works
With an Anthropic admin key, an OpenAI admin key, a Cursor admin key, a GitHub Copilot token, a ChatGPT Enterprise Admin key, and/or Google Gemini billing export configured in **Settings → Provider Admin APIs** (gateway and ChatGPT Enterprise keys live under **Settings → Integrations**), each provider has its own hourly cron that syncs once that provider's own interval has elapsed since its last successful run, and writes into:

- `UsageBucket` — tokens / requests per provider / model / project / actor / time bucket.
- `CostBucket` — amount and line-item cost, with the same attribution columns as `UsageBucket` (API key, workspace, governed system).
- `AssistantDailyStat` — one row per person per day (per product for Claude Enterprise) for the assistants: Claude Code via the Anthropic Admin API analytics report, Cursor via the Cursor Admin API, GitHub Copilot via the Copilot usage metrics reports, Claude Enterprise via the Analytics API (chat, Claude Code, Cowork, Design, Office), and, from the ChatGPT Enterprise Compliance API, `chatgpt` (messages sent, conversations) and `codex` (prompts, sessions, tool calls, tokens, cost): sessions, requests / messages, lines added / removed / accepted, commits, PRs, tool accept / reject, tokens, and cost as real columns rather than JSON.
- `ComplianceActivity` — immutable auth, admin-audit, and API-key lifecycle events from provider compliance feeds (ChatGPT Enterprise, provider `openai`; the Anthropic Compliance API activity feed, provider `anthropic`), keyed by the upstream event id so overlapping pulls never duplicate. Metadata only.
- `ComplianceSession` — Claude app session metadata from the Anthropic Compliance API (product surface, person, workspace, timestamps — never transcripts).
- `ProviderSyncWatermark` — per provider, how far the incremental pull has reached and the earliest day ingested; feed-style providers also keep an upstream cursor while a backfill drains.
- `ProviderProject` / `ProviderActor` — workspaces (Anthropic Console workspaces, OpenAI projects, LiteLLM teams) and members discovered upstream.
- `ProviderSyncRun` — a record of each sync attempt.

**If a provider's admin key is not configured, that provider is skipped cleanly** — no sync-run row, no upstream call. The manual-sync panel reports this as "Skipped (not configured): …" so it is clear which providers are actually active.

**Syncs are incremental.** Each provider resumes from its watermark (the last UTC day fully ingested), re-pulling the last 2 days so late corrections land, and never reaching further back than the provider retains (Cursor 30 days; Anthropic, OpenAI, Gemini 90; gateways 30). A fresh install's first run covers up to 31 days. To pull older history, use **Settings → Provider Admin APIs → Sync History & Backfill**, which walks a date range in 7-day chunks. If a paginated fetch hits its page cap the run is marked truncated and a `provider_sync_truncated` alert is raised — totals for that window are under-counted until it is backfilled with a narrower range.

What each sync records, beyond the shared bucket shape:

- **Anthropic** — organization usage per model, API key, and workspace; cost per workspace, model, and cost type (the cost report has no API-key dimension, so Anthropic spend is attributed at workspace granularity); the workspace list; plus the Claude Code analytics feed (sessions, lines, commits, estimated cost per developer) that backs Usage by Person when a machine is not instrumented with OTel.
- **OpenAI** — usage per model and project, including prompt-cache hits as `cacheReadTokens`, and request counts. Usage and cost results are paginated; if the page cap is hit the sync-run metadata records `truncated: true` so a partial day is never mistaken for a quiet one.
- **Cursor Admin API** — per-user, per-day requests, tokens, accepted lines, and charged spend. This is where Cursor tokens and cost come from; the Cursor OTel hook carries neither.
- **GitHub Copilot usage metrics** — per-user, per-day interactions, accepted lines, CLI / Copilot-app tokens, and feature / IDE / model breakdowns from the `users-1-day` report, organization totals (daily / weekly / monthly active users, pull-request metrics) from the `organization-1-day` report, and seat assignments with `last_activity_at`. Walks day by day from the watermark, at most 28 days per run; reports land within two days, so the newest day or two may show as "not yet published" until the next sync. Copilot is seat-licensed — no cost is derived.
- **ChatGPT Enterprise Compliance API** — workspace users (email, role, status) as `ProviderActor` rows with provider `chatgpt`; `AUTH_LOG` and `AUDIT_LOG` events into `ComplianceActivity`; `CONVERSATION_MESSAGE` events counted into per-user daily `chatgpt` rows (messages sent, assistant replies, conversations, models, client surfaces — never content); `CODEX_LOG` and `CODEX_TURN` events into per-user daily `codex` rows (prompts, sessions, tool calls, tokens, USD cost when reported). Each log stream resumes from its own cursor in `ProviderSyncWatermark`; the platform keeps files for 30 days, so the first sync reaches back 7 days and each run downloads at most 40 files per stream, recording `truncated: true` when more are waiting.
- **Portkey** — one usage and cost bucket per day per model, and one usage bucket per day per user. Portkey reports cost in cents; the sync divides by 100 and records a `reconciliation` block in the sync-run metadata comparing the org-level graph total with the summed per-model and per-user totals so the unit assumption is auditable.
- **Gemini** — spend and best-effort project attribution from the BigQuery billing export.
- **Anthropic Compliance API** (`anthropic_compliance`) — the Activity Feed, newest first: each run re-reads everything newer than its watermark (minus a 6-hour overlap; rows are keyed by upstream id so re-reads are free) and resumes any backfill that hit the page cap from the stored cursor. The first run reaches back 30 days (setting `anthropic_compliance_lookback_days`); the feed has no history before it was enabled in the Anthropic Console. Works with a Compliance Access Key (`read:compliance_activities`) or, feed only, the existing Admin API key. With a Compliance Access Key that also has `read:compliance_user_data`, local and remote Claude app sessions are pulled as metadata. New `api_key_created` activities also create `ApiKeyProfile` rows so key-usage rules know the key before its first token moves.
- **Claude Enterprise Analytics** (`claude_enterprise`) — per-user daily activity per product, the DAU / WAU / MAU / seats summaries, and the per-user usage and cost reports (fractional cents, converted to USD). The API lags about a day and revises cost for up to 30 days, so each run re-pulls the 3 days behind its watermark up to yesterday, at most 14 days per run. Needs an Analytics API key (`read:analytics`).

Because every provider runs in its own function, a slow or failing provider does not delay the others, and one healthy provider cannot reset the clock for a stalled one. **Settings → Provider Admin APIs** shows each provider's last run, its outcome, and when it is next due.

## Pages

- **Overview** — totals, breakdowns, top cost drivers, anomaly findings, and two attribution panels: **Cost by Governed System** (spend per registered AI system, with the attributed share of total spend and an unattributed remainder) and **Cost by API Key** (per-key spend where the provider reports it; Anthropic rows are workspaces). Both read the mapping configured under **Settings → Provider Admin APIs → Usage Attribution**: a default system per provider plus per-key overrides, applied to usage and cost alike on the next sync.
- **Usage** — drill into normalized buckets; link usage to a system for attribution.
- **Vendors** — vendor profiles with contract lifecycle, security review, data residency, subprocessors, approved use cases. **Add vendor** starts a guided setup that saves after each step, and each vendor page has an onboarding checklist that links to whatever is missing. **Start questionnaire** on a vendor page runs a 19-question security and data-handling review. Finishing it records your decision (approve, approve with conditions, or reject) as the vendor's security review status.
- **Investigations** — follow-up queue for alerts and incidents.
- **Provider Posture** — side-by-side provider comparison: cost, tokens, incidents, risk tier.
- **Provider Security** — audits each configured provider's secure-use and privacy configuration: credentials, encryption, data retention, training-on-data, residency, and vendor governance.

## Per-surface developer-AI dashboards

One page per AI surface, because the telemetry each one emits is different:

- **Claude Platform** — two tabs. **Console & API**: Anthropic Console / API usage, cost, and access from the Anthropic Admin API sync, including active API keys and organization members. **Enterprise**: Claude Enterprise adoption from the Analytics and Compliance APIs — daily / weekly / monthly active users, seats and pending invites, active users and cost per product (chat, Claude Code, Cowork, Design, Office), top people by Enterprise cost, Claude app sessions by product surface, the activity-feed type mix, open compliance alerts, and the health of both syncs. Last 30 days.
- **Claude Code** — per-user developer productivity and usage from live OpenTelemetry data. Last 7 days. People with no OTel data are filled in from the Anthropic Admin API analytics sync and marked "est." Has two drilldowns: an **Audit Log** of per-event records, and **Session Traces** (below).
- **Cowork** — productivity, cost, and governance metrics for Claude Cowork (Claude Desktop VM) sessions, from OTel. Last 7 days.
- **GitHub Copilot** — per-developer Copilot activity from the usage metrics reports, last 28 days: active developers vs assigned seats, lines accepted vs suggested, acceptance rate, interactions, organization adoption (DAU / WAU / MAU, adoption phases), pull requests created / merged / reviewed by Copilot, breakdowns by feature, IDE, model, and language, third-party agents used through Copilot (Claude, Codex), per-developer rows, and **idle seats** (no activity for 30+ days — reclaim or review). Developers appear by seat email when GitHub exposes one, otherwise by `@login`.
- **Cursor** — developer activity from Cursor via OTel spans. Last 7 days. **Cursor's hook carries no token or cost data**, so the span metrics are activity only; spend and per-user lines come from the Cursor Admin API sync when its team key is configured — do not read the absence of spend here as zero spend.

## Usage by Person

**Oversight → Usage by Person** answers "who is using what, and what does it cost?" with one row per human across every surface UrNammu observes:

- **Claude Code** and **Cowork** — live OTel metrics (Cowork is the Claude Desktop `local-agent` surface; everything else counts as Claude Code, so the two never overlap). When a person has no OTel data, the Anthropic Admin API analytics sync (`AssistantDailyStat`) fills in sessions, lines, commits, and an estimated cost, marked "est."
- **Claude Enterprise** — the Claude Enterprise Analytics API sync (`AssistantDailyStat` provider `claude_enterprise`): active days, messages, tokens, and cost across Claude.ai chat, Cowork, Design, and the Office add-ins. The Claude Code product is left out of this column because Claude Code already has its own. Cost shows as "n/a" until the per-user cost report has landed for the window (about a day behind).
- **Cursor** — the Cursor Admin API sync (`AssistantDailyStat`). Active days count only days Cursor marks the seat active. Per-user spend comes from the usage-events feed; when that feed returned nothing for the synced window, Cursor cost shows as "n/a" rather than zero.
- **GitHub Copilot** — the Copilot usage metrics sync (`AssistantDailyStat`): interactions, CLI / Copilot-app tokens, accepted lines, and active days. Seat-licensed, so it never adds to cost. A person is matched by the seat's email when GitHub exposes one; seats keyed only by GitHub login stay unattributed until an identity source maps the login to an email.
- **API (proxy)** — Anthropic and OpenAI calls through the governance proxy, attributed by the `x-user-email` header, with a count of flagged requests.

People are matched by lower-cased email. When a **directory sync** is enabled (**Settings → Users & Identity**), every observed email is first resolved through the directory's alias map, so a person seen as `ada.lovelace@` in Cursor and `ada@` through the proxy is one row keyed by their directory primary address; name and department then come from the directory. Without a directory, name and department come from the UrNammu user profile when one exists, otherwise from the provider's member directory. Each row also carries a directory status — `active`, `deactivated`, or `unknown` (no directory match) — and deactivated accounts that still show usage get a **Deactivated** badge; the CSV includes the status as a column. Anything without an email identity (anonymous proxy calls, API-key actors, un-tagged OTel clients) is kept out of the table and totalled in the **Unattributed cost** card so totals stay honest. Anthropic Console usage is reported per API key, not per person, and is intentionally excluded — see **Claude Platform** for that view.

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
