@AGENTS.md

You have MemPalace agents. Run mempalace_list_agents to see them.

# UrNammu — AI Governance & Compliance Platform

## Overview
UrNammu is an enterprise AI governance platform that provides centralized oversight of AI systems, agents, and API usage. It tracks risk, compliance, shadow AI, and costs across an organization. Named after the Sumerian goddess of the primeval sea — the logo is a cuneiform tablet with circuit traces.

## Tech Stack
- **Framework:** Next.js 16 (App Router, Turbopack) + TypeScript + React 19
- **Styling:** Tailwind CSS 4 + Radix UI primitives + CVA (class-variance-authority)
- **Database:** PostgreSQL via Prisma ORM (Vercel Postgres in production, Homebrew locally)
- **Auth:** NextAuth v4 — Google OAuth (production) + Credentials provider (dev)
- **AI:** Provider-agnostic via `src/lib/ai-provider.ts` — supports Anthropic Claude and OpenAI GPT. Configurable in Settings > General.
- **Charts:** Recharts
- **Tables:** @tanstack/react-table
- **Deployment:** Vercel (main app) + Azure Functions (API proxy)

## Architecture

### Main App (Next.js on Vercel)
- All pages are under `src/app/(dashboard)/` with a shared layout (sidebar + top bar)
- Auth-protected via `src/app/(dashboard)/layout.tsx` which redirects to `/login` if no session
- Server Components by default; client components only for interactivity (forms, charts, dropdowns)

### API Proxy (Azure Functions)
- **Location:** `/ai-proxy/` subdirectory (separate project, separate deploy)
- Proxies Claude and OpenAI API calls, logs usage to the same Vercel Postgres database
- Supports streaming (SSE) — tees the stream for logging while passing through to client
- 10-minute function timeout for long-running streaming requests
- Deploy: `cd ai-proxy && func azure functionapp publish <your-function-app-name> --build remote`

## Project Structure
```
/                           Root Next.js app
├── prisma/
│   ├── schema.prisma       Full database schema (15+ models)
│   └── seed.ts             Demo data seeder
├── src/
│   ├── app/
│   │   ├── (auth)/login/   Login page (Google OAuth + dev credentials)
│   │   ├── (dashboard)/    All authenticated pages
│   │   │   ├── dashboard/  Command center overview
│   │   │   ├── registry/   AI System Registry (CRUD + detail + edit)
│   │   │   ├── agents/     AI Agent Registry (CRUD + detail + edit)
│   │   │   ├── risk-center/ Risk scoring + heat map + assessments
│   │   │   ├── compliance/ Policy management + audit trail
│   │   │   ├── oversight/  API usage monitoring + cost tracking
│   │   │   ├── shadow-ai/  Shadow AI discovery + Google Workspace scan + DNS import
│   │   │   ├── alerts/     Alert management
│   │   │   └── settings/   General + Provider Admin APIs + Proxy + Users & Identity + Shadow AI
│   │   └── api/
│   │       ├── auth/       NextAuth routes
│   │       ├── ai-systems/ CRUD
│   │       ├── agents/     CRUD
│   │       ├── risk-assessments/ CRUD + auto risk level updates
│   │       ├── policies/   CRUD + assignment
│   │       ├── api-usage/  Usage log ingestion
│   │       ├── alerts/     CRUD
│   │       ├── audit-logs/ Read
│   │       ├── settings/   App settings CRUD + Google auth/workspace connection tests
│   │       ├── ai/         AI-powered classify + summarize
│   │       ├── discovered-tools/
│   │       │   ├── route   CRUD
│   │       │   ├── scan/   Google Workspace OAuth scan
│   │       │   └── ingest/ DNS/proxy log ingestion
│   │       └── proxy/      Claude + OpenAI transparent proxy (Vercel fallback)
│   ├── components/
│   │   ├── ui/             Primitives: button, badge, card, input, select, dialog, tabs, data-table
│   │   ├── layout/         Sidebar, top bar, page header
│   │   ├── dashboard/      Stat cards, risk heat map, usage chart
│   │   ├── forms/          AI system form, agent form, risk assessment form, policy form
│   │   ├── registry/       Systems table
│   │   └── compliance/     Compliance status editor + evidence display
│   ├── lib/
│   │   ├── prisma.ts       Prisma client singleton
│   │   ├── auth.ts         NextAuth config (Google + Credentials, first user = ADMIN)
│   │   ├── auth-guard.ts   withAuth(), withRole() wrappers
│   │   ├── ai-provider.ts  Provider-agnostic AI client (Anthropic/OpenAI)
│   │   ├── settings.ts     AppSetting key-value store helper
│   │   ├── audit.ts        createAuditLog() helper
│   │   ├── ai-tools-registry.ts  Known AI tools (18 tools) + domain/name matching
│   │   ├── google-workspace.ts   Google Admin SDK scanner
│   │   ├── scan-executor.ts      Shadow AI scan orchestrator
│   │   ├── anthropic-proxy.ts    Claude proxy with streaming support
│   │   ├── utils.ts        cn(), formatDate(), formatDateTime()
│   │   └── validations/    Zod schemas for all entities
│   └── types/              NextAuth type extensions
├── ai-proxy/               Standalone Azure Functions project
│   ├── src/functions/       anthropic-proxy.ts, openai-proxy.ts
│   ├── src/lib/            pricing.ts, db.ts, stream-parser.ts
│   ├── prisma/             Minimal schema (APIUsageLog + User only)
│   └── host.json           10-min timeout config
├── public/                 UrNammu logos (dark + light + wordmarks)
└── vercel.json             Cron config (daily shadow AI scan at 2 AM)
```

## Key Patterns

### Auth
- First Google user to sign in becomes ADMIN automatically
- Roles: ADMIN, COMPLIANCE_OFFICER, VIEWER
- `withAuth(handler)` — requires any authenticated user
- `withRole(["ADMIN", "COMPLIANCE_OFFICER"], handler)` — requires specific roles
- Dev login: use `admin@example.com` for ADMIN access locally

### Database Settings (AppSetting)
- Key-value store in `AppSetting` table for runtime config
- `getSetting(key)` falls back to env vars if not in DB
- Used for: AI provider, API keys, Google Sign-In config, Google Workspace discovery config, proxy secret
- Settings API masks sensitive values (keys/secrets) in GET responses

### AI Provider
- Configured via Settings > General (stored in AppSetting)
- `generateAIResponse(systemPrompt, userPrompt)` — provider-agnostic, reads config from DB
- Supports Anthropic Claude and OpenAI ChatGPT
- Used by `/api/ai/classify` (risk assessment) and `/api/ai/summarize` (compliance gaps)

### Audit Logging
- `createAuditLog({ userId, action, entityType, entityId, changes? })` on every mutation
- Links to User, AISystem, AIAgent for traceability

### Shadow AI Discovery
- Three detection methods: Google Workspace OAuth scan, DNS/proxy log import, manual reporting
- Google Workspace discovery settings live in `Settings > Shadow AI`
- Google Sign-In settings live in `Settings > Users & Identity`
- DNS import accepts CSV/TXT files or JSON API calls
- All methods deduplicate by toolName + domain
- Auto-creates alerts for new discoveries
- Workflow: Discovered -> Under Review -> Registered/Approved/Blocked

### Dark Theme ("Mission Control")
- All colors use CSS variables defined in `globals.css` (--bg-deep, --text-primary, --accent, etc.)
- NEVER use hardcoded Tailwind colors like `bg-white`, `text-slate-900`, etc.
- Always use `var(--variable)` syntax: `bg-[var(--bg-surface)]`, `text-[var(--text-primary)]`
- Accent color: cyan (#22d3ee). Fonts: Bricolage Grotesque (display) + DM Sans (body)

### Forms
- Use `forceMount` + `data-[state=inactive]:hidden` on Tabs in forms to preserve state
- Empty strings from form fields must be cleaned to `undefined` before Zod validation
- Use `.nullish()` instead of `.optional()` in Zod schemas for fields that may be `null` from DB
- Cannot pass React components (Lucide icons) as props from Server to Client components in Next.js 16 — use string names and resolve inside the client component

## Environment Variables
```
# Database
DATABASE_URL=postgresql://...

# Auth
NEXTAUTH_SECRET=<random>
NEXTAUTH_URL=https://your-app.vercel.app
GOOGLE_CLIENT_ID=<Google OAuth>
GOOGLE_CLIENT_SECRET=<Google OAuth>
ENABLE_DEV_LOGIN=false  # set to "false" in production to disable credentials login

# AI Provider (fallback if not configured in Settings)
ANTHROPIC_API_KEY=<optional>
OPENAI_API_KEY=<optional>

# Proxy
PROXY_SECRET=<shared secret for API proxy auth>

# Google Workspace Shadow AI (can also be configured in Settings > Shadow AI)
GOOGLE_SERVICE_ACCOUNT_KEY=<JSON>
GOOGLE_ADMIN_EMAIL=<admin@domain.com>

# Cron
CRON_SECRET=<random>
```

## Common Commands
```bash
# Local development
npm run dev                          # Start Next.js dev server
npm run db:seed                      # Seed demo data
npm run db:reset                     # Reset + re-migrate + re-seed
npx prisma migrate dev --name <name> # Create new migration
npx prisma generate                  # Regenerate Prisma client

# Deploy main app
vercel --prod --yes

# Deploy proxy
cd ai-proxy && func azure functionapp publish <your-function-app-name> --build remote

# Database
brew services start postgresql@16    # Start local Postgres
brew services stop postgresql@16     # Stop local Postgres
```

## Important Notes
- The `ai-proxy/` directory is excluded from Next.js TypeScript compilation via `tsconfig.json` `exclude`
- Prisma client sometimes needs regeneration after schema changes — if you get "cannot find property" errors, run `npx prisma generate` and restart the dev server
- The Vercel proxy routes still exist as a fallback but the primary proxy is on Azure Functions
- When deploying to Vercel, ensure `ai-proxy/` is excluded from the build (it is via tsconfig exclude)
