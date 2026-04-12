# AI Gov

AI Gov is an internal AI governance platform for admin and compliance teams. It combines:

- AI system and agent inventory
- Shadow AI discovery from Google Workspace, Microsoft 365, and DNS/proxy CSV imports
- Risk assessments and policy mapping
- Oversight telemetry from provider admin APIs

The app is built with Next.js 16, React 19, Prisma, PostgreSQL, and NextAuth.

## Modules

- `Registry`: central inventory of AI systems
- `Agents`: tracked AI agents and assistants
- `Shadow AI`: discovery and triage of unregistered tools
- `Risk Center`: system-level risk assessments
- `Compliance`: policy assignment and audit evidence
- `Oversight`: provider usage, costs, and organization telemetry

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

The current admin sync route still backfills derived `APIUsageLog` rows for dashboard compatibility, but normalized telemetry is now the source of truth for future oversight work.

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

### Google Workspace

Used for shadow AI discovery from authorized OAuth apps.

Required settings:

- service account JSON with domain-wide delegation
- Google admin email

Configure in `Settings > Shadow AI`.

### Microsoft 365

Used for shadow AI discovery from delegated Microsoft 365 / Entra-connected apps.

Required settings:

- Microsoft tenant ID
- Microsoft client ID
- Microsoft client secret

Configure in `Settings > Shadow AI`.

## Background Scheduling

The project now includes a shared maintenance endpoint for background jobs:

- `GET /api/scheduler/maintenance`
- authenticated with `Authorization: Bearer $CRON_SECRET`

It handles:

- provider admin telemetry sync
- OpenAI assistant follow-up discovery
- Google Workspace shadow-AI follow-up scans
- Microsoft 365 shadow-AI follow-up scans

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

- Oversight pages still read legacy `APIUsageLog` data in some places.
- Admin sync now persists normalized telemetry for OpenAI and Anthropic.
- A future UI pass should migrate oversight reporting to `UsageBucket` and `CostBucket` directly.

## TODO / Roadmap

### 1. Must-have Governance

- Expand policy rules beyond the current MVP to cover richer conditions, actions, and exception-aware enforcement
- Add renewal automation for governance reviews, approvals, and exception expirations
- Add ownership escalation when systems become overdue, unowned, or blocked in approval stages
- Add workflow notifications for approvals, renewals, drift, incidents, and overdue reviews

### 2. Must-have Oversight

- Migrate remaining oversight views from legacy `APIUsageLog` reads to normalized `UsageBucket` and `CostBucket` data
- Expand audit-ready reporting into board, auditor, and regulator-focused export formats
- Add evidence quality scoring for stale, weak, or missing governance artifacts
- Add workflow notifications and dashboards for open incidents, drift alerts, and remediation progress

### 3. Strategic Differentiators

- Automated governance recommendations with next-best actions per system
- Renewal automation with batched review campaigns and reminder workflows
- Exception lifecycle management with renewal requests and expiration handling
- Bulk governance operations across many systems at once
- Deeper vendor governance with contracts, subprocessors, data residency, and approved use-case tracking
- Expand executive dashboards with posture deltas, trend storytelling, and board-ready summaries
- Improve Microsoft 365 Shadow AI discovery with richer Graph signals, usage heuristics, and vendor matching coverage
