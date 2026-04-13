# Nammu Install Guide

This guide walks through installing Nammu from zero — local development, production deployment on Vercel, the companion Azure Functions API proxy, and every external integration (Google, Microsoft, Anthropic, OpenAI, and Google Gemini / Vertex AI oversight).

For day-to-day product usage once installed, see the [User Guide](./user-guide.md). For architecture, see the [Implementation Guide](./implementation-guide.md).

---

## Table of Contents

1. [Prerequisites](#1-prerequisites)
2. [Local Development Install](#2-local-development-install)
3. [Environment Variables Reference](#3-environment-variables-reference)
4. [Database Setup](#4-database-setup)
5. [First Run & First Admin User](#5-first-run--first-admin-user)
6. [Production Deployment (Vercel)](#6-production-deployment-vercel)
7. [API Proxy Deployment (Azure Functions)](#7-api-proxy-deployment-azure-functions)
8. [Integration Setup](#8-integration-setup)
9. [Background Cron Setup](#9-background-cron-setup)
10. [Upgrades & Migrations](#10-upgrades--migrations)
11. [Uninstall / Reset](#11-uninstall--reset)
12. [Troubleshooting](#12-troubleshooting)

---

## 1. Prerequisites

### Required

| Tool | Version | Purpose |
|------|---------|---------|
| **Node.js** | 20.x or later | Next.js 16 + React 19 require Node 20+. |
| **npm** | 10.x (bundled with Node 20) | Package manager. |
| **PostgreSQL** | 14+ (16 recommended) | Primary database. |
| **Git** | any recent | Clone the repo. |

### Recommended

| Tool | Purpose |
|------|---------|
| **Homebrew** (macOS) | Easiest way to install Postgres locally. |
| **Vercel CLI** (`npm i -g vercel`) | Deploying to Vercel. |
| **Azure Functions Core Tools v4** | Running / deploying the `ai-proxy/` companion. |
| **Azure CLI** | Authenticating with Azure for the proxy deploy. |
| **`openssl`** | Generating random secrets. |

### Quick environment check

```bash
node --version      # should print v20.x or newer
npm --version       # should print 10.x or newer
psql --version      # should print 14+ or newer
git --version
```

---

## 2. Local Development Install

### 2.1 Clone the repo

```bash
git clone <your-repo-url> nammu
cd nammu
```

### 2.2 Install dependencies

```bash
npm install
```

This runs the `postinstall` script, which executes `prisma generate` against `prisma/schema.prisma`. If it fails, see [Troubleshooting](#12-troubleshooting).

> **Note**: the `ai-proxy/` directory is a separate project with its own `package.json`. It is **not** installed by the root `npm install` — install it separately only if you plan to run the proxy locally (see [Section 7](#7-api-proxy-deployment-azure-functions)).

### 2.3 Start PostgreSQL locally

**macOS (Homebrew):**
```bash
brew install postgresql@16
brew services start postgresql@16
createdb nammu_dev
```

**Ubuntu / Debian:**
```bash
sudo apt install postgresql
sudo -u postgres createdb nammu_dev
sudo -u postgres createuser --superuser $USER   # once
```

**Docker (cross-platform alternative):**
```bash
docker run --name nammu-postgres -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=nammu_dev -p 5432:5432 -d postgres:16
```

### 2.4 Create `.env`

Copy `.env.example` if present, or create a new `.env` at the repo root:

```bash
cat > .env <<'EOF'
# --- Database ---
DATABASE_URL="postgresql://$USER@localhost:5432/nammu_dev?schema=public"

# --- Auth ---
NEXTAUTH_URL=http://localhost:3001
NEXTAUTH_SECRET=__replace__

# --- Encryption for stored secrets ---
SETTINGS_ENCRYPTION_KEY=__replace__

# --- Optional: dev login ---
ENABLE_DEV_LOGIN=true
ENABLE_LOCAL_AUTH=true

# --- Optional: demo mode (loads the seeded sample workspace) ---
DEMO_MODE=true
NEXT_PUBLIC_DEMO_MODE=true

# --- Cron ---
CRON_SECRET=__replace__
EOF
```

Generate strong secrets:

```bash
openssl rand -hex 32   # use for NEXTAUTH_SECRET
openssl rand -hex 32   # use for SETTINGS_ENCRYPTION_KEY
openssl rand -hex 32   # use for CRON_SECRET
```

> **Important**: `SETTINGS_ENCRYPTION_KEY` encrypts provider keys, service-account JSON, and client secrets stored in the `AppSetting` table. **Do not rotate it after data has been saved** — you will lose access to previously-stored encrypted values. Back up the key alongside database backups.

Full variable reference in [Section 3](#3-environment-variables-reference).

### 2.5 Run migrations and seed

```bash
npm run db:migrate    # applies all Prisma migrations
npm run db:seed       # loads demo workspace (requires DEMO_MODE=true for realistic data)
```

### 2.6 Start the dev server

```bash
npm run dev
```

The app listens on **http://localhost:3001** by default (Next.js 16 + Turbopack).

### 2.7 Sign in

With the default demo seed you can sign in at `/login` as:

- Email: `admin@example.com`
- Password: `demo-password`

(This requires `ENABLE_DEV_LOGIN=true` + `ENABLE_LOCAL_AUTH=true`.)

---

## 3. Environment Variables Reference

All variables read from `.env` in local dev and from the platform environment (Vercel, Azure) in production.

### 3.1 Required

| Variable | Purpose |
|----------|---------|
| `DATABASE_URL` | Postgres connection string. Must include `?schema=public`. |
| `NEXTAUTH_URL` | Public base URL of the Nammu app (`http://localhost:3001` in dev). |
| `NEXTAUTH_SECRET` | Signs NextAuth session tokens. 32+ random bytes. |
| `SETTINGS_ENCRYPTION_KEY` | AES key for encrypting secret `AppSetting` values. 32+ random bytes. |

### 3.2 Recommended

| Variable | Purpose | Default |
|----------|---------|---------|
| `CRON_SECRET` | Bearer token for `/api/scheduler/maintenance`. | — |
| `PROXY_SECRET` | Shared secret for the AI proxy (`ai-proxy/`). | — |

### 3.3 Auth providers (optional — can also live in Settings UI)

| Variable | Purpose |
|----------|---------|
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Google OAuth for sign-in. |
| `MICROSOFT_TENANT_ID`, `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET` | Microsoft / Entra ID sign-in. |
| `ENABLE_DEV_LOGIN` | `true` to allow local credentials login. Must be `false` in production (app fails fast if `true` in prod). |
| `ENABLE_LOCAL_AUTH` | `true` to allow password-backed local accounts. |

### 3.4 Provider fallbacks

| Variable | Purpose |
|----------|---------|
| `ANTHROPIC_API_KEY` | Fallback Claude key if `ai_provider=anthropic` and no key is set in Settings. |
| `OPENAI_API_KEY` | Fallback OpenAI key if `ai_provider=openai` and no key is set in Settings. |

### 3.5 Google Gemini / Vertex AI oversight fallback

| Variable | Purpose |
|----------|---------|
| `GEMINI_BILLING_SERVICE_ACCOUNT_KEY` | Full Google service-account JSON for BigQuery billing-export reads. Prefer Settings UI. |
| `GEMINI_BILLING_PROJECT_ID` | Google Cloud project containing the billing export. |
| `GEMINI_BILLING_DATASET` | BigQuery dataset for the billing export table. |
| `GEMINI_BILLING_TABLE` | BigQuery table containing Gemini / Vertex AI billing rows. |
| `GEMINI_BILLING_LOCATION` | BigQuery location, usually `US` or `EU`. |

### 3.6 Google Workspace shadow-AI fallback

| Variable | Purpose |
|----------|---------|
| `GOOGLE_SERVICE_ACCOUNT_KEY` | Full service-account JSON (stringified). Prefer Settings UI. |
| `GOOGLE_ADMIN_EMAIL` | Workspace super-admin for domain-wide delegation impersonation. |
| `GOOGLE_SCAN_ENABLED` | `true` / `false`. |
| `GOOGLE_SCAN_LOOKBACK_DAYS` | Default 30. |
| `GOOGLE_SCAN_INTERVAL_HOURS` | Default 24. |

### 3.7 Microsoft 365 shadow-AI fallback

| Variable | Purpose |
|----------|---------|
| `MICROSOFT_SHADOW_AI_TENANT_ID` | Entra tenant ID. |
| `MICROSOFT_SHADOW_AI_CLIENT_ID` | Entra app client ID. |
| `MICROSOFT_SHADOW_AI_CLIENT_SECRET` | Entra app client secret. |
| `MICROSOFT_SHADOW_AI_SCAN_ENABLED` | `true` / `false`. |
| `MICROSOFT_SHADOW_AI_SCAN_INTERVAL_HOURS` | Default 24. |

### 3.8 Demo mode

| Variable | Purpose |
|----------|---------|
| `DEMO_MODE` | Server-side demo behavior. |
| `NEXT_PUBLIC_DEMO_MODE` | Shows the demo banner in the UI. |

> **Precedence**: If a setting exists in both the `AppSetting` table (via Settings UI) and env vars, the **database value wins**. Env vars are the fallback when the DB value is absent.

---

## 4. Database Setup

Nammu uses Prisma ORM and PostgreSQL. The schema is in `prisma/schema.prisma`; migrations live in `prisma/migrations/`.

### 4.1 Choosing a database

| Environment | Recommended |
|-------------|-------------|
| Local dev | Homebrew / Docker Postgres. |
| Production | **Vercel Postgres** (turnkey integration), Neon, Supabase, or any managed Postgres 14+. |
| Self-hosted | PostgreSQL 14+ with SSL. |

### 4.2 Connection string format

```
postgresql://<user>:<password>@<host>:<port>/<database>?schema=public&sslmode=require
```

- Add `&sslmode=require` for managed providers.
- Use a **dedicated database** per environment (dev / staging / prod).

### 4.3 Running migrations

```bash
# Apply all pending migrations
npm run db:migrate

# Create a new migration after editing schema.prisma (dev only)
npx prisma migrate dev --name describe_change

# Regenerate Prisma client (sometimes required after schema changes)
npx prisma generate

# Reset DB (destructive — wipes data, re-runs all migrations, re-seeds)
npm run db:reset
```

In production (Vercel), migrations run automatically during the build via `prisma migrate deploy` if you wire it into the build step, **or** you can run them manually:

```bash
DATABASE_URL="<prod-url>" npx prisma migrate deploy
```

### 4.4 Seeding

`npm run db:seed` runs `prisma/seed.ts`. With `DEMO_MODE=true` it loads a rich demo workspace (AI systems, policies, discovered tools, telemetry); without it, it creates the minimum baseline (admin user + default policies).

---

## 5. First Run & First Admin User

### 5.1 If using Google OAuth (recommended for real installs)

1. Complete the [Google OAuth integration setup](#81-google-oauth-sign-in).
2. Start the app.
3. The **first user to sign in via Google is auto-promoted to `ADMIN`**. All subsequent Google sign-ins default to `VIEWER` and must be promoted by an admin.

### 5.2 If using dev credentials

- The seed creates `admin@example.com` / `demo-password` with `ADMIN` role.
- Only works when `ENABLE_DEV_LOGIN=true` **and** `ENABLE_LOCAL_AUTH=true`.
- Must be disabled in production (`ENABLE_DEV_LOGIN=false`).

### 5.3 Verifying the install

After logging in as an admin, check:

- **Dashboard** loads with seeded stats (if demo mode).
- **Settings → General** is reachable.
- **Settings → Users & Identity** shows your user with role `ADMIN`.
- Try creating a test AI system from **Registry → Register AI System**.

---

## 6. Production Deployment (Vercel)

The main Next.js app is designed for Vercel. Other Node-compatible hosts (Fly.io, Render, self-hosted) will work but are not covered here.

### 6.1 One-time setup

1. **Create a Vercel project** linked to your Git repo.
2. **Add a Postgres database** via Vercel → Storage → Create → Postgres. Vercel auto-wires `DATABASE_URL`, but verify it points to the same instance across Preview and Production.
3. **Set environment variables** in Vercel → Settings → Environment Variables. At minimum:
   - `NEXTAUTH_URL` — your production URL (e.g., `https://nammu.example.com`).
   - `NEXTAUTH_SECRET`, `SETTINGS_ENCRYPTION_KEY`, `CRON_SECRET`.
   - `ENABLE_DEV_LOGIN=false`.
   - `ENABLE_LOCAL_AUTH=false` (unless you truly want local accounts in prod).
   - `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` (or configure in Settings UI after first admin signs in).
   - Any optional integration fallbacks from [Section 3](#3-environment-variables-reference).
4. **Ensure the `ai-proxy/` directory is excluded** from the Next.js build. This is already configured via `tsconfig.json` `exclude` — no action required, but verify after the first deploy that the build does not attempt to compile Azure Functions code.

### 6.2 Deploying

```bash
vercel --prod --yes
```

Or push to the configured production branch. The build runs `prisma generate && next build` (via `package.json` `build` script).

### 6.3 Post-deploy

1. **Run migrations** against the production database (only needed if migrations are not part of your build pipeline):
   ```bash
   DATABASE_URL="<vercel-postgres-url>" npx prisma migrate deploy
   ```
2. **Sign in** via Google → you are promoted to `ADMIN`.
3. **Configure integrations** in the Settings UI (preferred over env vars).
4. **Verify the cron** is firing — see [Section 9](#9-background-cron-setup).

### 6.4 Custom domain

Vercel → Project → Domains → add your domain. Update `NEXTAUTH_URL` to match. Update the **Authorized Redirect URI** in Google Cloud Console and any Entra app registration to `https://<your-domain>/api/auth/callback/google` and `/api/auth/callback/azure-ad`.

---

## 7. API Proxy Deployment (Azure Functions)

The `ai-proxy/` directory is a standalone Azure Functions app that transparently proxies Claude and OpenAI traffic and logs usage to the same Postgres database. Deploying it is **optional** — Vercel has fallback proxy routes at `/api/proxy/*` — but Azure Functions is recommended for long-running streams because it supports a 10-minute function timeout versus Vercel's shorter timeouts.

### 7.1 Prerequisites

- Azure subscription + resource group + a Function App (Node 20 runtime).
- Azure CLI (`az login`).
- Azure Functions Core Tools v4 (`npm i -g azure-functions-core-tools@4 --unsafe-perm true`).

### 7.2 Install the proxy project

```bash
cd ai-proxy
npm install
```

### 7.3 Configure proxy env

Edit `ai-proxy/local.settings.json` for local runs, or set in Azure Function App → Configuration for production:

| Variable | Purpose |
|----------|---------|
| `DATABASE_URL` | **Same** Postgres the main app uses. The proxy writes to `APIUsageLog` / `UsageBucket`. |
| `PROXY_SECRET` | Shared secret — must match `PROXY_SECRET` in the main app. |
| `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` | Provider credentials the proxy uses when clients route through it. |

When proxying traffic, Nammu can also generate dangerous-prompt alerts from prompt-risk patterns. The proxy stores redacted excerpts and category signals rather than full prompt bodies by default.

### 7.4 Run locally

```bash
cd ai-proxy
npm start          # runs `npm run build` then `func start`
```

The proxy listens on `http://localhost:7071` by default.

### 7.5 Deploy to Azure

```bash
cd ai-proxy
func azure functionapp publish <your-function-app-name> --build remote
```

`--build remote` lets Azure run `tsc` and `prisma generate` on the cloud builder (avoids local Node/arch mismatches).

### 7.6 Wire clients to the proxy

Direct SDK calls can point at the proxy instead of the provider:

- Claude: `https://<your-function-app>.azurewebsites.net/api/anthropic-proxy`
- OpenAI: `https://<your-function-app>.azurewebsites.net/api/openai-proxy`

Clients authenticate to the proxy with an `x-proxy-key: $PROXY_SECRET` header. The proxy forwards a strict allow-list of headers to Anthropic / OpenAI by default (`Content-Type`, `anthropic-version`, `anthropic-beta`, plus the org's own `x-api-key`). Other headers are dropped.

**MCP passthrough.** When the request involves Model Context Protocol — detected by any of:

- `mcp_servers` in the JSON body (non-empty array)
- `anthropic-beta` containing `mcp-client*`
- any `mcp-*` request header

the Anthropic proxy additionally forwards every `mcp-*` header and the client's `Authorization` header verbatim, so remote MCP servers receive the credentials they need. The proxy still uses the org-level Anthropic key on `x-api-key` regardless. MCP passthrough is logged on the usage record's metadata so admins can see which calls used MCP and which headers were forwarded.

If you want dangerous-prompt monitoring, make sure the relevant OpenAI or Anthropic traffic is routed through this proxy or the app's built-in `/api/proxy/*` routes.

---

## 8. Integration Setup

Every integration can be configured **either** via env vars **or** (preferred) via the Settings UI after the first admin signs in. Settings UI values are stored encrypted with `SETTINGS_ENCRYPTION_KEY`.

### 8.1 Google OAuth (sign-in)

1. [Google Cloud Console](https://console.cloud.google.com/) → APIs & Services → Credentials.
2. Create an **OAuth 2.0 Client ID** (Web application).
3. **Authorized redirect URI**: `https://<your-domain>/api/auth/callback/google` (and the localhost equivalent for dev).
4. Copy client ID and secret into `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`, **or** paste them into **Settings → Users & Identity** after your first admin is signed in.
5. Click **Test Google Auth** in the Settings page.

### 8.2 Microsoft Entra ID (sign-in)

1. Azure Portal → Entra ID → App registrations → New registration.
2. **Redirect URI** (Web): `https://<your-domain>/api/auth/callback/azure-ad`.
3. Generate a client secret under **Certificates & secrets**.
4. API permissions → add `openid`, `profile`, `email`, `User.Read` → grant admin consent.
5. Put tenant ID, client ID, secret into env vars or **Settings → Users & Identity**.

### 8.3 Google Workspace (shadow-AI discovery)

This is a **separate Google Cloud project/app** from sign-in — do not reuse OAuth credentials.

1. Google Cloud Console → IAM & Admin → Service Accounts → create a service account.
2. Create and download a JSON key for it.
3. Enable **domain-wide delegation** on the service account.
4. Google Workspace admin console → Security → API controls → Domain-wide delegation → add the service account client ID with these scopes:
   - `https://www.googleapis.com/auth/admin.directory.user.readonly`
   - `https://www.googleapis.com/auth/admin.reports.audit.readonly`
5. **Settings → Shadow AI → Google Workspace**:
   - Paste the full service-account JSON.
   - Enter a **super-admin email** for impersonation.
   - Enable auto-scan; set interval (default 24 h) and lookback (default 30 days).
6. Click **Test Connection** → **Run Scan Now**.

### 8.4 Microsoft 365 (shadow-AI discovery)

1. Azure Portal → Entra ID → App registrations → New registration.
2. **API permissions** → Microsoft Graph → **Application permissions**:
   - `AuditLog.Read.All`
   - `Directory.Read.All`
   - `Application.Read.All`
3. **Grant admin consent** for the tenant.
4. **Certificates & secrets** → create a client secret.
5. **Settings → Shadow AI → Microsoft 365**: paste tenant ID, client ID, secret; enable auto-scan; set interval.
6. **Test Connection** → **Run Scan Now**.

### 8.5 Anthropic Admin API (telemetry)

1. [Anthropic Console](https://console.anthropic.com/) → Organization → Admin Keys → create one.
2. **Settings → Provider Admin APIs → Anthropic**: paste the admin key; enable sync; set interval (default 6 h).
3. Click **Test Connection**.

### 8.6 OpenAI Admin API (telemetry)

1. [OpenAI Platform](https://platform.openai.com/) → your org → Admin Keys → create one.
2. **Settings → Provider Admin APIs → OpenAI**: paste the admin key; enable sync; set interval.
3. **Test Connection**.

### 8.7 Google Gemini / Vertex AI oversight

Nammu supports Gemini oversight through Google Cloud Billing export data in BigQuery.

1. In Google Cloud Billing, enable **Billing export to BigQuery** for the billing account that covers your Gemini / Vertex AI usage.
2. Confirm the export lands in a dataset and table that your Nammu service account can read.
3. Create or reuse a Google service account with BigQuery read access to that dataset and table.
4. **Settings → Provider Admin APIs → Google Gemini / Vertex AI**:
   - paste the service-account JSON
   - enter the billing export project ID
   - enter the dataset and table names
   - set the BigQuery location
5. Click **Test Connection**.

This integration currently provides normalized spend oversight and best-effort attribution from billing export data rather than a direct Gemini admin usage API.

### 8.8 DNS / Proxy log ingestion

No setup beyond the main app; ingest at any time via:

- **Settings → Shadow AI → DNS/Proxy import** — upload a CSV.
- `POST /api/discovered-tools/ingest` with a JSON body (format in the [User Guide §9](./user-guide.md#9-shadow-ai-discovery)).

### 8.9 AI provider for in-app features

Separate from the admin telemetry keys above, Nammu uses a provider to power AI risk suggestion, compliance gap analysis, agent review, and summarization. Set once in **Settings → General**:

- Provider: `anthropic` or `openai`
- Model: e.g., `claude-3.5-sonnet`, `gpt-4`
- API key (falls back to `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` env var)

---

## 9. Background Cron Setup

Nammu has one maintenance endpoint that fans out to every background job. It must fire on a schedule for telemetry, shadow AI scans, Gemini billing follow-up syncs, renewal alerts, and escalations to work.

### 9.1 Endpoint

```
GET /api/scheduler/maintenance
Authorization: Bearer $CRON_SECRET
```

### 9.2 Vercel Cron (recommended if deploying to Vercel)

Already configured in `vercel.json`:

```json
{
  "crons": [
    { "path": "/api/scheduler/maintenance", "schedule": "0 * * * *" }
  ]
}
```

This fires hourly. Individual jobs check their own interval settings in `AppSetting` and skip if not yet due, so one hourly cron safely drives every background job.

### 9.3 External cron (non-Vercel hosts)

Use any scheduler (GitHub Actions, cron-job.org, Render Cron, an Azure Function timer, etc.) to hit the endpoint hourly:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" \
  https://<your-domain>/api/scheduler/maintenance
```

### 9.4 Manual trigger (useful for testing)

```bash
curl -H "Authorization: Bearer $CRON_SECRET" \
  http://localhost:3001/api/scheduler/maintenance
```

### 9.5 Verifying cron health

- **Settings → Provider Admin APIs** shows last sync timestamps.
- **Shadow AI** page shows the most recent `ScanHistory` row.
- Any failures show up with an error message in the relevant admin page.

---

## 10. Upgrades & Migrations

### 10.1 Pulling a new version

```bash
git pull
npm install          # re-runs prisma generate
npm run db:migrate   # applies any new migrations
```

### 10.2 Major version upgrades

Always read `CHANGELOG.md` (if present) and skim new migrations in `prisma/migrations/` before applying. On production:

1. Take a database snapshot.
2. Deploy the new version to a **preview** environment first, ideally with a clone of production data.
3. `npx prisma migrate deploy` against production only after the preview verifies.

### 10.3 Rotating secrets

- **`NEXTAUTH_SECRET`**: rotating invalidates all active sessions; users must sign in again.
- **`SETTINGS_ENCRYPTION_KEY`**: **do not rotate in place**. If you must, re-save every encrypted `AppSetting` through the UI after changing the key (the old key is required to decrypt; the new key to encrypt). Easier path: export settings, change the key, re-enter via UI.
- **`CRON_SECRET`**: update wherever the cron caller uses it (Vercel config is in-code, so redeploy; external cron needs its config updated).
- **`PROXY_SECRET`**: update both the main app env and the Azure Function App config together.

---

## 11. Uninstall / Reset

### 11.1 Wipe local dev

```bash
# Drop and recreate the database
npm run db:reset       # uses --force; wipes all data

# Or drop the whole database
dropdb nammu_dev
createdb nammu_dev
npm run db:migrate
npm run db:seed
```

### 11.2 Tear down Vercel

1. Delete the Vercel project (Project → Settings → Delete).
2. Delete the Vercel Postgres store.
3. Revoke / delete OAuth credentials in Google Cloud Console and Azure AD.
4. Revoke admin keys in the Anthropic / OpenAI consoles.

### 11.3 Tear down the Azure proxy

```bash
az functionapp delete --name <function-app-name> --resource-group <rg>
```

---

## 12. Troubleshooting

### `npm install` fails at `postinstall` / `prisma generate`

- Ensure you have Node 20+: `node --version`.
- Ensure `DATABASE_URL` is **not required** at install time (it isn't — Prisma generate does not connect). If you still see errors, delete `node_modules` and `package-lock.json`, then `npm install` again.

### `Error: P1001: Can't reach database server`

- Verify `DATABASE_URL` is correct (`psql "$DATABASE_URL"` should connect).
- For managed Postgres, ensure `?sslmode=require` is present.
- Check firewall / VPC rules allow inbound from your host (or Vercel IPs).

### `NEXTAUTH_URL mismatch` after deploying

- Set `NEXTAUTH_URL` to the canonical public URL (no trailing slash).
- Update the redirect URI in Google / Microsoft app registrations to match.

### "This app is running in dev mode in production"

- `ENABLE_DEV_LOGIN=true` is set in a production deployment. The app fails fast to protect you from accidentally exposing credential login. Set `ENABLE_DEV_LOGIN=false` and redeploy.

### First Google sign-in did not create an admin

- Auto-promotion only fires for **Google OAuth** sign-ins, not dev credentials or Microsoft sign-in.
- Work around: sign in however you can, then (if you are the only user) manually promote yourself via SQL:
  ```sql
  UPDATE "User" SET role = 'ADMIN' WHERE email = 'you@example.com';
  ```

### "Cannot find module '@prisma/client'"

- Run `npx prisma generate` and restart the dev server.

### Build succeeds locally but fails on Vercel

- Check Vercel's Node version matches (should be 20+). Set in **Project → Settings → General → Node.js Version**.
- Confirm `ai-proxy/` is excluded from the build (it is via `tsconfig.json` `exclude`).

### Cron never runs on Vercel

- Cron jobs only run on **production deployments**, not preview URLs.
- Verify `vercel.json` is at the repo root and committed.
- Hit the endpoint manually with the correct `Authorization` header to verify it works end-to-end.

### Azure proxy deploy fails with TypeScript errors

- Build locally first: `cd ai-proxy && npm run build`. Fix errors, recommit, redeploy.
- `--build remote` avoids local-arch issues but still requires the code to compile.

### Settings UI won't save secrets

- `SETTINGS_ENCRYPTION_KEY` must be set (≥ 32 bytes of random material) **before** you attempt to save any encrypted setting. Otherwise the save path throws.

---

*Once install is complete, see the [User Guide](./user-guide.md) to start registering AI systems.*
