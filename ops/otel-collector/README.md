# Claude Code OTel Collector (Azure Container Apps)

A single-tenant OpenTelemetry Collector gateway that accepts OTLP/HTTP metrics
from Claude Code clients across the CertifID dev org, filters to
`claude_code.*` metrics, and forwards them to UrNammu's
`/api/telemetry/claude-code` ingestion endpoint. Rows land in the
`ClaudeCodeMetric` table and surface in the "Live telemetry" panel on
Oversight → Claude Code.

Complementary to — not replacing — the daily Admin-API pull that fills
`UsageBucket(provider="claude_code")`.

## Architecture

```
Dev machines (Claude Code)
      │  OTLP/HTTP  (Authorization: Bearer <INGEST_TOKEN>)
      ▼
ACA: otel/opentelemetry-collector-contrib
      │  memory_limiter → filter/claude_code_only → resource → batch
      │  otlphttp/urnammu  (Authorization: Bearer <FORWARD_TOKEN>)
      ▼
UrNammu  POST /api/telemetry/claude-code   (Vercel)
      ▼
Vercel Postgres  (ClaudeCodeMetric)
```

- **Metrics-only.** The filter processor drops anything not named
  `claude_code.*`, and no logs pipeline is configured — so if a client
  enables the logs exporter locally, events/prompts are dropped at the
  gateway.
- **Two tokens.** `INGEST_BEARER_TOKEN` faces developers; rotate freely.
  `FORWARD_BEARER_TOKEN` is the collector-to-UrNammu server-to-server
  token; it must match UrNammu's `claude_code_telemetry_secret` setting.

## Deploy

Prereqs: Bicep CLI (`az bicep install`), an Azure subscription, and the
`certifid-ai-governance` resource group.

The Bicep template separates *infrastructure* from *secret values*. Secret
rotation is handled by `rotate-secrets.sh` — redeploys of the infra
template preserve existing bearer tokens via `listSecrets()`, so you don't
need to know the current values when you change config/image/scale.

### First-ever deploy (one-time bootstrap)

```bash
INGEST=$(openssl rand -hex 32)
FORWARD=$(openssl rand -hex 32)

# Store FORWARD on UrNammu FIRST — it must accept the token before the
# collector starts presenting it, otherwise forwards 401 in the gap.
#   vercel env add CLAUDE_CODE_TELEMETRY_SECRET production
#   vercel --prod --yes

az deployment group create \
  --resource-group certifid-ai-governance \
  --template-file ops/otel-collector/deploy-infra.bicep \
  --parameters \
      isFirstDeploy=true \
      ingestBearerToken="$INGEST" \
      forwardBearerToken="$FORWARD" \
      urnammuTelemetryUrl="https://nammu.certifid.com/api/telemetry/claude-code"

# Grab the collector URL from the deployment output
COLLECTOR_URL=$(az deployment group show \
  --resource-group certifid-ai-governance \
  --name deploy-infra \
  --query properties.outputs.ingestEndpoint.value -o tsv)

echo "Collector: $COLLECTOR_URL"
echo "Hand devs the INGEST token (distribute via managed-settings.json): $INGEST"
```

### Redeploy (config change, image bump, scaling, etc.)

Leave `isFirstDeploy` off and omit the token params. The template reads
current secret values via `listSecrets()` and preserves them.

```bash
az deployment group create \
  --resource-group certifid-ai-governance \
  --template-file ops/otel-collector/deploy-infra.bicep \
  --parameters urnammuTelemetryUrl="https://nammu.certifid.com/api/telemetry/claude-code"
```

### Rotate secrets (no Bicep needed)

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

The template deliberately **does not** set `OTEL_LOGS_EXPORTER`. No logs
pipeline means events/prompts can't leave the machine even if a developer
tries to enable them locally — their `~/.claude/settings.json` can't
override the managed file. This is belt-and-braces on top of the
collector's `filter/claude_code_only` processor.

### MDM rollout tips

- Test on one machine first by copying `managed-settings.json` to the path
  above, then `claude doctor` to confirm the env vars are picked up.
- Push updates (e.g. token rotation) by re-distributing the file and
  asking users to start a new Claude Code session — env vars are read at
  process start.
- Managed settings can also lock down permissions, hooks, and model
  choice. This file only covers telemetry; layer other policies on top.

### Per-machine opt-in (fallback)

If MDM rollout isn't ready or you're just testing on your own laptop, drop
the equivalent env vars in your shell rc file. **Users can disable this
any time**, which is why it's not the org-wide answer.

```bash
export CLAUDE_CODE_ENABLE_TELEMETRY=1
export OTEL_METRICS_EXPORTER=otlp
export OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf
export OTEL_EXPORTER_OTLP_ENDPOINT="https://<collector-fqdn>"
export OTEL_EXPORTER_OTLP_HEADERS="Authorization=Bearer <INGEST_TOKEN>"
export OTEL_METRIC_EXPORT_INTERVAL=60000
unset OTEL_LOGS_EXPORTER
export OTEL_LOG_USER_PROMPTS=0
```

## Smoke test

From any dev laptop after the env vars are set, run a single Claude Code
session; within ~60 s you should see:

1. Collector logs (Log Analytics) show `otlphttp/urnammu` exports.
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
- `deploy-infra.bicep` — Azure Container Apps deployment (Log Analytics +
  Container Apps Env + Container App). Preserves existing secret values
  via `listSecrets()` on redeploys; pass `isFirstDeploy=true` only on the
  first-ever deploy.
- `rotate-secrets.sh` — rotates ACA bearer tokens via `az containerapp
  secret set`. Standalone — no Bicep involvement.
- `managed-settings.json` — template for Claude Code org-wide enforced
  config. Copy to the MDM-managed path listed above and fill in
  `<COLLECTOR_FQDN>` + `<INGEST_TOKEN>`.
