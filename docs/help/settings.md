# Settings

Most settings require `ADMIN`. Secret values are encrypted in the database with `SETTINGS_ENCRYPTION_KEY`.

## Sections

- **Overview** — jump-off page to every settings area.
- **General** — choose the AI provider (Anthropic / OpenAI) and model used for in-app AI features (risk suggestion, compliance gap analysis, agent risk review, summarization). The global **policy enforcement mode** for the proxy — Off / Dry run / Enforce — is also set here.
- **Provider Admin APIs** — admin keys for org telemetry: Anthropic, OpenAI, Google Gemini billing export. Each has its own enable toggle and sync interval. Anomaly thresholds, governance-automation notice days, and attribution tuning live here too.
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

## Roles

- `ADMIN` — everything.
- `COMPLIANCE_OFFICER` — create / assign policies, approve stages, create exceptions, upload evidence, close incidents.
- `VIEWER` — read-only.

## Tips

- The first user to sign in via Google OAuth is auto-promoted to `ADMIN`. Subsequent users default to `VIEWER`.
- Settings UI values **win over** environment variables. Env vars are the fallback when the DB value is absent.
- Do **not** rotate `SETTINGS_ENCRYPTION_KEY` in place — encrypted settings will become unreadable.
