# Settings

Most settings require `ADMIN`. Secret values are encrypted in the database with `SETTINGS_ENCRYPTION_KEY`.

## Sections

- **Overview** — jump-off page to every settings area.
- **General** — choose the AI provider (Anthropic / OpenAI) and model used for in-app AI features (risk suggestion, compliance gap analysis, agent risk review, summarization). The global **policy enforcement mode** for the proxy — Off / Dry run / Enforce — is also set here, along with Azure Monitor access for Proxy Health and the **Data Retention** card.
- **Provider Admin APIs** — admin keys for org telemetry: Anthropic, OpenAI, Cursor, Google Gemini billing export, plus the AI gateways (the ChatGPT Enterprise Compliance API key lives on the **Integrations** page, and its `chatgpt_enterprise` sync appears in the per-provider table here). The **Background Provider Sync** card sets the global auto-sync default and interval, and a per-provider table lets each provider (including Claude Code analytics and each gateway) override both, with its last run, outcome, and next-due time. Unset overrides inherit the global value. Anomaly thresholds, governance-automation notice days, and **Usage Attribution** live here too: a default registered AI system per provider (Anthropic, OpenAI, LiteLLM, Cursor) and per-API-key overrides that map an individual provider key to a system. Mappings apply to both usage and cost rows on the next sync and drive the Cost by Governed System / Cost by API Key panels on Oversight.
- **Proxy Setup** — shared `PROXY_SECRET` for the transparent Claude / OpenAI proxy. Generates ready-to-paste config for Claude Code (managed settings or per-user). Supports attribution headers: `x-user-email`, `x-department`, `x-ai-system-id`, `x-agent-id`. For per-user attribution in Claude Code, developers add `export PROXY_USER_EMAIL="$(git config user.email)"` to their shell profile.
- **Users & Identity** — manage users and roles. Configure Google OAuth, Microsoft 365 / Entra ID sign-in, and password-backed local accounts. The **Directory sync** card (see below) pulls the people directory from Google Workspace and/or Microsoft Entra ID.
- **Shadow AI** — credentials and scan controls for every discovery source (Google Workspace, Microsoft 365, Hexnode, CrowdStrike, Netskope), plus DNS / proxy import, the blocklist feed token, and the enforcement readiness summary.
- **Reporting** — email delivery for scheduled reports, via Resend. Schedules save without it but never send.

For a catalog view of every external service and whether it is connected, use the **Integrations** page instead. Settings is where behavior is configured; Integrations is where you see coverage at a glance.

## Directory sync

**Settings → Users & Identity → Directory sync** keeps a copy of your identity provider's people directory (`DirectoryPerson`) so the rest of the platform can stop guessing who someone is. One card per source, each with an **Auto-sync** toggle, an **Interval** (default 24 h), the last run's outcome and counts, active / deactivated people counts, and a **Sync now** button. **Both sources are off by default.**

- **Google Workspace directory** — reuses the Shadow AI service account and admin email. The service account's domain-wide delegation grant must also include `https://www.googleapis.com/auth/admin.directory.user.readonly`; without it the run fails with an authorization error and nothing is written.
- **Microsoft Entra ID directory** — reuses the Shadow AI tenant app. The app registration needs the Graph application permission `User.Read.All` (admin consented). Guest accounts (`#EXT#` in the UPN) are skipped unless **Guest accounts** is set to include them.

Each run is a full sync: every person returned is upserted (email addresses lower-cased, aliases deduped and never repeating the primary), and anyone in that source who was **not** returned is marked deactivated. That deactivation step only runs after at least one page was fetched successfully and the listing was not cut short by the 100-page cap, so a credentials failure or an oversized tenant can never mass-deactivate the directory. Runs are recorded as `ProviderSyncRun` rows with sync type `directory`.

What the directory feeds:

- **Usage by Person** — observed emails are resolved through the alias map, so one person seen under two addresses becomes one row; name and department come from the directory first. Rows for deactivated accounts carry a **Deactivated** badge.
- **Shadow AI** — each discovered tool's user list is rolled up by department (for example "Engineering 4 · Sales 2").
- **Offboarding** — when a directory account goes inactive and a UrNammu user with the same email is `ACTIVE`, that user is set to `SUSPENDED` (never deleted), their sessions are cleared, and an audit log entry records why.
- **Usage after deactivation** — the hourly governance-automation cron raises a `HIGH` alert (source `usage_after_deactivation`) when a deactivated person's email or alias still shows activity in the proxy buckets, coding-assistant daily stats, or the proxy request log dated after the deactivation. One alert per person per 7 days.

Environment fallbacks: `DIRECTORY_SYNC_GOOGLE_WORKSPACE_ENABLED`, `DIRECTORY_SYNC_GOOGLE_WORKSPACE_INTERVAL_HOURS`, `DIRECTORY_SYNC_MICROSOFT_365_ENABLED`, `DIRECTORY_SYNC_MICROSOFT_365_INTERVAL_HOURS`, `DIRECTORY_SYNC_INCLUDE_GUESTS`. The daily crons run at 04:10 UTC (Google) and 04:20 UTC (Microsoft) and only do work when the source is enabled, configured, idle, and past its interval.

## Enforcement readiness

**Settings → Shadow AI** summarizes whether a `BLOCKED` shadow-AI decision can actually be enforced, across three checks:

- **Identity — Google Workspace**
- **Identity — Microsoft 365 (Entra)**
- **Network — Blocklist feed**

Identity enforcement disables a federated app at the IdP; the network feed publishes blocked domains for a DNS, proxy, firewall, or CASB to consume. Both are optional, but with neither configured a block is only a recorded decision. Microsoft app-disable additionally needs admin consent for the relevant Graph permission — the readiness card reports it as `failed` rather than silently doing nothing.

The blocklist feed token can be generated here (64 random characters). The feed fails closed: with no token set it returns `503` instead of serving unauthenticated.

## Data retention

**Settings → General → Data Retention** sets how many days of raw collection rows the nightly prune crons keep. Each table has its own window; blank means "use the environment variable or built-in default", and `0` disables pruning for that table.

- **Proxy request log** (`APIUsageLog`) — default 180 days. The hourly and daily usage / cost buckets keep the totals, so dashboards do not change when raw rows are pruned.
- **Agent tool calls** (`AgentToolCall`) — default 180 days. Agent tool profiles keep the counts.
- **Policy denials** (`PolicyDenial`) — default 365 days.
- **Provider raw snapshots** (`ProviderRawSnapshot`) — default 14 days. Raw admin-API payloads captured during provider syncs, kept only for debugging.
- **Proxy health snapshots** (`ProxyHealthSnapshot`) — default 90 days.
- **Scan runs** (`SensitiveScan`, `ProviderSecurityScan`) — default 365 days. The newest run overall and the newest run covering each provider are always kept, so the latest posture per provider never disappears.
- **Compliance activity** (`ComplianceActivity`) — default 365 days. Auth and admin-audit events from provider compliance feeds (ChatGPT Enterprise). The upstream platform keeps only 30 days, so this table is the long-term record.
- **Claude Code telemetry** and **Cursor telemetry** — default 30 days each; these are the existing OTel prune crons.

Usage and cost buckets are the long-term aggregate and are **never** pruned. The prune runs daily at 03:45 UTC (`/api/cron/prune-collection`), deletes oldest-first in batches of 5,000, and reports per-table `deleted` / `remaining` counts. A backlog too large for one run drains over consecutive nights.

## Roles

- `ADMIN` — everything.
- `COMPLIANCE_OFFICER` — create / assign policies, approve stages, create exceptions, upload evidence, close incidents.
- `VIEWER` — read-only.

## Tips

- The first user to sign in via Google OAuth is auto-promoted to `ADMIN`. Subsequent users default to `VIEWER`.
- Settings UI values **win over** environment variables. Env vars are the fallback when the DB value is absent.
- Do **not** rotate `SETTINGS_ENCRYPTION_KEY` in place — encrypted settings will become unreadable.
