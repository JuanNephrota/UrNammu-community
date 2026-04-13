# Settings

Most settings require `ADMIN`. Secret values are encrypted in the database with `SETTINGS_ENCRYPTION_KEY`.

## Sections

- **General** — choose the AI provider (Anthropic / OpenAI) and model used for in-app AI features (risk suggestion, compliance gap analysis, agent risk review, summarization).
- **Provider Admin APIs** — admin keys for org telemetry: Anthropic, OpenAI, Google Gemini billing export. Each has its own enable toggle and sync interval. Anomaly thresholds and governance-automation notice days live here too.
- **Proxy Setup** — shared `PROXY_SECRET` for the transparent Claude / OpenAI proxy and the endpoint URLs developers route through.
- **Users & Identity** — manage users and roles. Configure Google OAuth and Microsoft / Entra ID sign-in.
- **Shadow AI** — Google Workspace service account + admin email; Microsoft 365 Graph app credentials. DNS / proxy import lives here too.

## Roles

- `ADMIN` — everything.
- `COMPLIANCE_OFFICER` — create / assign policies, approve stages, create exceptions, upload evidence, close incidents.
- `VIEWER` — read-only.

## Tips

- The first user to sign in via Google OAuth is auto-promoted to `ADMIN`. Subsequent users default to `VIEWER`.
- Settings UI values **win over** environment variables. Env vars are the fallback when the DB value is absent.
- Do **not** rotate `SETTINGS_ENCRYPTION_KEY` in place — encrypted settings will become unreadable.
