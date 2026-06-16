# Claude Code + Cursor OTel Collector (Azure Container Apps)

A single-tenant OpenTelemetry Collector gateway that accepts OTLP/HTTP from
dev clients across the CertifID org and forwards to UrNammu.

- **Claude Code** (metrics + events) — filtered to `claude_code.*`, forwarded
  to `/api/telemetry/claude-code` (+ `-events`). Rows land in `ClaudeCodeMetric`
  / `ClaudeCodeEvent` and surface on Oversight → Claude Code.
- **Cursor** (traces) — via `cursor-otel-hook`, filtered to
  `service.name=cursor-agent`, forwarded as raw spans to
  `/api/telemetry/cursor-traces` (→ `CursorSpan`) and derived `cursor.*`
  metrics (spanmetrics connector) to `/api/telemetry/cursor` (→ `CursorMetric`).
  Surfaces on Oversight → Cursor. **Client setup lives in
  [`../cursor-hook/README.md`](../cursor-hook/README.md).** Cursor's forward
  token is a separate secret (`cursor-forward-bearer-token` /
  `CURSOR_TELEMETRY_SECRET`), rotated via `rotate-secrets.sh rotate-cursor-forward`.

The rest of this doc covers the Claude Code path; the Cursor path shares the
same collector, receiver, and ingest token.

Complementary to — not replacing — the daily Admin-API pull that fills
`UsageBucket(provider="claude_code")`.

## Architecture

```
Dev machines (Claude Code)
      │  OTLP/HTTP  (Authorization: Bearer <INGEST_TOKEN>)
      ▼
ACA: otel/opentelemetry-collector-contrib
      │  memory_limiter → filter/claude_code_only → resource → batch
      │  otlp_http/urnammu  (Authorization: Bearer <FORWARD_TOKEN>)
      ▼
UrNammu  POST /api/telemetry/claude-code   (Vercel)
      ▼
Vercel Postgres  (ClaudeCodeMetric)
```

- **Metrics + events.** The metrics pipeline filters to `claude_code.*`.
  The events (logs) pipeline forwards event *metadata* (tool names,
  permission decisions, durations, MCP connections, API errors) to
  `…/claude-code-events`.
- **Content scrub at the gateway.** `attributes/strip_log_content` deletes
  code/secret-bearing keys (`tool_input`, `tool_parameters`, `error`,
  `body`) at the gateway, so `OTEL_LOG_TOOL_DETAILS=1` /
  `OTEL_LOG_RAW_API_BODIES` can never leak that content.
- **Dangerous-prompt detection (Option A).** `prompt` is *not* stripped at
  the gateway: when `OTEL_LOG_USER_PROMPTS=1`, user-prompt text is forwarded
  so UrNammu can run the same rule engine the proxy uses
  (`analyzePromptRisk`) **in-memory** and raise alerts. Only the verdict
  (severity/category) is persisted on the event row, plus a sanitized
  excerpt on the alert — the **raw prompt is never stored**. Set
  `OTEL_LOG_USER_PROMPTS=0` to turn this off and keep prompts off the wire.
- **HTTP-only ingress.** The deployed Container App exposes OTLP/HTTP on
  port `4318`. The collector config intentionally matches that; OTLP/gRPC
  is not exposed externally.
- **Two tokens.** `INGEST_BEARER_TOKEN` faces developers; rotate freely.
  `FORWARD_BEARER_TOKEN` is the collector-to-UrNammu server-to-server
  token; it must match UrNammu's `claude_code_telemetry_secret` setting.

## Deploy

Prereqs: Bicep CLI (`az bicep install`), an Azure subscription, and the
`certifid-ai-governance` resource group.

Two moving parts:

- **`deploy-infra.sh`** — wrapper script. Reads existing bearer tokens
  from the Container App (via `az containerapp secret show`) and passes
  them to Bicep as params. On the first-ever deploy, prompts you for
  generate-fresh vs paste-existing.
- **`deploy-infra.bicep`** — the actual Bicep template. Takes the two
  tokens as `@secure()` params. You can invoke Bicep directly if you
  want to script around the wrapper; the wrapper is just about avoiding
  re-typing the tokens on every redeploy.

### Any deploy (first, subsequent, whatever)

```bash
cd ops/otel-collector
./deploy-infra.sh
```

That's it. The script figures out whether the app exists, reads existing
secrets if so, prompts for new ones if not. Overrides via env vars:

```bash
URNAMMU_URL=https://staging.example.com/api/telemetry/claude-code \
RG=other-rg APP=other-app \
  ./deploy-infra.sh
```

On first-run you'll be prompted for `forward-bearer-token`. Set
`CLAUDE_CODE_TELEMETRY_SECRET` on UrNammu **first** (and redeploy Vercel)
before you pick that value — otherwise there's a brief 401 window where
the collector forwards tokens UrNammu doesn't yet accept.

After the first deploy, grab the collector URL for `managed-settings.json`:

```bash
COLLECTOR_URL=$(az containerapp show -g certifid-ai-governance -n cc-otel-app \
  --query properties.configuration.ingress.fqdn -o tsv)
echo "https://$COLLECTOR_URL"
```

### Rotate secrets (no Bicep involved)

```bash
cd ops/otel-collector
./rotate-secrets.sh status           # list secret names
./rotate-secrets.sh rotate-ingest    # generates + sets a fresh token
./rotate-secrets.sh rotate-forward   # coordinates with UrNammu via a prompt
./rotate-secrets.sh rotate-all       # both, atomically
```

The `rotate-forward` / `rotate-all` flows prompt you to update Vercel
**first** and confirm before rotating the collector — that avoids a 401
window where the collector presents a new token UrNammu doesn't accept yet.

## Client setup (org rollout via MDM)

Claude Code reads managed settings from a platform-specific path that users
**cannot override** from their personal `~/.claude/settings.json`. This is
the right tier for org-wide telemetry: distribute via Jamf / Intune /
Kandji / whatever and the config is enforced everywhere.

Target paths:

| OS | Path |
| --- | --- |
| macOS | `/Library/Application Support/ClaudeCode/managed-settings.json` |
| Linux | `/etc/claude-code/managed-settings.json` |
| Windows | `C:\ProgramData\ClaudeCode\managed-settings.json` |

Precedence (highest wins): managed → project → user → local.

Template: [`managed-settings.json`](./managed-settings.json) — fill in the
two placeholders before shipping:

- `<COLLECTOR_FQDN>` — the `ingestEndpoint` output from the Bicep deploy,
  without trailing slash (e.g. `cc-otel-app.<region>.azurecontainerapps.io`)
- `<INGEST_TOKEN>` — the `INGEST` token from the deploy

The template sets `OTEL_LOGS_EXPORTER=otlp` to ship the events/audit
stream and `OTEL_LOG_USER_PROMPTS=1` to enable dangerous-prompt detection
(Option A): prompt text is forwarded, analyzed in-memory by UrNammu, and
discarded — only the risk verdict + a sanitized excerpt persist. It
intentionally leaves `OTEL_LOG_TOOL_DETAILS` and `OTEL_LOG_RAW_API_BODIES`
unset; the collector's `attributes/strip_log_content` drops `tool_input`,
`tool_parameters`, `error`, and `body` at the gateway regardless. To
disable prompt-risk and keep prompts entirely off the wire, set
`OTEL_LOG_USER_PROMPTS=0`. To run metrics-only, remove `OTEL_LOGS_EXPORTER`.

### MDM rollout tips

- Test on one machine first by copying `managed-settings.json` to the path
  above, then `claude doctor` to confirm the env vars are picked up.
- Push updates (e.g. token rotation) by re-distributing the file and
  asking users to start a new Claude Code session — env vars are read at
  process start.
- Managed settings can also lock down permissions, hooks, and model
  choice. This file only covers telemetry; layer other policies on top.

#### Hexnode

Hexnode has no native "drop a file at a path" payload, so deploy the managed
file with a **Custom Script** (Hexnode runs them with elevated privileges).
Committed copies use `__COLLECTOR_FQDN__` / `__INGEST_TOKEN__` placeholders
so no secret is in git — fill them in the Hexnode console copy.

| OS | Script | Path written | Runs as |
| --- | --- | --- | --- |
| macOS | [`mdm/hexnode-deploy-managed-settings.sh`](./mdm/hexnode-deploy-managed-settings.sh) | `/Library/Application Support/ClaudeCode/managed-settings.json` | root |
| Windows | [`mdm/hexnode-deploy-managed-settings.ps1`](./mdm/hexnode-deploy-managed-settings.ps1) | `C:\ProgramData\ClaudeCode\managed-settings.json` | SYSTEM |

1. Admin Console → **Scripts → Add Custom Script** → pick **Mac / Bash** or
   **Windows / PowerShell**; paste the matching script with the two values
   filled in.
2. Assign to the device group / policy. Both are idempotent (rewrite the
   file each run), so scheduling them gives you drift correction.
3. Both validate the JSON, refuse to run with unfilled placeholders, and
   lock the file down (`root:wheel`/`644` on macOS; `icacls` SYSTEM+Admins
   full / Users read-only on Windows). The PowerShell version writes UTF-8
   **without a BOM** (a BOM breaks Claude Code's JSON read).

Offboard with a one-line script:
- macOS: `rm -f "/Library/Application Support/ClaudeCode/managed-settings.json"`
- Windows: `Remove-Item -Force "C:\ProgramData\ClaudeCode\managed-settings.json"`

### Per-machine opt-in (fallback)

If MDM rollout isn't ready or you're just testing on your own laptop, drop
the equivalent env vars in your shell rc file. **Users can disable this
any time**, which is why it's not the org-wide answer.

```bash
export CLAUDE_CODE_ENABLE_TELEMETRY=1
export OTEL_METRICS_EXPORTER=otlp
export OTEL_LOGS_EXPORTER=otlp
export OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf
export OTEL_EXPORTER_OTLP_ENDPOINT="https://<collector-fqdn>"
export OTEL_EXPORTER_OTLP_HEADERS="Authorization=Bearer <INGEST_TOKEN>"
export OTEL_METRIC_EXPORT_INTERVAL=60000
export OTEL_LOGS_EXPORT_INTERVAL=5000
# Enables dangerous-prompt detection (analyzed in-memory by UrNammu, never
# stored). Set to 0 to keep prompts off the wire entirely.
export OTEL_LOG_USER_PROMPTS=1
# Code/secret content is stripped at the gateway; keep these off too:
unset OTEL_LOG_TOOL_DETAILS
unset OTEL_LOG_RAW_API_BODIES
```

## Claude Cowork

Cowork is Claude Code running inside the Claude Desktop VM. It emits the
**same `claude_code.*` OTLP metrics and events**, so this collector and the
UrNammu pipeline ingest it with **no changes** — same endpoint, same ingest
token, same metrics/events/dangerous-prompt handling.

The difference is **how it's configured**. Cowork is *not* set up via
`managed-settings.json` on the laptop; it's configured in the Anthropic
**Admin console → Cowork → Monitoring**, which propagates env into the
Cowork VM's `claude` subprocess. Point it at this collector:

| Setting | Value |
| --- | --- |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | `https://<COLLECTOR_FQDN>` |
| `OTEL_EXPORTER_OTLP_HEADERS` | `Authorization=Bearer <INGEST_TOKEN>` |
| `OTEL_EXPORTER_OTLP_PROTOCOL` | `http/protobuf` |
| `OTEL_METRICS_INCLUDE_ENTRYPOINT` | `1` (so sessions are taggable as Cowork) |

Notes:

- **Cowork defaults `OTEL_LOG_USER_PROMPTS=1`**, so dangerous-prompt
  detection works there too (analyzed in-memory by UrNammu, never stored).
- **Identification:** Cowork sessions report `app.entrypoint=local-agent`.
  UrNammu tags these as **"Cowork"** — see the Source column/filter on the
  audit log and the "By Surface" cost breakdown on Oversight → Claude Code.
- **⚠️ Version caveat:** the Cowork CLI version is pinned inside the Claude
  Desktop release (`app.asar` → `claude-code-vm/<version>`), *not* the npm
  channel. Builds affected by the OTLP-no-op bug
  ([claude-code#50567](https://github.com/anthropics/claude-code/issues/50567),
  the root cause of the Cowork-specific #39471) accept the config but emit
  **zero** telemetry. Validate one Cowork session against the collector logs
  before rolling out, and upgrade Claude Desktop if nothing arrives.

## Smoke test

From any dev laptop after the env vars are set, run a single Claude Code
session; within ~60 s you should see:

1. Collector logs (Log Analytics) show `otlp_http/urnammu` exports.
2. UrNammu Oversight → Claude Code → **Live telemetry (last 60m)** populates.
3. `SELECT COUNT(*) FROM "ClaudeCodeMetric" WHERE "receivedAt" > NOW() - INTERVAL '5 min';`

## Retention

A daily Vercel cron (`/api/cron/prune-claude-code-metrics`, runs at 03:23)
deletes `ClaudeCodeMetric` rows older than the configured window. Default is
**30 days**. Override with the `claude_code_telemetry_retention_days`
AppSetting (or `CLAUDE_CODE_TELEMETRY_RETENTION_DAYS` env var). Set to `0`
to disable pruning entirely.

The job is guarded by `CRON_SECRET` (same as the other Vercel crons) and
operates on the OTel data-point `timestamp` column (client wall-clock) —
which is what the UI filters on — not `receivedAt`.

## Files

- `config.yaml` — reference copy of the Collector config (the deployed one
  is embedded inside `deploy-infra.bicep` as a variable; keep them in sync).
- `deploy-infra.bicep` — Azure Container Apps template (Log Analytics +
  Container Apps Env + Container App). Takes both bearer tokens as
  `@secure()` params.
- `deploy-infra.sh` — wrapper around Bicep that reads existing secret
  values from ACA and passes them to the template, so you don't re-type
  tokens on every redeploy. Use this as the default deploy command.
- `rotate-secrets.sh` — rotates ACA bearer tokens via `az containerapp
  secret set`. Standalone — no Bicep involvement.
- `managed-settings.json` — template for Claude Code org-wide enforced
  config. Copy to the MDM-managed path listed above and fill in
  `<COLLECTOR_FQDN>` + `<INGEST_TOKEN>`.
