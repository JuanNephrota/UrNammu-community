# Integrations

Every external service UrNammu connects to, on one page, grouped by purpose. Requires `ADMIN`.

Each tile shows whether the service is connected, and each group header shows a connected count (e.g. "2/4 connected"). Click a tile to configure credentials and sync options inline; identity and discovery tiles link out to the settings page where their full auth or scan configuration lives.

## Categories

- **AI Models** — the internal AI provider used for in-app features (risk suggestion, compliance gap analysis, agent risk review, summarization).
- **Provider Telemetry** — Anthropic Admin API (organization usage plus the Claude Code analytics feed), OpenAI Admin API, **ChatGPT Enterprise Compliance API**, and Google Cloud Billing (Gemini). These feed Oversight usage and cost. The **Cursor Admin API** is also a provider sync — it supplies Cursor tokens, requests, and per-user spend — and is configured under **Settings → Provider Admin APIs** rather than as a tile here.
- **ChatGPT Enterprise Compliance API** — a workspace-scoped Admin key (created by a ChatGPT Enterprise / Edu workspace owner in the OpenAI Admin Console) plus the workspace id. The hourly `chatgpt_enterprise` sync pulls workspace users into `ProviderActor`, auth and admin-audit events into `ComplianceActivity`, per-user daily ChatGPT message counts and Codex activity into `AssistantDailyStat`, and raises alerts for admin-role grants and new GPTs with custom actions. Grant the key **Users**, **GPTs**, and **Compliance logging platform** read scopes; a stream the key cannot read is skipped and named in the sync-run metadata rather than failing the sync. Message content is never stored — only counts.
- **AI Gateways** — OpenRouter Activity, Helicone Requests, Portkey Analytics, and LiteLLM Proxy. Use these when traffic already flows through a gateway and you want its records without re-routing through the UrNammu proxy.
- **Identity** — Google Sign-In and Microsoft 365 Sign-In, for authenticating users into UrNammu.
- **Directory Discovery** — Google Workspace and Microsoft 365 Tenant Apps, for Shadow AI scanning of connected third-party apps.
- **Observability** — Azure Monitor (feeds the Proxy Health board) and Datadog.

## Integrations vs. Settings

This page is a catalog: it answers "what are we connected to, and what is still unconfigured". The **Settings** pages are the authority for behavior — scan intervals, anomaly thresholds, attribution headers, and roles. A tile that reports "connected" only means credentials are present and valid-looking; it does not mean a sync has succeeded. Check **Oversight** or **Settings → Provider Admin APIs** for sync-run results.

## Credential handling

Secrets entered here are encrypted at rest with `SETTINGS_ENCRYPTION_KEY` and are masked when read back — the UI shows whether a value exists, never the value. Values set in the UI take precedence over environment variables; env vars are the fallback when the database value is absent.
