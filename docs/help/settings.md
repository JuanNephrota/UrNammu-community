# Settings

Most settings require `ADMIN`. Secret values are encrypted in the database with `SETTINGS_ENCRYPTION_KEY`.

## Sections

- **Overview** — jump-off page to every settings area.
- **General** — choose the AI provider (Anthropic / OpenAI) and model used for in-app AI features (risk suggestion, compliance gap analysis, agent risk review, summarization). The global **policy enforcement mode** for the proxy — Off / Dry run / Enforce — is also set here, along with Azure Monitor access for Proxy Health and the **Data Retention** card.
- **Provider Admin APIs** — admin keys for org telemetry: Anthropic, OpenAI, Cursor, Google Gemini billing export, plus the AI gateways. The **Background Provider Sync** card sets the global auto-sync default and interval, and a per-provider table lets each provider (including Claude Code analytics and each gateway) override both, with its last run, outcome, and next-due time. Unset overrides inherit the global value. Anomaly thresholds, governance-automation notice days, and **Usage Attribution** live here too: a default registered AI system per provider (Anthropic, OpenAI, LiteLLM, Cursor) and per-API-key overrides that map an individual provider key to a system. Mappings apply to both usage and cost rows on the next sync and drive the Cost by Governed System / Cost by API Key panels on Oversight.
- **Proxy Setup** — shared `PROXY_SECRET` for the transparent Claude / OpenAI proxy. Generates ready-to-paste config for Claude Code (managed settings or per-user). Supports attribution headers: `x-user-email`, `x-department`, `x-ai-system-id`, `x-agent-id`. For per-user attribution in Claude Code, developers add `export PROXY_USER_EMAIL="$(git config user.email)"` to their shell profile.
- **Users & Identity** — manage users and roles. Configure Google OAuth, Microsoft 365 / Entra ID sign-in, and password-backed local accounts.
- **Shadow AI** — credentials and scan controls for every discovery source (Google Workspace, Microsoft 365, Hexnode, CrowdStrike, Netskope), plus DNS / proxy import, the blocklist feed token, and the enforcement readiness summary.
- **Reporting** — email delivery for scheduled reports, via Resend. Schedules save without it but never send.

For a catalog view of every external service and whether it is connected, use the **Integrations** page instead. Settings is where behavior is configured; Integrations is where you see coverage at a glance.

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
