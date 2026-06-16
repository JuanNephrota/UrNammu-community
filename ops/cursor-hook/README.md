# Cursor OTel Hook → UrNammu

Pipes Cursor agent activity into UrNammu's Oversight, mirroring the Claude
Code telemetry setup. Cursor itself has **no native OTel exporter**, so this
uses [`LangGuard-AI/cursor-otel-hook`](https://github.com/LangGuard-AI/cursor-otel-hook),
a Python hook that captures Cursor agent activity and exports OTLP **spans**.

Those spans flow through the **same Azure Container Apps OTel Collector** that
serves Claude Code (see [`../otel-collector/`](../otel-collector/)). The
collector fans the Cursor span stream two ways:

```
Cursor (cursor-otel-hook, OTLP/HTTP traces, service.name=cursor-agent)
      │  Authorization: Bearer <INGEST_TOKEN>     ← same receiver, port 4318
      ▼
ACA OTel Collector
  ├─ traces/cursor  ─────────────────────────► POST /api/telemetry/cursor-traces → CursorSpan
  └─ spanmetrics connector (namespace=cursor) ─► POST /api/telemetry/cursor       → CursorMetric
      ▼
UrNammu  Oversight → Cursor   (Vercel Postgres)
```

## What lands where

| UrNammu surface | Table | Source |
| --- | --- | --- |
| Oversight → **Cursor** activity panels | `CursorSpan` | raw spans (tool use, shell/MCP execs, file edits, sessions) |
| Cursor activity metrics (`cursor.calls`, `cursor.duration`) | `CursorMetric` | spanmetrics connector |
| Dangerous-prompt alerts (`provider: "cursor"`) | `Alert` | in-memory analysis of `beforeSubmitPrompt` spans |

> **No tokens or cost from the hook.** Cursor's hook emits no token counts or
> spend, so the *span* pipeline is activity-only. Authoritative **cost** comes
> from the **Cursor Admin API sync** instead — add a team admin key in
> **Settings → Provider Admin APIs → Cursor**, and the daily provider sync
> pulls spend + usage events into `UsageBucket`/`CostBucket(provider="cursor")`,
> surfacing on Oversight → Usage and the Cursor page's "Spend (7d)" card.

## Important differences from Claude Code

- **Signal:** Cursor emits **traces**, not metrics/logs. The collector derives
  metrics from spans via the `spanmetrics` connector (`cursor.calls`,
  `cursor.duration`). There is no `claude_code.token.usage` equivalent.
- **No enforced "managed settings" tier.** Claude Code reads an MDM-locked
  `managed-settings.json` users can't override. **Cursor has no equivalent** —
  the hook + its env are best-effort (a user can disable them locally). Push
  via MDM for coverage, but treat it as advisory, not a hard control.
- **Dedicated secret.** The collector presents `CURSOR_TELEMETRY_SECRET`
  (a.k.a. the `cursor_telemetry_secret` AppSetting) to the Cursor endpoints —
  rotated independently of the Claude Code `forward` token. See
  `../otel-collector/rotate-secrets.sh rotate-cursor-forward`.

## Prerequisites

1. The OTel collector is deployed (`../otel-collector/deploy-infra.sh`) with
   the Cursor params. Redeploy after pulling these changes so the
   `traces/cursor` + `metrics/cursor` pipelines exist.
2. On UrNammu (Vercel), set **`CURSOR_TELEMETRY_SECRET`** (or the
   `cursor_telemetry_secret` AppSetting) **first**, then deploy — otherwise the
   collector forwards a token UrNammu doesn't accept yet (brief 401 window).
3. Grab the collector ingest FQDN + **ingest token** (same ones Claude Code uses):
   ```bash
   az containerapp show -g certifid-ai-governance -n cc-otel-app \
     --query properties.configuration.ingress.fqdn -o tsv
   az containerapp secret show -g certifid-ai-governance -n cc-otel-app \
     --secret-name ingest-bearer-token --query value -o tsv
   ```
   > ⚠️ The **ingest token** (client→collector, `ingest-bearer-token`) is a
   > *different* secret from the **telemetry/forward secret**
   > (`cursor_telemetry_secret` / `cursor-forward-bearer-token`, collector→UrNammu).
   > The hook authenticates to the collector with the **ingest** token. Using the
   > forward secret here yields a 401 at the collector.

## Install the hook (per machine / MDM)

`cursor-otel-hook` is a Python package installed into Cursor's hooks
directory. Follow the upstream install, then point it at the collector with
these environment variables:

```bash
# Identify the source so the collector's filter/cursor_only keeps it.
export OTEL_SERVICE_NAME=cursor-agent

# Transport — http/protobuf matches the collector's OTLP/HTTP receiver (4318,
# exposed via HTTPS 443). NOTE the /v1/traces path — see the warning below.
export OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf
export OTEL_EXPORTER_OTLP_ENDPOINT="https://<COLLECTOR_FQDN>/v1/traces"
export OTEL_EXPORTER_OTLP_HEADERS="Authorization=Bearer <INGEST_TOKEN>"

# Optional: tag the user/team so UrNammu can attribute spans (the hook has no
# built-in identity). Comma-separated, no spaces.
export OTEL_RESOURCE_ATTRIBUTES="user.email=dev@certifid.com,team.id=platform"
```

> `OTEL_SERVICE_NAME` **must** be `cursor-agent` — the collector's
> `filter/cursor_only` keeps only spans whose `service.name` is `cursor-agent`
> and drops everything else from the Cursor pipelines.

### Gotchas (learned the hard way)

These bit a real rollout — the Hexnode scripts handle all three, but if you
configure the hook by hand (or via the upstream `setup.sh`), watch for them:

1. **Endpoint needs `/v1/traces`.** The hook's `http/protobuf` branch passes
   the endpoint to the OTLP exporter *as-is* and does **not** append the OTLP
   signal path (its `http/json` branch does). Without `/v1/traces` the
   collector returns **404**. (The upstream `setup.sh` defaults to `grpc` +
   `http://…` with no path — which fails against our HTTP-only collector with
   `Received http2 header with status: 500`.)
2. **Corporate TLS interception.** If the fleet runs a TLS-inspecting proxy
   (Netskope/Zscaler/etc.), its root CA is in the OS keychain but **not** in
   Python's `certifi` bundle, so the export fails with
   `CERTIFICATE_VERIFY_FAILED: self signed certificate in certificate chain`.
   Point the exporter at a bundle that includes the proxy root:
   ```bash
   # macOS: export the keychains to a PEM
   security find-certificate -a -p /System/Library/Keychains/SystemRootCertificates.keychain >  ca-bundle.pem
   security find-certificate -a -p /Library/Keychains/System.keychain                          >> ca-bundle.pem
   export REQUESTS_CA_BUNDLE=$PWD/ca-bundle.pem
   export SSL_CERT_FILE=$PWD/ca-bundle.pem
   export OTEL_EXPORTER_OTLP_CERTIFICATE=$PWD/ca-bundle.pem
   ```
   Quick check: `curl https://<FQDN>/v1/traces` succeeding while Python's
   `urllib` raises `CERTIFICATE_VERIFY_FAILED` confirms it's this.
3. **Right token.** Use the **ingest** token (see Prerequisites), not the
   telemetry/forward secret.
4. **User attribution needs a hook patch.** Setting `OTEL_RESOURCE_ATTRIBUTES`
   (e.g. `user.email=…`) only works if the hook builds its span resource with
   `Resource.create()` (which merges env attributes). Upstream builds it with
   the bare `Resource(attributes={…})` constructor, which **ignores the env** —
   so spans land with no `userEmail` and Oversight → Cursor shows "No user
   attribution". Patch `hook_receiver.py` (`Resource(...)` → `Resource.create(...)`)
   in the source that builds your `.pkg`/`.msi`, then the per-user
   `OTEL_RESOURCE_ATTRIBUTES` the Hexnode scripts set will flow through.

The hook logs to `~/.cursor/hooks/cursor_otel_hook.log` — grep it for
`Failed to export` / `404` / `CERTIFICATE_VERIFY_FAILED` when debugging.

### MDM rollout (Hexnode)

Rollout is **two stages** — the hook binary is installed system-wide, then a
custom script writes each user's config + hook registration:

1. **Install the hook binary** — push the upstream `cursor-otel-hook` package
   as a Hexnode **app**: the `.pkg` (macOS) / `.msi` (Windows). This lands the
   wrapper + venv under `/Library/Application Support/CursorOtelHook` (macOS) or
   `C:\Program Files\CursorOtelHook` (Windows).
2. **Configure per user** — push one of these as a Hexnode **Custom Script**:

   | OS | Script | Writes | Runs as |
   | --- | --- | --- | --- |
   | macOS | [`mdm/hexnode-deploy-cursor-hook.sh`](./mdm/hexnode-deploy-cursor-hook.sh) | `~/.cursor/hooks/otel_config.json` + `otel_hook.sh` + `ca-bundle.pem` + merges `~/.cursor/hooks.json` | root |
   | Windows | [`mdm/hexnode-deploy-cursor-hook.ps1`](./mdm/hexnode-deploy-cursor-hook.ps1) | `%USERPROFILE%\.cursor\hooks\otel_config.json` + `otel_hook.cmd` + `ca-bundle.pem` + merges `hooks.json` | SYSTEM |

   **Paste the script AS-IS and pass the FQDN + ingest token via Hexnode's
   script "Arguments" field** — no edits to the body, so there's no secret in
   the script and nothing for Hexnode to strip/mangle:
   - Windows: `-CollectorFqdn "<fqdn>" -IngestToken "<ingest-bearer-token>"`
   - macOS: `"<fqdn>" "<ingest-bearer-token>"` (positional `$1 $2`)

   Optional 3rd arg = email domain (default `certifid.com`), 4th = hook-bin
   override. The ingest token is the collector's `ingest-bearer-token` (NOT the
   forward/telemetry secret). Both scripts also:
   - **Resolve the active console/interactive user** and write into *their*
     home with correct ownership (Hexnode runs as root/SYSTEM, but Cursor's
     config is per-user — there's no enforced system tier like Claude Code).
   - **Write the `/v1/traces` endpoint** and build a **`ca-bundle.pem`** from the
     OS trust store (so the export works behind a TLS-inspecting proxy); the
     generated wrapper points the exporter at it. See Gotchas above.
   - **Attribute spans per user** — the wrapper sets
     `OTEL_RESOURCE_ATTRIBUTES=user.id=<user>,user.email=<user>@<EMAIL_DOMAIN>`
     from the resolved console/interactive user. Set the `EMAIL_DOMAIN` /
     `$EmailDomain` knob to your org domain (blank → `user.id` only). Requires
     the hook's `Resource.create()` patch — Gotcha 4.
   - **Merge** into any existing `hooks.json` instead of clobbering it (uses the
     pkg's bundled `python3` on macOS; PowerShell object merge on Windows).
   - Are **idempotent** — schedule a periodic re-run for drift correction and to
     catch a different user logging in.
   - Auto-detect the installed hook executable; set `HOOK_BIN_OVERRIDE` /
     `$HookBinOverride` if your pkg version lays files out differently.

> **Verify on Windows:** the wrapper is an `otel_hook.cmd`. Confirm your Cursor
> version executes a `.cmd` for `hooks[*].command`; if it only runs a bare
> executable, point the registration at the `.exe` (it has no way to pass
> `--config`, so you'd instead set the config via machine env vars).

> Because Cursor can't *enforce* this tier (a user can edit their own
> `~/.cursor`), treat it as advisory and verify coverage from the UrNammu side
> (Oversight → Cursor → Live Spans).

#### Offboard

- macOS: `rm -f ~/.cursor/hooks/otel_config.json ~/.cursor/hooks/otel_hook.sh`
  and remove the cursor-otel-hook entries from `~/.cursor/hooks.json` (or
  uninstall the `.pkg`).
- Windows: delete `%USERPROFILE%\.cursor\hooks\otel_config.json` +
  `otel_hook.cmd` and the entries in `hooks.json` (or uninstall the `.msi`).

## Security / privacy

The collector's `attributes/strip_cursor_content` processor deletes
code-, tool-arg-, and completion-bearing attributes at the gateway
(`gen_ai.tool.arguments`, `gen_ai.completion`, `gen_ai.content`,
`tool_arguments`, `completion`, `input`, `output`, `body`) — so source code
never reaches UrNammu. UrNammu's ingest route strips the same keys again
defensively (`SENSITIVE_SPAN_KEYS`).

`gen_ai.prompt` / `prompt` are intentionally **left on the wire** so UrNammu
can run dangerous-prompt detection in-memory (Option A, the same engine the
proxy uses) on `beforeSubmitPrompt` spans. Only the risk **verdict**
(severity/category) is persisted on the span row, plus a sanitized excerpt on
the alert — **the raw prompt is never stored**. To keep prompts entirely off
the wire, stop the hook from emitting prompt attributes (or add `prompt` to
`attributes/strip_cursor_content` in the collector config).

## Smoke test

After the env is set, run one Cursor agent action. Within ~60 s:

1. Collector logs (Log Analytics) show `otlp_http/urnammu_cursor_traces`
   exports.
2. UrNammu **Oversight → Cursor** → "Live Spans (60m)" populates.
3. ```sql
   SELECT COUNT(*) FROM "CursorSpan" WHERE "receivedAt" > NOW() - INTERVAL '5 min';
   ```

## Retention

A daily Vercel cron (`/api/cron/prune-cursor-metrics`, 03:31) deletes
`CursorMetric` + `CursorSpan` rows older than the configured window. Default
**30 days**; override with the `cursor_telemetry_retention_days` AppSetting
(or `CURSOR_TELEMETRY_RETENTION_DAYS`). Set to `0` to disable pruning. Guarded
by `CRON_SECRET`, operating on the OTel `timestamp` (client wall-clock).
