# UrNammu

UrNammu is an AI governance and compliance platform for admin and compliance teams. It combines:

- AI system and agent inventory
- Shadow AI discovery from Google Workspace, Microsoft 365, and DNS/proxy CSV imports
- Risk assessments with templates, branching questions, issue tracking, and agent-aware overlays
- Governance workflows with staged approvals, exceptions, evidence, incidents, renewal automation, and escalations
- Vendor governance with contract, residency, subprocessors, and approved use-case tracking
- Oversight telemetry from provider admin APIs, Google Gemini / Vertex AI billing export, and proxy-based prompt-risk detection

The app is built with Next.js 16, React 19, Prisma, PostgreSQL, and NextAuth.

For installing UrNammu (local dev or production), see the [Install Guide](./docs/install-guide.md).

For end users (compliance officers, admins, reviewers), see the [User Guide](./docs/user-guide.md).

For a codebase walkthrough and extension guide, see [docs/implementation-guide.md](./docs/implementation-guide.md).

## Modules

- `Registry`: central inventory of AI systems
- `Agents`: tracked AI agents and assistants
- `Shadow AI`: discovery and triage of unregistered tools
- `Risk Center`: system and agent-aware risk assessments
- `Compliance`: policy assignment and audit evidence
- `Oversight`: provider usage, costs, anomalies, investigations, and organization telemetry

## Local Setup

1. Install dependencies:

```bash
npm install
```

2. Configure environment variables in `.env`:

```bash
DATABASE_URL=postgresql://...
NEXTAUTH_URL=http://localhost:3001
NEXTAUTH_SECRET=replace-me

# Required to store encrypted settings such as admin API keys and service credentials
SETTINGS_ENCRYPTION_KEY=replace-with-a-long-random-secret

# Optional auth providers
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=

# Optional local-only dev login
ENABLE_DEV_LOGIN=true

# Optional password-backed local accounts
ENABLE_LOCAL_AUTH=true

# Optional Microsoft 365 / Entra ID sign-in
MICROSOFT_CLIENT_ID=
MICROSOFT_CLIENT_SECRET=
MICROSOFT_TENANT_ID=

# Optional Microsoft 365 Shadow AI scanning fallback settings
MICROSOFT_SHADOW_AI_TENANT_ID=
MICROSOFT_SHADOW_AI_CLIENT_ID=
MICROSOFT_SHADOW_AI_CLIENT_SECRET=
MICROSOFT_SHADOW_AI_SCAN_ENABLED=false
MICROSOFT_SHADOW_AI_SCAN_INTERVAL_HOURS=24

# Optional Google Workspace Shadow AI scanning fallback settings
GOOGLE_SCAN_ENABLED=false
GOOGLE_SCAN_LOOKBACK_DAYS=30
GOOGLE_SCAN_INTERVAL_HOURS=24

# Optional public demo experience
DEMO_MODE=true
NEXT_PUBLIC_DEMO_MODE=true

# Optional provider fallbacks
OPENAI_API_KEY=
ANTHROPIC_API_KEY=
PROXY_SECRET=

# Optional Google Gemini / Vertex AI oversight fallback settings
GEMINI_BILLING_SERVICE_ACCOUNT_KEY=
GEMINI_BILLING_PROJECT_ID=
GEMINI_BILLING_DATASET=
GEMINI_BILLING_TABLE=
GEMINI_BILLING_LOCATION=US

# Required if you want background maintenance via cron
CRON_SECRET=replace-with-a-long-random-secret
```

3. Run Prisma migrations and seed data:

```bash
npm run db:migrate
npm run db:seed
```

4. Start the app:

```bash
npm run dev
```

With `DEMO_MODE=true` and `NEXT_PUBLIC_DEMO_MODE=true`, the app shows a visible demo banner and a seeded sample workspace designed for screenshots, evaluation, and open-source exploration.

## Authentication

- Production should use Google OAuth for real admin/compliance users.
- Credentials-based dev login is intended for local testing only.
- Password-backed local accounts can be enabled with `ENABLE_LOCAL_AUTH=true`.
- Microsoft 365 sign-in is available when the Microsoft / Entra environment variables are configured.
- If `ENABLE_DEV_LOGIN=true` is set in production, the app now fails fast.
- The seed script creates `admin@example.com` as a local admin account for development and demo mode.
- The demo seed also sets the local password to `demo-password`.

### Google Setup Split

Google configuration now lives in two different settings areas:

- `Settings > Users & Identity`: Google Sign-In for employee authentication via OAuth
- `Settings > Shadow AI`: Google Workspace and Microsoft 365 discovery for shadow AI scanning

These use different credentials:

- Google Sign-In uses a Google OAuth client ID and client secret
- Google Workspace Discovery uses a service account JSON key plus a Workspace admin email

### Microsoft Setup Split

Microsoft configuration also lives in two different settings areas:

- `Settings > Users & Identity`: Microsoft / Entra ID sign-in for employee authentication
- `Settings > Shadow AI`: Microsoft 365 delegated-app discovery for shadow AI scanning via Microsoft Graph

These use different credentials:

- Microsoft sign-in uses the standard Entra app configuration for OAuth login
- Microsoft 365 Shadow AI Discovery uses a tenant ID, client ID, and client secret for an app with Microsoft Graph application permissions

## Settings and Secret Storage

Integration secrets are stored in `AppSetting`, but secret values are encrypted before persistence. This includes:

- provider API keys
- provider admin API keys
- Google Workspace service account JSON
- Google Gemini / BigQuery service account JSON
- Microsoft 365 Shadow AI client secret
- proxy secrets

`SETTINGS_ENCRYPTION_KEY` is required before saving secret settings through the UI or API.

## Provider Telemetry

Phase 2 introduces a normalized telemetry foundation alongside the legacy `APIUsageLog` table:

- `ProviderSyncRun`: tracks each sync attempt
- `ProviderRawSnapshot`: stores raw provider payloads for audit/debug
- `UsageBucket`: normalized usage aggregates
- `CostBucket`: normalized cost aggregates
- `ProviderProject`: discovered provider-side projects/workspaces
- `ProviderActor`: discovered provider-side users/members

The current admin sync route still backfills derived `APIUsageLog` rows for compatibility, but the main oversight views now read normalized telemetry from `UsageBucket` and `CostBucket`.

Proxy traffic writes to both surfaces. Every request through the Anthropic or OpenAI proxy (Vercel fallback or Azure Functions) synchronously creates an `APIUsageLog` row and idempotently upserts an hourly `UsageBucket` (and matching `CostBucket` when cost is known), linked to a per-hour synthetic `ProviderSyncRun` with `syncType = "proxy_live"`. This makes proxy usage visible on the main Oversight dashboard on the next page load, without waiting for the admin-sync interval.

When traffic flows through the built-in proxy, Oversight can also raise dangerous-prompt alerts from redacted prompt-risk signals without storing full prompt bodies by default.

## Admin Integrations

### OpenAI Admin API

Used for:

- organization usage
- organization costs
- assistant discovery

Configure in `Settings > Provider Admin APIs` with an organization admin key.

### Anthropic Admin API

Used for:

- organization usage reports
- API key inventory
- member inventory

Configure in `Settings > Provider Admin APIs` with an Anthropic admin key.

### Google Gemini / Vertex AI Oversight

Used for:

- Gemini and Vertex AI cost oversight from Google Cloud Billing export data
- project-level spend attribution for Gemini-related usage
- normalized Gemini provider buckets inside AI Oversight

Required settings:

- Google Cloud service account JSON with BigQuery read access
- billing export project ID
- billing export dataset
- billing export table
- BigQuery location

Configure in `Settings > Provider Admin APIs`.

Current implementation notes:

- pulls Gemini / Vertex AI billing data through BigQuery rather than a direct admin usage API
- normalizes Gemini cost and best-effort project/model attribution into the same `UsageBucket` and `CostBucket` pipeline used by other providers
- supports connection testing from settings before enabling scheduled syncs

### Google Workspace

Used for shadow AI discovery from Google Workspace OAuth activity.

Required settings:

- service account JSON with domain-wide delegation
- Google admin email

Configure in `Settings > Shadow AI`.

Recent improvements:

- richer app matching using names, scopes, and extracted domains
- confidence scoring and match reasons in discovery notes
- repeat-activity heuristics such as first seen, last seen, event count, and active days
- low-confidence AI candidates surfaced in debug output for admin review

### Microsoft 365

Used for shadow AI discovery from delegated Microsoft 365 / Entra-connected apps.

Required settings:

- Microsoft tenant ID
- Microsoft client ID
- Microsoft client secret

Configure in `Settings > Shadow AI`.

Recent improvements:

- richer Microsoft Graph signals from delegated grants, service principals, verified publishers, tags, and app role assignments
- weighted vendor matching across names, publishers, domains, scopes, and app IDs
- usage heuristics based on delegated principals and assignment counts
- discovery notes that explain match confidence and observed signals

## Background Scheduling

The project now includes a shared maintenance endpoint for background jobs:

- `GET /api/scheduler/maintenance`
- authenticated with `Authorization: Bearer $CRON_SECRET`

It handles:

- provider admin telemetry sync
- OpenAI assistant follow-up discovery
- Google Gemini / Vertex AI billing-export follow-up syncs
- Google Workspace shadow-AI follow-up scans
- Microsoft 365 shadow-AI follow-up scans
- governance renewal and exception notice alerts
- overdue, blocked, and ownership escalation alerts

Cadence is controlled in Settings:

- `Settings > Provider Admin APIs`: provider sync enable/interval
- `Settings > Shadow AI`: Google Workspace and Microsoft 365 auto-scan enable/interval

For Vercel deployments, [vercel.json](/Users/pmarsh/scripts/AI-gov/vercel.json) is configured to call the maintenance endpoint hourly. The route itself checks each job’s saved interval before running, so one hourly cron can safely drive multiple background jobs.

## Useful Commands

```bash
npm run dev
npm run build
npm run lint
npm run db:migrate
npm run db:seed
npm run db:reset
```

## Important Paths

- `src/app/(dashboard)`: main product UI
- `src/app/api`: route handlers
- `src/lib`: integrations, auth, telemetry, and utilities
- `prisma/schema.prisma`: data model
- `prisma/migrations`: database migrations
- `ai-proxy/`: companion proxy project

## Current Implementation Notes

- Admin sync now persists normalized telemetry for OpenAI, Anthropic, and Google Gemini / Vertex AI billing export data.
- Main oversight views now use normalized `UsageBucket` and `CostBucket` data.
- Oversight now includes metadata-driven restricted-data exposure monitoring, governed-system telemetry attribution, investigation workflows, spend budgets, top cost drivers, configurable anomaly thresholds, baseline anomaly detection, model drift tracking, remediation dashboards, and recommendation queues.
- Oversight now includes proxy-based dangerous prompt detection with risky prompt categories, redacted excerpts, alert generation, and dashboard surfacing for jailbreak, exfiltration, credential, malware, and unsafe-autonomy patterns.
- Workflow notifications now surface approvals, expiring exceptions, drift, incidents, overdue reviews, and active investigations in the main app shell.
- Background maintenance now creates renewal and escalation alerts for upcoming governance reviews, expiring exceptions, overdue systems, and unowned or blocked governance items.
- Policy rules support richer conditions, advisory vs blocking enforcement, and exception-aware evaluation.
- AI compliance analysis now regenerates structured per-policy compliance issues that can be rerun and tracked individually.
- Vendor governance includes editable vendor profiles with contract posture, lifecycle tracking, renewal queues, security review status, data residency, subprocessors, approved use cases, and composite vendor risk scoring.
- Risk Center includes recommended tiers, control-gap detection, agent-aware overlays, branching contextual questions, and use-case templates.
- Shadow AI discovery supports both Google Workspace and Microsoft 365 with improved matching and confidence signals.
- Registry services can now be archived when they are no longer in use, and permanently deleted with explicit typed-name confirmation for duplicate or erroneous entries.
- Dashboard stat cards and remediation status cards are clickable, routing directly to the relevant module page.
- Proxy usage attribution now supports `x-user-email`, `x-department`, and `x-ai-system-id` headers. The setup guide generates Claude Code config snippets that include `${PROXY_USER_EMAIL}` for automatic per-user attribution via `git config user.email`.
- API route validation hardened: alert status updates use Zod enum validation, agent updates check existence before writing, risk assessment operations are wrapped in error handling, and batch usage log ingestion reports per-entry validation errors.
- Database indexes added on `AuditLog` and `Alert` foreign keys for query performance. `AuditLog` cascade deletes properly when users are removed.
- Dangerous prompt alerts now store structured metadata (provider, model, categories, matched signals, excerpt) and render as investigation cards with category badges, signal evidence, and related usage logs.
- False positive marking for prompt risk alerts: dismiss with required reason, optionally create `PromptRiskException` records that suppress similar future alerts. Exceptions are managed at `/alerts/exceptions` and support activation/deactivation.
- Dangerous-prompt detection is a tunable rule engine backed by the `PromptRiskRule` table. Admins can edit, disable, or reset the five built-in rules (`prompt_injection`, `secret_extraction`, `data_exfiltration`, `malware_or_phishing`, `dangerous_autonomy`) and create their own custom rules at `/alerts/prompt-rules`. Patterns are validated against ReDoS shapes and a 50 ms runtime probe before save; rule changes propagate through a 30-second runtime cache. A "Test a prompt" panel dry-runs input against the current enabled ruleset without creating an alert.
- Shadow AI discovery now persists match confidence (high/medium/low), numeric score, and match reasons as first-class fields on `DiscoveredAITool`. Low-confidence candidates are shown in a dedicated review queue with promote and dismiss actions. Dismissed candidates are permanently suppressed via `DismissedCandidate` records so they don't resurface on future scans.
- Shadow AI high-confidence discoveries now have the same **Dismiss** action as low-confidence candidates — useful for flagging false positives, approved shadow usage, or non-AI tools. A required reason is captured in the audit trail.
- Converting a Shadow AI tool to a governed system is now **AI-assisted**: clicking "Convert to Governed System" or "Register & Assess" on a discovered tool calls the configured AI provider (Claude / GPT) to infer `description`, `useCase`, `vendor`, `modelType`, `dataInputs`, `dataOutputs`, `riskLevel`, and `dataSensitivity` from the tool name and metadata. A floating "Analyzing…" banner surfaces progress. Best-effort: if the AI provider isn't configured or the call fails/times out (12s limit) the operation falls back to sensible defaults.
- Registering an AI system manually has a matching **"Autofill with AI"** button next to the System Name field. Type a name (e.g. "ChatGPT", "GitHub Copilot"), click the sparkle button, and the form populates with inferred fields plus a short reasoning note. Vendor is preserved if the user already entered one.
- Policies can now be **edited after creation** — an Edit Policy button on the detail page opens a form pre-populated with every stored field (name, framework, version, status, content, and all machine-readable rules). The backend PUT route and audit logging were already in place; the UI now surfaces them.
- AI System Registry view has a **filter bar** with five dropdowns (department, risk level, status, data sensitivity, vendor). Dropdowns only surface values present in the current dataset; enum filters are ordered by severity / lifecycle. Filters compose AND and combine with the existing name search.
- Claude Code analytics page now extracts per-user token counts from `model_breakdown` metadata instead of reading zero-valued columns, and explicitly separates cache tokens in the display. A Token Volume stat card shows total input/output with the cache tokens called out.
- Anthropic cost ingestion corrected: the admin `cost_report` API returns amounts in **cents**, not dollars (verified empirically against Anthropic's published pricing). Aggregate cost queries now match manual price-book calculations. A Map-based pre-upsert aggregation prevents dimensionKey collisions when the same `(model, cost_type, date)` has multiple line items.
- Usage totals no longer double-count proxy traffic. Proxy writes happen at hourly granularity while the admin sync writes the same traffic at day granularity; the oversight queries now filter out the proxy-sourced rows so admin sync is the single source of truth for aggregate totals. Proxy data remains queryable for real-time views.
- Cache tokens (cache_read + cache_creation) are separated from default token and cost totals across the oversight dashboard and usage page. A client-side toggle on the usage page shows or hides cache tokens on demand.
- All `toLocaleString()` calls and number formatters are now pinned to `en-US` so numbers render consistently regardless of the Vercel runtime locale.

## TODO / Roadmap

### Governance

- [ ] Renewal automation for formal approval records and approval re-attestation campaigns

### Oversight

- [x] Time range picker and provider/model/project filters on usage pages
- [x] Cost breakdown by input vs output tokens, cost-per-request, and monthly spend forecasting
- [x] Provider posture comparisons across cost, incidents, exceptions, and high-risk usage
- [ ] Claude Code tool-level accept/reject breakdown (per-tool grouped bar chart)
- [ ] CSV/PDF export of usage logs and scheduled spend summary reports
- [ ] Audit-ready reporting in board, auditor, and regulator-focused export formats
- [ ] Evidence quality scoring for stale, weak, or missing governance artifacts

### Risk

- [x] Radar charts for per-system risk profile comparison
- [x] Risk trend line charts per system over assessment history
- [x] Residual-risk tracking alongside inherent risk
- [ ] Portfolio views by department, vendor, owner, and use case
- [ ] Scoring calibration controls for compliance admins
- [ ] Reviewer guidance with examples for low, medium, and high scoring
- [ ] Mandatory mitigation plans for high-risk findings
- [ ] Assessment reuse from prior systems or previous reviews

### Shadow AI

- [x] Low-confidence review queues and promotion workflows
- [x] Dismiss option for high-confidence discoveries
- [x] AI-assisted auto-fill when converting a discovered tool to a governed system

### Registry

- [x] "Autofill with AI" button on the manual registration form
- [x] Filter bar with department, risk, status, sensitivity, and vendor dropdowns

### Compliance

- [x] Edit existing policies after creation

### Strategic

- [ ] Bulk governance operations across many systems at once
- [x] Executive dashboards with posture deltas, trend storytelling, and board-ready summaries
