# Nammu

Nammu is an AI governance and compliance platform for admin and compliance teams. It combines:

- AI system and agent inventory
- Shadow AI discovery from Google Workspace, Microsoft 365, and DNS/proxy CSV imports
- Risk assessments and policy mapping
- Governance workflows with staged approvals, exceptions, evidence, and incidents
- Vendor governance with contract, residency, subprocessors, and approved use-case tracking
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

The current admin sync route still backfills derived `APIUsageLog` rows for compatibility, but the main oversight views now read normalized telemetry from `UsageBucket` and `CostBucket`.

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

- Admin sync now persists normalized telemetry for OpenAI and Anthropic.
- Main oversight views now use normalized `UsageBucket` and `CostBucket` data.
- Policy rules support richer conditions, advisory vs blocking enforcement, and exception-aware evaluation.
- Vendor governance includes editable vendor profiles with contract posture, security review status, data residency, subprocessors, and approved use cases.
- Shadow AI discovery supports both Google Workspace and Microsoft 365 with improved matching and confidence signals.

## TODO / Roadmap

### Governance

- [x] Policy enforcement with rule conditions, advisory vs blocking modes, and exception-aware evaluation
- [x] Approval workflows with staged signoff across owners, security, legal, and compliance
- [x] Exception management with expiry, approver, rationale, and renewal controls
- [x] AI-powered compliance assessment against policies and framework requirements
- [ ] Renewal automation for governance reviews, approvals, and exception expirations
- [ ] Ownership escalation when systems become overdue, unowned, or blocked
- [ ] Workflow notifications for approvals, renewals, drift, incidents, and overdue reviews

### Oversight

- [x] Anthropic Admin API integration (usage, cost, API keys, members)
- [x] OpenAI Admin API integration (usage, costs, assistant discovery)
- [x] Claude Code Analytics API integration (per-user sessions, LOC, commits, PRs, tool acceptance)
- [x] Normalized telemetry with UsageBucket / CostBucket models
- [ ] Audit-ready reporting in board, auditor, and regulator-focused export formats
- [ ] Evidence quality scoring for stale, weak, or missing governance artifacts
- [ ] Dashboards for open incidents, drift alerts, and remediation progress

### Risk

- [x] Multi-dimensional risk assessments with AI-assisted scoring
- [x] Risk heat map with clickable system links
- [x] Dimension distribution chart (systems per risk bucket per dimension)
- [x] Risk tier trend chart (organization risk posture over time)
- [x] Dynamic assessments with a live recommended risk tier and explanation
- [x] Control-gap detection tied to policies, evidence, and approvals
- [x] Risk drift and reassessment triggers for materially changed systems
- [ ] Radar charts for per-system risk profile comparison
- [ ] Risk trend line charts per system over assessment history
- [ ] Assessment templates by use case (copilot, vendor AI SaaS, autonomous agent, customer-facing AI)
- [ ] Dynamic question sets that branch by data sensitivity, autonomy, and user impact
- [ ] Residual-risk tracking alongside inherent risk
- [ ] Portfolio views by department, vendor, owner, and use case
- [ ] Scoring calibration controls for compliance admins
- [ ] Reviewer guidance with examples for low, medium, and high scoring
- [ ] Mandatory mitigation plans for high-risk findings
- [ ] Assessment reuse from prior systems or previous reviews

### Shadow AI

- [x] Google Workspace OAuth discovery with confidence scoring
- [x] Microsoft 365 delegated-app discovery via Microsoft Graph
- [x] DNS/proxy log import (CSV/TXT/JSON)
- [ ] Low-confidence review queues and promotion workflows
- [ ] Shadow AI to approved-system conversion workflow

### Strategic

- [ ] Automated governance recommendations with next-best actions per system
- [ ] Bulk governance operations across many systems at once
- [ ] Executive dashboards with posture deltas, trend storytelling, and board-ready summaries
- [ ] Vendor governance expansion with contract lifecycle and renewal tracking
