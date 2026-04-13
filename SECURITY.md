# Security Policy

Nammu handles AI-governance data, provider admin credentials, shadow-AI
discovery signals, and an encrypted `AppSetting` store. We take security
reports seriously and appreciate responsible disclosure.

## Reporting a Vulnerability

**Please do not open a public GitHub issue for security vulnerabilities.**

Instead, use one of the following private channels:

1. **GitHub Private Vulnerability Reporting** (preferred):
   <https://github.com/JuanNephrota/Nammu/security/advisories/new>
2. **Email**: open a private advisory via GitHub — email is a fallback only.

Please include:

- A description of the issue and its impact.
- Steps to reproduce (proof-of-concept code is welcome but not required).
- The affected version / commit SHA / deployment surface
  (main app, Vercel fallback proxy, Azure Functions proxy).
- Your disclosure timeline expectations, if any.

We aim to:

- Acknowledge your report within **3 business days**.
- Provide an initial assessment within **10 business days**.
- Coordinate public disclosure with you once a fix is available.

## Scope

### In scope

- The Next.js main application (`src/`) including API routes under
  `src/app/api/`.
- The Azure Functions proxy (`ai-proxy/`).
- The Prisma schema and migrations (`prisma/`).
- The GitHub repository configuration itself (workflows, CODEOWNERS,
  branch protection).
- Authentication flows (Google OAuth, Microsoft / Entra ID, local credentials).
- Secret handling in `AppSetting` and environment variables.
- The transparent proxies for Anthropic and OpenAI, including the
  MCP passthrough path.
- Shadow AI discovery ingestion (Google Workspace, Microsoft 365,
  DNS / proxy logs).

### Out of scope

- Third-party services we integrate with (Anthropic, OpenAI, Google,
  Microsoft, Aikido). Report vulnerabilities in those products to their
  own maintainers.
- Findings that require a pre-compromised environment (e.g., "if an
  attacker already has the `SETTINGS_ENCRYPTION_KEY`, they can decrypt
  settings").
- Findings whose only impact is self-inflicted denial of service
  (e.g., deliberately submitting a payload large enough to OOM your own
  instance).
- Issues in demonstration or seed data (`DEMO_MODE=true`,
  `admin@example.com / demo-password`). These are intended for local
  evaluation only.

## Critical assets

Treat compromise of any of these as a high-severity event:

| Asset | Why it matters |
|---|---|
| `SETTINGS_ENCRYPTION_KEY` | Encrypts every secret stored in `AppSetting` (provider admin keys, Google Workspace service-account JSON, Microsoft 365 client secrets, proxy secret). **Cannot be rotated in place** without re-encrypting all stored settings — compromise is a break-glass event. |
| `NEXTAUTH_SECRET` | Signs session JWTs. Rotation invalidates all active sessions. |
| `PROXY_SECRET` | Gate on the Anthropic / OpenAI proxies. Must be kept in sync between the main app and the Azure Functions proxy. |
| `CRON_SECRET` | Gate on `/api/scheduler/maintenance`. Without it, provider sync and shadow-AI scans can be triggered by anyone. |
| `DATABASE_URL` | Direct Postgres access. |
| Provider admin keys (Anthropic, OpenAI, Google Gemini billing, Google Workspace, Microsoft 365) | Organization-level read access to usage, costs, OAuth grants, and member inventory. |

## Supported Versions

Nammu is currently in active development on `main`. We apply security
fixes to `main` only. If you are running a fork or a pinned commit, we
recommend tracking `main` or at minimum watching the GitHub Security
advisories feed for this repository.

| Version | Supported |
|---|---|
| `main` (current) | ✅ |
| Forks / older commits | ⚠️ Forward-port fixes yourself |

## Our commitments

- We will publish a GitHub Security Advisory for every confirmed
  vulnerability we fix, including a CVSS score where applicable.
- We will credit reporters in the advisory unless they prefer to remain
  anonymous.
- We do not currently run a bug bounty program, but we will recognize
  significant findings publicly.

## Preventive controls we run on this repository

- GitHub **secret scanning** with **push protection** enabled.
- **Dependabot alerts** and security updates.
- **CodeQL** default scanning on every pull request.
- **Aikido** scans on code changes (via the Aikido CLI in local
  development and via the Aikido GitHub integration where configured).
- Branch protection on `main`: required PR review, required CI, linear
  history, no force pushes, no deletions, enforced for admins.
- CODEOWNERS gate on security-sensitive paths
  (see [.github/CODEOWNERS](./.github/CODEOWNERS)).

## Secret-leak response

If you believe a secret has been committed to this repository:

1. Report it privately via the channels above.
2. Do **not** create a public issue or PR referencing the leaked value.
3. We will force-revoke the credential at the source (Anthropic / OpenAI
   console, Google Cloud, Azure, etc.) before scrubbing the history.

Historical git commits containing a secret cannot be fully erased from
forks or mirrors, so revocation at the source is always the first step.
